# Zombie Farm Reforged - offline launcher
# =======================================
#
# Double-clicking "Play Zombie Farm.cmd" runs this. It serves the ..\game folder
# over http://127.0.0.1 and opens the default browser at it.
#
# Why a web server at all: the built game is an ES-module bundle that fetches its
# own catalogs and art. Browsers refuse module scripts and fetch() over file://,
# so opening game\index.html directly shows a blank screen. This is the smallest
# thing that makes it work with NOTHING installed - Windows PowerShell 5.1 and the
# in-box .NET Framework are enough. No Node, no Python, no admin rights.
#
# The server binds 127.0.0.1 only (loopback), so nothing is exposed to the network
# and Windows Firewall never prompts.
#
# Save data lives in the browser's localStorage, which is keyed by ORIGIN -
# scheme + host + PORT. That is why the port is a fixed list tried in a fixed
# order (see $PORTS): land on a different port and the browser hands the game a
# different, empty save. If the usual port is taken by another program we fall
# back, and the window says so, because that is exactly when a player would
# otherwise think their farm vanished.

[CmdletBinding()]
param(
    # Serve, but don't open a browser window (used by the smoke test).
    [switch]$NoBrowser,
    # Close on its own after N seconds instead of waiting for the player (smoke test).
    [int]$SelfTestSeconds = 0,
    # Where the desktop shortcut goes. Overridable so the smoke test can point it
    # at a scratch folder instead of the real Desktop.
    [string]$DesktopPath = '',
    # Save a PNG of the status window here, for eyeballing UI changes.
    [string]$SelfTestShot = ''
)

$ErrorActionPreference = 'Stop'

$APP_NAME  = 'Zombie Farm Reforged'
$MARKER    = 'zombie-farm-reforged-launcher'
# First entry is the normal home. The rest are only reached when something else
# already holds the port - see the localStorage note above.
$PORTS     = 8722, 8723, 8724, 8725, 8726

$launcherDir = $PSScriptRoot
$packageRoot = Split-Path -Parent $launcherDir

# Logs and the "shortcut already offered" marker go to LOCALAPPDATA, not next to
# the game: the folder may sit somewhere unwritable (Program Files), and modders
# get a clean game folder with nothing of ours dropped into it.
$stateDir = Join-Path $env:LOCALAPPDATA 'ZombieFarmReforged'
$logFile  = Join-Path $stateDir 'launcher-log.txt'

function Write-Log([string]$message) {
    try {
        if (-not (Test-Path -LiteralPath $stateDir)) {
            New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
        }
        if (Test-Path -LiteralPath $logFile) {
            $existing = Get-Item -LiteralPath $logFile
            if ($existing.Length -gt 200KB) { Remove-Item -LiteralPath $logFile -Force }
        }
        $stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
        Add-Content -LiteralPath $logFile -Value "$stamp  $message" -Encoding UTF8
    } catch {
        # Logging must never be the thing that stops the game from starting.
    }
}

function Show-Error([string]$message) {
    Write-Log "ERROR: $message"
    $full = "$message`r`n`r`nDetails were written to:`r`n$logFile"
    try {
        Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
        [System.Windows.Forms.MessageBox]::Show(
            $full, "$APP_NAME - couldn't start",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
    } catch {
        # No WinForms (Server Core, stripped image): fall back to the console.
        Write-Host $full -ForegroundColor Red
        Start-Sleep -Seconds 20
    }
}

# ---------------------------------------------------------------- game folder --

# game\ is where the release zip puts the built game. The dist\ entries let this
# same script run straight out of a source checkout without packaging first.
function Find-GameFolder {
    $candidates = @(
        (Join-Path $packageRoot 'game'),
        (Join-Path $packageRoot 'dist'),
        (Join-Path $packageRoot '..\..\dist'),
        (Join-Path $packageRoot '..\..\..\dist')
    )
    foreach ($candidate in $candidates) {
        try { $resolved = (Resolve-Path -LiteralPath $candidate -ErrorAction Stop).Path } catch { continue }
        if (Test-Path -LiteralPath (Join-Path $resolved 'index.html')) { return $resolved }
    }
    return $null
}

# ------------------------------------------------------------ the web server --

# Compiled in-memory on each launch (about a second). Kept in C# rather than
# PowerShell because the game pulls hundreds of asset files at once and a
# byte-at-a-time PowerShell loop makes the load screen crawl.
#
# HttpListener would be less code but needs an admin-registered URL ACL, so this
# speaks HTTP over a plain loopback socket instead: nothing to register, no
# elevation prompt.
$serverSource = @'
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace ZFLauncher
{
    /// <summary>The launcher is started with -WindowStyle Hidden so no console
    /// flashes up. That also means our status window inherits "do not activate"
    /// from the process start info and can open behind whatever the player was
    /// looking at, which reads as "nothing happened". Show and raise it by hand.
    /// </summary>
    public static class Native
    {
        [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr window, int command);
        [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
        [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);

        public static void Present(IntPtr window)
        {
            ShowWindow(window, 5); // SW_SHOW
            SetForegroundWindow(window);
        }
    }


    public class Server
    {
        private readonly string _root;
        private readonly int _port;
        private readonly TcpListener _listener;
        private volatile bool _stopping;

        public Server(string root, int port)
        {
            _root = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar);
            _port = port;
            _listener = new TcpListener(IPAddress.Loopback, port);
        }

        public int Port { get { return _port; } }

        public void Start()
        {
            _listener.Start();
            Thread accept = new Thread(new ThreadStart(AcceptLoop));
            accept.IsBackground = true;
            accept.Start();
        }

        public void Stop()
        {
            _stopping = true;
            try { _listener.Stop(); } catch (Exception) { }
        }

        private void AcceptLoop()
        {
            while (!_stopping)
            {
                TcpClient client;
                try { client = _listener.AcceptTcpClient(); }
                catch (Exception) { return; }
                // A dedicated thread per connection, not the thread pool: the browser
                // holds several keep-alive sockets open and blocked pool threads only
                // get replaced on a timer, which stalls the opening asset burst.
                Thread worker = new Thread(new ParameterizedThreadStart(Serve));
                worker.IsBackground = true;
                worker.Start(client);
            }
        }

        private void Serve(object state)
        {
            TcpClient client = (TcpClient)state;
            try
            {
                client.NoDelay = true;
                using (NetworkStream net = client.GetStream())
                {
                    net.ReadTimeout = 15000;
                    net.WriteTimeout = 60000;
                    BufferedStream input = new BufferedStream(net, 8192);
                    while (!_stopping)
                    {
                        string requestLine = ReadLine(input);
                        if (requestLine == null) return;
                        if (requestLine.Length == 0) continue; // tolerate a stray CRLF

                        Dictionary<string, string> headers =
                            new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                        while (true)
                        {
                            string header = ReadLine(input);
                            if (header == null) return;
                            if (header.Length == 0) break;
                            int colon = header.IndexOf(':');
                            if (colon > 0)
                            {
                                headers[header.Substring(0, colon).Trim()] =
                                    header.Substring(colon + 1).Trim();
                            }
                        }

                        if (!Handle(net, requestLine, headers)) return;
                    }
                }
            }
            catch (Exception) { }
            finally { try { client.Close(); } catch (Exception) { } }
        }

        private static string ReadLine(Stream input)
        {
            StringBuilder line = new StringBuilder();
            while (true)
            {
                int b = input.ReadByte();
                if (b < 0) return line.Length == 0 ? null : line.ToString();
                if (b == 10) return line.ToString().TrimEnd('\r');
                line.Append((char)b);
                if (line.Length > 8192) return null; // absurd request line; drop it
            }
        }

        private bool Handle(Stream output, string requestLine, Dictionary<string, string> headers)
        {
            string[] parts = requestLine.Split(' ');
            if (parts.Length < 2)
            {
                Send(output, 400, "Bad Request", "text/plain; charset=utf-8",
                     Encoding.UTF8.GetBytes("Bad request"), true, false, null);
                return false;
            }

            string method = parts[0].ToUpperInvariant();
            string target = parts[1];
            bool keepAlive = !(parts.Length > 2 && parts[2].IndexOf("1.0", StringComparison.Ordinal) >= 0);
            string connection;
            if (headers.TryGetValue("Connection", out connection) &&
                connection.IndexOf("close", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                keepAlive = false;
            }

            bool bodyWanted = method != "HEAD";
            if (method != "GET" && method != "HEAD")
            {
                Send(output, 405, "Method Not Allowed", "text/plain; charset=utf-8",
                     Encoding.UTF8.GetBytes("Only GET and HEAD are served."), true, keepAlive,
                     "Allow: GET, HEAD\r\n");
                return keepAlive;
            }

            int cut = target.IndexOfAny(new char[] { '?', '#' });
            string path = cut >= 0 ? target.Substring(0, cut) : target;
            try { path = Uri.UnescapeDataString(path); } catch (Exception) { }

            // Health/identity probe. A second double-click finds this and just
            // re-opens the browser instead of starting a rival server.
            if (path == "/__zflauncher")
            {
                byte[] json = Encoding.UTF8.GetBytes(
                    "{\"app\":\"zombie-farm-reforged-launcher\",\"port\":" +
                    _port.ToString(CultureInfo.InvariantCulture) + "}");
                Send(output, 200, "OK", "application/json", json, bodyWanted, keepAlive, null);
                return keepAlive;
            }

            // The shipped build registers a service worker that cache-firsts art and
            // audio. Locally that is pure downside: swap a file for a mod and the
            // browser keeps serving the old one out of the cache. Answer with a
            // worker that deletes the caches and unregisters itself - byte-different
            // from any previously installed copy, so the browser adopts it and the
            // old one dies.
            if (path == "/sw.js")
            {
                byte[] script = Encoding.UTF8.GetBytes(KillSwitchWorker);
                Send(output, 200, "OK", "text/javascript; charset=utf-8", script,
                     bodyWanted, keepAlive, null);
                return keepAlive;
            }

            string full = Resolve(path);
            if (full == null || !File.Exists(full))
            {
                byte[] page = Encoding.UTF8.GetBytes(NotFoundPage(path));
                Send(output, 404, "Not Found", "text/html; charset=utf-8", page,
                     bodyWanted, keepAlive, null);
                return keepAlive;
            }

            return SendFile(output, full, headers, bodyWanted, keepAlive);
        }

        /// <summary>Maps a URL path to a file inside the game folder, or null if it
        /// escapes it.</summary>
        private string Resolve(string path)
        {
            if (path.Length == 0 || path[0] != '/') return null;
            if (path.IndexOf('\0') >= 0) return null;
            string relative = path.Substring(1).Replace('/', Path.DirectorySeparatorChar);
            if (relative.Length == 0) relative = "index.html";

            string combined;
            try { combined = Path.GetFullPath(Path.Combine(_root, relative)); }
            catch (Exception) { return null; }

            // Containment check AFTER normalisation, so ..\ and friends can't walk out.
            if (!combined.Equals(_root, StringComparison.OrdinalIgnoreCase) &&
                !combined.StartsWith(_root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            {
                return null;
            }
            if (Directory.Exists(combined)) combined = Path.Combine(combined, "index.html");
            return combined;
        }

        private bool SendFile(Stream output, string full, Dictionary<string, string> headers,
                              bool bodyWanted, bool keepAlive)
        {
            using (FileStream file = new FileStream(full, FileMode.Open, FileAccess.Read,
                                                    FileShare.ReadWrite, 65536))
            {
                long length = file.Length;
                long start = 0;
                long end = length - 1;
                int status = 200;
                string reason = "OK";
                string extra = null;

                // Range support matters for <audio>/<video>: Chrome asks for byte
                // ranges and a server that ignores them breaks seeking.
                string range;
                if (headers.TryGetValue("Range", out range) && ParseRange(range, length, ref start, ref end))
                {
                    status = 206;
                    reason = "Partial Content";
                    extra = "Content-Range: bytes " + start.ToString(CultureInfo.InvariantCulture) + "-" +
                            end.ToString(CultureInfo.InvariantCulture) + "/" +
                            length.ToString(CultureInfo.InvariantCulture) + "\r\n";
                }

                long count = length == 0 ? 0 : end - start + 1;
                WriteHeaders(output, status, reason, MimeType(full), count, keepAlive, extra);
                if (!bodyWanted) { output.Flush(); return keepAlive; }

                file.Seek(start, SeekOrigin.Begin);
                byte[] buffer = new byte[65536];
                long remaining = count;
                while (remaining > 0)
                {
                    int wanted = (int)Math.Min(buffer.Length, remaining);
                    int read = file.Read(buffer, 0, wanted);
                    if (read <= 0) break;
                    output.Write(buffer, 0, read);
                    remaining -= read;
                }
                output.Flush();
                return keepAlive;
            }
        }

        private static bool ParseRange(string header, long length, ref long start, ref long end)
        {
            if (length == 0) return false;
            if (!header.StartsWith("bytes=", StringComparison.OrdinalIgnoreCase)) return false;
            string spec = header.Substring(6).Trim();
            if (spec.IndexOf(',') >= 0) return false; // multi-range: just send the whole file
            int dash = spec.IndexOf('-');
            if (dash < 0) return false;

            string from = spec.Substring(0, dash).Trim();
            string to = spec.Substring(dash + 1).Trim();
            long parsedFrom, parsedTo;

            if (from.Length == 0)
            {
                // "bytes=-500" - the final 500 bytes.
                if (!long.TryParse(to, NumberStyles.None, CultureInfo.InvariantCulture, out parsedTo)) return false;
                if (parsedTo <= 0) return false;
                start = Math.Max(0, length - parsedTo);
                end = length - 1;
                return true;
            }

            if (!long.TryParse(from, NumberStyles.None, CultureInfo.InvariantCulture, out parsedFrom)) return false;
            if (parsedFrom >= length) return false;
            if (to.Length == 0) { parsedTo = length - 1; }
            else if (!long.TryParse(to, NumberStyles.None, CultureInfo.InvariantCulture, out parsedTo)) return false;
            if (parsedTo >= length) parsedTo = length - 1;
            if (parsedTo < parsedFrom) return false;

            start = parsedFrom;
            end = parsedTo;
            return true;
        }

        private static void WriteHeaders(Stream output, int status, string reason, string contentType,
                                         long contentLength, bool keepAlive, string extra)
        {
            StringBuilder head = new StringBuilder();
            head.Append("HTTP/1.1 ").Append(status.ToString(CultureInfo.InvariantCulture))
                .Append(' ').Append(reason).Append("\r\n");
            head.Append("Content-Type: ").Append(contentType).Append("\r\n");
            head.Append("Content-Length: ")
                .Append(contentLength.ToString(CultureInfo.InvariantCulture)).Append("\r\n");
            head.Append("Accept-Ranges: bytes\r\n");
            // no-store, deliberately: a modder who drops a new PNG in and hits reload
            // must see it immediately. Reading from local disk, caching buys nothing.
            head.Append("Cache-Control: no-store\r\n");
            head.Append("X-Content-Type-Options: nosniff\r\n");
            head.Append("Connection: ").Append(keepAlive ? "keep-alive" : "close").Append("\r\n");
            if (extra != null) head.Append(extra);
            head.Append("\r\n");
            byte[] bytes = Encoding.ASCII.GetBytes(head.ToString());
            output.Write(bytes, 0, bytes.Length);
        }

        private static void Send(Stream output, int status, string reason, string contentType,
                                 byte[] body, bool bodyWanted, bool keepAlive, string extra)
        {
            WriteHeaders(output, status, reason, contentType, body.Length, keepAlive, extra);
            if (bodyWanted) output.Write(body, 0, body.Length);
            output.Flush();
        }

        private static string NotFoundPage(string path)
        {
            return "<!doctype html><meta charset=\"utf-8\"><title>Not found</title>" +
                   "<body style=\"font:15px/1.5 system-ui,sans-serif;background:#33502b;color:#f3ecd2;padding:40px\">" +
                   "<h1>File not found</h1><p>The game asked for <code>" +
                   WebUtility.HtmlEncode(path) + "</code> and it isn't in the game folder.</p>" +
                   "<p>If you installed a mod, one of its files may be missing or in the wrong place.</p>";
        }

        private const string KillSwitchWorker =
            "// Replaced by the Zombie Farm Reforged local launcher.\n" +
            "// The shipped service worker caches art forever, which hides modded files.\n" +
            "self.addEventListener('install', function () { self.skipWaiting(); });\n" +
            "self.addEventListener('activate', function (event) {\n" +
            "  event.waitUntil((async function () {\n" +
            "    try {\n" +
            "      var keys = await caches.keys();\n" +
            "      await Promise.all(keys.map(function (k) { return caches.delete(k); }));\n" +
            "    } catch (e) {}\n" +
            "    try { await self.registration.unregister(); } catch (e) {}\n" +
            "  })());\n" +
            "});\n";

        private static readonly Dictionary<string, string> Mime = BuildMime();

        private static Dictionary<string, string> BuildMime()
        {
            Dictionary<string, string> map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            map[".html"] = "text/html; charset=utf-8";
            map[".htm"] = "text/html; charset=utf-8";
            map[".js"] = "text/javascript; charset=utf-8";
            map[".mjs"] = "text/javascript; charset=utf-8";
            map[".css"] = "text/css; charset=utf-8";
            map[".json"] = "application/json; charset=utf-8";
            map[".map"] = "application/json; charset=utf-8";
            map[".webmanifest"] = "application/manifest+json; charset=utf-8";
            map[".txt"] = "text/plain; charset=utf-8";
            map[".svg"] = "image/svg+xml";
            map[".png"] = "image/png";
            map[".jpg"] = "image/jpeg";
            map[".jpeg"] = "image/jpeg";
            map[".gif"] = "image/gif";
            map[".webp"] = "image/webp";
            map[".avif"] = "image/avif";
            map[".ico"] = "image/x-icon";
            map[".bmp"] = "image/bmp";
            map[".mp3"] = "audio/mpeg";
            map[".ogg"] = "audio/ogg";
            map[".oga"] = "audio/ogg";
            map[".wav"] = "audio/wav";
            map[".m4a"] = "audio/mp4";
            map[".aac"] = "audio/aac";
            map[".mp4"] = "video/mp4";
            map[".webm"] = "video/webm";
            map[".woff"] = "font/woff";
            map[".woff2"] = "font/woff2";
            map[".ttf"] = "font/ttf";
            map[".otf"] = "font/otf";
            map[".xml"] = "application/xml; charset=utf-8";
            map[".wasm"] = "application/wasm";
            return map;
        }

        private static string MimeType(string full)
        {
            string extension = Path.GetExtension(full);
            string type;
            if (extension != null && Mime.TryGetValue(extension, out type)) return type;
            return "application/octet-stream";
        }
    }
}
'@

# ------------------------------------------------------------------ helpers --

# Is the thing already holding this port our own launcher?
function Test-ExistingLauncher([int]$port) {
    try {
        $request = [System.Net.WebRequest]::Create("http://127.0.0.1:$port/__zflauncher")
        $request.Timeout = 1500
        $request.Method = 'GET'
        $response = $request.GetResponse()
        try {
            $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
            $body = $reader.ReadToEnd()
        } finally { $response.Close() }
        return $body -like "*$MARKER*"
    } catch {
        return $false
    }
}

function New-DesktopShortcut([string]$targetCmd, [string]$iconPath, [string]$workingDir) {
    # In test mode the marker lives with the scratch desktop, so a test run can
    # never consume the real "offer the shortcut once" token.
    $marker = if ($DesktopPath) { Join-Path $DesktopPath 'shortcut-created.txt' }
              else { Join-Path $stateDir 'shortcut-created.txt' }
    # Created once. Recreating it every launch would resurrect a shortcut the
    # player deliberately threw away.
    if (Test-Path -LiteralPath $marker) { return $false }

    $desktop = if ($DesktopPath) { $DesktopPath } else { [Environment]::GetFolderPath('Desktop') }
    # GetFolderPath follows a OneDrive-redirected Desktop, which is the common case.
    if (-not $desktop -or -not (Test-Path -LiteralPath $desktop)) { return $false }
    $link = Join-Path $desktop "$APP_NAME.lnk"

    try {
        if (-not (Test-Path -LiteralPath $link)) {
            $shell = New-Object -ComObject WScript.Shell
            $shortcut = $shell.CreateShortcut($link)
            $shortcut.TargetPath = $targetCmd
            $shortcut.WorkingDirectory = $workingDir
            $shortcut.WindowStyle = 7   # start minimised: the cmd window is a flash, not a UI
            $shortcut.Description = "Play $APP_NAME"
            if (Test-Path -LiteralPath $iconPath) { $shortcut.IconLocation = $iconPath }
            $shortcut.Save()
            Write-Log "Created desktop shortcut: $link"
        }
        if (-not (Test-Path -LiteralPath $stateDir)) {
            New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
        }
        Set-Content -LiteralPath $marker -Value $link -Encoding UTF8
        return $true
    } catch {
        Write-Log "Shortcut creation failed: $($_.Exception.Message)"
        return $false
    }
}

# ------------------------------------------------------------------- startup --

try {
    Write-Log "--- launch: $packageRoot"

    $gameDir = Find-GameFolder
    if (-not $gameDir) {
        Show-Error @"
The game files are missing.

Expected a 'game' folder containing index.html, next to 'Play Zombie Farm.cmd':

  $packageRoot\game\index.html

If you unzipped the download, make sure you extracted the WHOLE zip (right-click
the zip > Extract All), and that you are running the .cmd from inside the
extracted folder - not from inside the zip itself.
"@
        exit 1
    }
    Write-Log "Serving: $gameDir"

    # Add-Type shells out to the in-box C# compiler, which stages a .cs file in
    # %TEMP%. On a machine where TEMP is full, redirected, or locked down, that
    # fails with a confusing "source file could not be found" - so retry once
    # against a temp folder we own.
    $compiled = $false
    try {
        Add-Type -TypeDefinition $serverSource -Language CSharp -ErrorAction Stop
        $compiled = $true
    } catch {
        Write-Log "First compile attempt failed: $($_.Exception.Message)"
    }
    if (-not $compiled) {
        try {
            $buildDir = Join-Path $stateDir 'build'
            New-Item -ItemType Directory -Path $buildDir -Force | Out-Null
            $env:TEMP = $buildDir
            $env:TMP = $buildDir
            Add-Type -TypeDefinition $serverSource -Language CSharp -ErrorAction Stop
            $compiled = $true
            Write-Log "Compiled using private temp: $buildDir"
        } catch {
            Show-Error @"
Windows couldn't start the built-in web server.

$($_.Exception.Message)
"@
            exit 1
        }
    }

    $server = $null
    foreach ($candidate in $PORTS) {
        $attempt = New-Object ZFLauncher.Server($gameDir, $candidate)
        try {
            $attempt.Start()
            $server = $attempt
            break
        } catch {
            # Port busy. If it is our own earlier instance, hand the player back to
            # the game already running there instead of starting a second copy.
            if (Test-ExistingLauncher $candidate) {
                Write-Log "Already running on $candidate - reopening browser."
                if (-not $NoBrowser) { Start-Process "http://127.0.0.1:$candidate/" }
                exit 0
            }
            Write-Log "Port $candidate unavailable: $($_.Exception.Message)"
        }
    }

    if (-not $server) {
        Show-Error @"
Couldn't open a local port for the game (tried $($PORTS -join ', ')).

Something else on this PC is using all of them. Restarting Windows usually
clears it.
"@
        exit 1
    }

    $port = $server.Port
    $url = "http://127.0.0.1:$port/"
    Write-Log "Listening on $url"

    # A fallback port is the one case where a player's save appears to vanish, so
    # say it out loud rather than letting them discover an empty farm.
    $portWarning = ''
    if ($port -ne $PORTS[0]) {
        $portWarning = "Note: port $($PORTS[0]) was busy, so this is running on $port. " +
                       "Browser saves are per-port, so a farm you started on $($PORTS[0]) " +
                       "isn't visible here. Close whatever is using $($PORTS[0]) and relaunch to get it back."
        Write-Log "WARNING: fell back to port $port"
    }

    $playCmd = Join-Path $packageRoot 'Play Zombie Farm.cmd'
    $iconPath = Join-Path $launcherDir 'zombiefarm.ico'
    $madeShortcut = New-DesktopShortcut $playCmd $iconPath $packageRoot

    if (-not $NoBrowser) { Start-Process $url }

    # ------------------------------------------------------------- the window --
    # A small always-there window, not a console: it tells the player the game is
    # running, gives them the address back if they close the tab, and makes
    # stopping it a labelled button instead of "close the black box".
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing

    $form = New-Object System.Windows.Forms.Form
    $form.Text = $APP_NAME
    $form.ClientSize = New-Object System.Drawing.Size(430, $(if ($portWarning) { 250 } else { 195 }))
    $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
    $form.MaximizeBox = $false
    $form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
    $form.BackColor = [System.Drawing.Color]::FromArgb(51, 80, 43)
    $form.ForeColor = [System.Drawing.Color]::FromArgb(243, 236, 210)
    if (Test-Path -LiteralPath $iconPath) {
        try { $form.Icon = New-Object System.Drawing.Icon($iconPath) } catch { }
    }

    $title = New-Object System.Windows.Forms.Label
    $title.Text = "$APP_NAME is running"
    $title.Font = New-Object System.Drawing.Font('Segoe UI', 13, [System.Drawing.FontStyle]::Bold)
    $title.SetBounds(18, 16, 394, 28)

    $body = New-Object System.Windows.Forms.Label
    $lines = @("The game opened in your web browser at $url",
               "Leave this window open while you play - closing it stops the game.")
    if ($madeShortcut) { $lines += "A shortcut was added to your Desktop." }
    if ($portWarning) { $lines += '' ; $lines += $portWarning }
    $body.Text = $lines -join "`r`n"
    $body.Font = New-Object System.Drawing.Font('Segoe UI', 9)
    $body.SetBounds(18, 48, 394, $(if ($portWarning) { 120 } else { 66 }))

    $openButton = New-Object System.Windows.Forms.Button
    $openButton.Text = 'Open game'
    $openButton.SetBounds(18, $form.ClientSize.Height - 52, 130, 34)
    # Standard, not System: the System style is drawn by the OS and ignores
    # BackColor, which would leave both buttons default grey on the dark form.
    $openButton.FlatStyle = [System.Windows.Forms.FlatStyle]::Standard
    $openButton.BackColor = [System.Drawing.Color]::FromArgb(240, 122, 30)
    $openButton.ForeColor = [System.Drawing.Color]::White
    $openButton.Font = New-Object System.Drawing.Font('Segoe UI', 9, [System.Drawing.FontStyle]::Bold)
    $openButton.Add_Click({ Start-Process $url })

    $stopButton = New-Object System.Windows.Forms.Button
    $stopButton.Text = 'Stop game'
    $stopButton.SetBounds(160, $form.ClientSize.Height - 52, 130, 34)
    $stopButton.FlatStyle = [System.Windows.Forms.FlatStyle]::Standard
    $stopButton.BackColor = [System.Drawing.Color]::FromArgb(74, 96, 63)
    $stopButton.ForeColor = [System.Drawing.Color]::FromArgb(243, 236, 210)
    $stopButton.Add_Click({ $form.Close() })

    $folderLink = New-Object System.Windows.Forms.LinkLabel
    $folderLink.Text = 'Game folder'
    $folderLink.SetBounds(302, $form.ClientSize.Height - 44, 110, 20)
    $folderLink.LinkColor = [System.Drawing.Color]::FromArgb(240, 122, 30)
    $folderLink.Add_LinkClicked({ Start-Process 'explorer.exe' -ArgumentList "`"$gameDir`"" })

    $form.Controls.AddRange(@($title, $body, $openButton, $stopButton, $folderLink))
    $form.Add_Shown({
        [ZFLauncher.Native]::Present($form.Handle)
        Write-Log "Window shown (visible=$([ZFLauncher.Native]::IsWindowVisible($form.Handle)))"
        # Maintenance aid: capture what the player actually sees, so a change to
        # this window can be eyeballed without babysitting a launch.
        if ($SelfTestShot) {
            $bitmap = New-Object System.Drawing.Bitmap($form.Width, $form.Height)
            $form.DrawToBitmap($bitmap, (New-Object System.Drawing.Rectangle(0, 0, $form.Width, $form.Height)))
            $bitmap.Save($SelfTestShot, [System.Drawing.Imaging.ImageFormat]::Png)
            $bitmap.Dispose()
            Write-Log "Wrote window capture: $SelfTestShot"
        }
    })
    $form.Add_FormClosing({ $server.Stop(); Write-Log 'Stopped.' })

    if ($SelfTestSeconds -gt 0) {
        $timer = New-Object System.Windows.Forms.Timer
        $timer.Interval = $SelfTestSeconds * 1000
        $timer.Add_Tick({ $timer.Stop(); $form.Close() })
        $timer.Start()
    }

    [System.Windows.Forms.Application]::Run($form)
} catch {
    Show-Error "Unexpected error: $($_.Exception.Message)`r`n`r`n$($_.ScriptStackTrace)"
    exit 1
}
