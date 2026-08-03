// Farm audio: a looping BGM, an ambient farm bed (birds/rooster over a low
// ambience track), one-shot SFX for farm actions and menu navigation, and
// per-object "tap" sounds for signature decor. All three channels (music,
// sfx, ambience) toggle independently in Settings and persist to localStorage.
// Big files (BGM/ambience bed) are lazy (preload="none") so they only fetch
// once their channel is first enabled.
import { SETTINGS_KEY } from "./save/schema";
import { BASE } from "./base";

export type Sfx =
  | "till" | "plant" | "harvest" | "harvestZombie" | "xp"
  | "buy" | "sell" | "place" | "instaGrow"
  | "menuOpen" | "menuClose" | "menuClick" | "levelUp" | "attack";

export interface FightStrike {
  team: "player" | "enemy";
  attackName?: string;
  impact?: "projectile";
  sfxFile?: string;
}

// Most clips are shipped as compressed .mp3 (universal browser support). The
// .wav->.mp3 coercion lets data-driven filenames (e.g. decor tapSound values
// authored as *.wav) resolve to the shipped file without editing that data.
// Recovered fight cues opt out through an explicit path and retain their PCM WAV.
const A = (n: string) => n.includes("/")
  ? `${BASE}assets/${n}`
  : `${BASE}assets/audio/${n.replace(/\.wav$/i, ".mp3")}`;

// Which clip each SFX plays. Plowing/planting reuse the hoe sound; crops harvest
// with their own pluck; a harvested zombie uses the plain harvest chime.
const SFX_FILE: Record<Sfx, string> = {
  till: "plowing.mp3",
  plant: "plowing.mp3",
  harvest: "harvestPlant.mp3",
  harvestZombie: "harvest.mp3",
  xp: "earn.mp3",
  buy: "buy.mp3",
  sell: "delete.mp3",
  place: "stamp.mp3",
  instaGrow: "poof.mp3",
  menuOpen: "menuOpen.mp3",
  menuClose: "menuClose.mp3",
  menuClick: "menuClick.mp3",
  levelUp: "winner.mp3",
  attack: "block.mp3",
};

// Per-SFX volume. Menu whooshes/clicks sit under action feedback; anything
// unlisted uses DEFAULT_VOL.
const DEFAULT_VOL = 0.6;
const SFX_VOL: Partial<Record<Sfx, number>> = {
  menuOpen: 0.4, menuClose: 0.4, menuClick: 0.28,
  buy: 0.55, sell: 0.55, place: 0.5, instaGrow: 0.6,
  levelUp: 0.75, harvestZombie: 0.7,
  attack: 0.32,
};

// Ground truth from Attacks.json: player zombies' ordinary attack is ZombieBite,
// while stage actors choose a cue matching their authored attack. These files use
// an explicit assets/audio/ path so A() preserves the recovered WAV extension
// instead of applying its legacy data-driven WAV -> MP3 decor coercion.
function fightStrikeFile({ team, attackName = "", impact, sfxFile }: FightStrike): string {
  if (impact === "projectile") return "audio/splat.wav";
  if (sfxFile) return sfxFile.includes("/") ? sfxFile : `audio/${sfxFile}`;
  const attack = attackName.toLowerCase();
  if (attack.includes("bite")) return "audio/bite.wav";
  if (attack.includes("poke") || attack.includes("stab") || attack.includes("midgetstack")) {
    return "audio/poke.wav";
  }
  if (attack.includes("slice") || attack.includes("slash")) return "audio/swipe.wav";
  if (attack.includes("flail") || attack.includes("scratch")) return "audio/flail.wav";
  if (team === "player") return "audio/bite.wav";
  return "audio/punch.wav";
}

// Ambient farm life: a quiet continuous bed, plus an occasional rooster/crow so
// the farm never sounds dead. One-shots fire on a randomized 18-42s timer.
const AMBIENCE_BED = "SFXambience.mp3";
const AMBIENCE_ONESHOTS = ["rooster.mp3", "crow.mp3", "birds.mp3"];
const AMBIENCE_MIN_MS = 18_000;
const AMBIENCE_MAX_MS = 42_000;

// A zombie's "Brains…" bark, chosen by its group (the game ships one clip per
// group). The Regular group's cyborg/robot/robocop tiers use the robot bark.
function brainFile(group: string, key: string): string | null {
  switch (group) {
    case "Garden": return "brainGarden.mp3";
    case "Girl":
    case "Female": return "brainGirl.mp3";
    case "Small": return "brainSmall.mp3";
    case "Large": return "brainLarge.mp3";
    case "Headless": return null;
    case "Regular":
      return /Tier[2-5]$/.test(key) ? "brainRobot.mp3" : "brainRegular.mp3";
    default: return "brainRegular.mp3"; // Headless + anything unmapped
  }
}

function zombieGroupFromKey(key: string): string {
  return /^ZombieActor(Garden|Girl|Small|Large|Regular|Headless)/i.exec(key)?.[1] ?? "Regular";
}

interface StoredSettings {
  master?: boolean;
  music?: boolean;
  sfx?: boolean;
  ambience?: boolean;
  masterVolume?: number;
  musicVolume?: number;
  sfxVolume?: number;
  ambienceVolume?: number;
  muteWhenUnfocused?: boolean;
}

const clampVolume = (value: unknown, fallback = 1): number =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback;

// Every fight cue a raid can fire. Decoded up front on entering a raid so combat
// never falls back to the media-element path mid-swing (see playOneShot).
const FIGHT_CUE_FILES = [
  "audio/bite.wav", "audio/flail.wav", "audio/poke.wav",
  "audio/swipe.wav", "audio/punch.wav", "audio/splat.wav",
];

/** Web Audio voices allowed at once. Combat can fire ~20 cues/s; past this many
 *  overlapping clips nothing is audible anyway, so extra cues are dropped rather
 *  than allowed to pile up. */
const MAX_VOICES = 24;

/** Safety net for the media-element fallback: reclaim an element to the pool even
 *  if `ended` never arrives (iOS silently stalls elements it decides to evict).
 *  Without this the pool starves and every later cue allocates a fresh element. */
const ONE_SHOT_RECLAIM_MS = 10_000;

export class AudioManager {
  masterOn = true;
  musicOn = true;
  sfxOn = true;
  ambienceOn = true;
  masterVolume = 1;
  musicVolume = 1;
  sfxVolume = 1;
  ambienceVolume = 1;
  muteWhenUnfocused = false;
  private bgm: HTMLAudioElement;
  private ambBed: HTMLAudioElement;
  private ambTimer: ReturnType<typeof setTimeout> | null = null;
  private oneShots = new Set<HTMLAudioElement>();
  // Finished one-shot elements, pooled per file for reuse. Raid combat fires up to
  // ~20 cues/s; a fresh `new Audio()` per cue makes iOS re-enter its media-loading
  // pipeline every time, a reliable source of main-thread jank and audio stutter.
  private oneShotPool = new Map<string, HTMLAudioElement[]>();
  // Web Audio one-shot path. See playOneShot: media elements cost several ms of
  // main-thread time per play() on iOS, which is fine for a menu click and ruinous
  // for a raid firing an attack cue on nearly every 50 ms combat tick.
  private ctx: AudioContext | null = null;
  private ctxUnavailable = false;
  private buffers = new Map<string, AudioBuffer>();
  private decoding = new Set<string>();
  private voices = 0;
  private armed = false; // whether a user-gesture resume listener is pending
  // While a raid is up, its looping stage BGM replaces the farm bgm. `raidBgm`
  // holds the active raid track (and `raidFile` its filename); the farm bgm is
  // paused for the raid's duration.
  private raidBgm: HTMLAudioElement | null = null;
  private victoryBgm: HTMLAudioElement | null = null;
  private raidFile = "";
  private zombieBarkSource: (() => { group: string; key: string } | null) | null = null;

  constructor() {
    this.bgm = new Audio(A("dayFarmBGM.mp3"));
    this.bgm.loop = true;
    this.bgm.volume = 0.4;
    this.bgm.preload = "none";

    this.ambBed = new Audio(A(AMBIENCE_BED));
    this.ambBed.loop = true;
    this.ambBed.volume = 0.25;
    this.ambBed.preload = "none";

    // Restore persisted channel toggles. Autoplay may be blocked until the user
    // interacts, so arm a one-shot gesture listener to (re)start any looping
    // channel that couldn't begin immediately.
    const s = this.read();
    this.masterOn = s.master ?? true;
    this.musicOn = s.music ?? true;
    this.sfxOn = s.sfx ?? true;
    this.ambienceOn = s.ambience ?? true;
    this.masterVolume = clampVolume(s.masterVolume);
    this.musicVolume = clampVolume(s.musicVolume);
    this.sfxVolume = clampVolume(s.sfxVolume);
    this.ambienceVolume = clampVolume(s.ambienceVolume);
    this.muteWhenUnfocused = s.muteWhenUnfocused ?? false;
    this.applyLoopVolumes();

    // Hidden/backgrounded pages always stop audio. Focus events additionally
    // support the optional visible-desktop-window mute behavior. Mobile browsers
    // may emit pagehide/freeze more reliably than blur or visibilitychange.
    window.addEventListener("focus", this.syncFocusAudio);
    window.addEventListener("blur", this.syncFocusAudio);
    window.addEventListener("pagehide", this.pauseForBackground);
    window.addEventListener("pageshow", this.syncFocusAudio);
    document.addEventListener("visibilitychange", this.syncFocusAudio);
    document.addEventListener("freeze", this.pauseForBackground);

    if (this.musicOn && this.canPlay()) void this.bgm.play().catch(() => this.arm());
    if (this.ambienceOn && this.canPlay()) this.startAmbience();
  }

  // --- persistence ---------------------------------------------------------
  private read(): StoredSettings {
    try {
      return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    } catch {
      return {};
    }
  }
  private persist() {
    const data: StoredSettings = {
      master: this.masterOn,
      music: this.musicOn, sfx: this.sfxOn, ambience: this.ambienceOn,
      masterVolume: this.masterVolume,
      musicVolume: this.musicVolume, sfxVolume: this.sfxVolume,
      ambienceVolume: this.ambienceVolume,
      muteWhenUnfocused: this.muteWhenUnfocused,
    };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
    } catch {
      /* ignore quota/private-mode failures */
    }
  }

  // Some browsers block audio until the first user gesture. Arm a one-time
  // listener that resumes any looping channel the user has enabled.
  private arm() {
    if (this.armed || !this.canPlay()) return;
    this.armed = true;
    const resume = () => {
      this.armed = false;
      window.removeEventListener("pointerdown", resume);
      this.resumeFromGesture();
    };
    window.addEventListener("pointerdown", resume, { once: true });
  }

  /** Resume enabled loops synchronously from a real user gesture.
   *
   * Browsers may reject the constructor's autoplay attempt. The start screen
   * calls this from its "Click to Start" handler so playback is authorized by
   * that same gesture instead of depending on the rejection/arming race.
   */
  resumeFromGesture() {
    if (!this.canPlay()) return;
    // Unlock Web Audio from the same gesture. iOS parks a context created outside
    // one in "suspended" forever, which would leave every effect on the slow
    // media-element path for the whole session.
    void this.audioContext()?.resume().catch(() => { /* re-armed by the next gesture */ });
    if (this.musicOn && this.activeBgm().paused)
      void this.activeBgm().play().catch(() => this.arm());
    if (this.ambienceOn && this.ambBed.paused)
      void this.ambBed.play().catch(() => this.arm());
  }

  // --- music ---------------------------------------------------------------
  // The looping track that should be playing right now: the raid stage BGM while
  // a raid is up, otherwise the farm bgm.
  private activeBgm(): HTMLAudioElement {
    return this.raidBgm ?? this.bgm;
  }

  private canPlay(): boolean {
    return this.masterOn && !document.hidden &&
      (!this.muteWhenUnfocused || document.hasFocus());
  }

  // The looping channels' final element volumes: authored base level × per-channel
  // slider × the master slider. One-shots apply the same product in playOneShot.
  private applyLoopVolumes() {
    this.bgm.volume = 0.4 * this.musicVolume * this.masterVolume;
    if (this.raidBgm) this.raidBgm.volume = 0.4 * this.musicVolume * this.masterVolume;
    this.ambBed.volume = 0.25 * this.ambienceVolume * this.masterVolume;
  }

  private pauseForBackground = () => {
    this.activeBgm().pause();
    this.stopAmbience();
    for (const audio of this.oneShots) audio.pause();
    this.oneShots.clear();
    // Hand the audio hardware back too, so a backgrounded PWA isn't holding a
    // running context alongside the media session it relinquishes below.
    if (this.ctx && this.ctx.state === "running") {
      void this.ctx.suspend().catch(() => { /* already gone */ });
    }
    // Where supported, immediately relinquish the OS media session so a
    // backgrounded PWA/tab no longer presents itself as active music.
    try {
      if (typeof navigator !== "undefined" && navigator.mediaSession)
        navigator.mediaSession.playbackState = "none";
    } catch { /* Media Session is optional and browser-controlled. */ }
  };

  private syncFocusAudio = () => {
    if (!this.canPlay()) return this.pauseForBackground();
    if (this.ctx) void this.ctx.resume().catch(() => { /* needs a fresh gesture */ });
    if (this.musicOn) void this.activeBgm().play().catch(() => this.arm());
    if (this.ambienceOn) this.startAmbience();
  };

  setMuteWhenUnfocused(on: boolean) {
    this.muteWhenUnfocused = on;
    this.syncFocusAudio();
    this.persist();
  }

  // Master kill switch over every channel: off pauses all loops and suppresses
  // one-shots (via canPlay), on resumes whichever loop toggles are enabled.
  setMaster(on: boolean) {
    this.masterOn = on;
    this.syncFocusAudio();
    this.persist();
  }

  setMasterVolume(value: number) {
    this.masterVolume = clampVolume(value);
    this.applyLoopVolumes();
    this.persist();
  }

  setMusic(on: boolean) {
    this.musicOn = on;
    if (on && this.canPlay()) void this.activeBgm().play().catch(() => this.arm());
    else this.activeBgm().pause();
    this.persist();
  }

  setMusicVolume(value: number) {
    this.musicVolume = clampVolume(value);
    this.applyLoopVolumes();
    this.persist();
  }

  // Enter a raid: swap the farm bgm for the raid's looping stage BGM (`file` is a
  // filename under assets/audio/). Safe to call regardless of the music toggle —
  // it only actually plays when music is on. No-op if the same track is already up.
  enterRaid(file: string) {
    if (!file) return;
    if (this.raidFile !== file) {
      this.exitRaid(true); // tear down any prior raid track without resuming farm
      this.bgm.pause();     // farm bed steps aside for the whole raid
      const a = new Audio(A(file));
      a.loop = true;
      a.volume = 0.4 * this.musicVolume * this.masterVolume;
      this.raidBgm = a;
      this.raidFile = file;
    }
    // Decode every attack cue before the first swing lands. Combat fires these at
    // up to ~20/s; a clip that is still decoding falls back to a media element,
    // which is exactly the per-play main-thread cost raids cannot afford.
    for (const cue of FIGHT_CUE_FILES) this.buffer(A(cue));
    // Warm the short victory cue while the battle is running so the decisive tick
    // never waits on its first network fetch/decode.
    if (!this.victoryBgm) {
      this.victoryBgm = new Audio(A("winBGM.mp3"));
      this.victoryBgm.preload = "auto";
    }
    if (this.musicOn && this.canPlay()) void this.raidBgm!.play().catch(() => this.arm());
  }

  /** Replace the looping battle track with the recovered, non-looping invasion-win
   *  theme. This follows the Music toggle/volume rather than the SFX channel. */
  playRaidVictory() {
    const file = "winBGM.mp3";
    if (this.raidFile !== file) {
      this.exitRaid(true);
      this.bgm.pause();
      const audio = this.victoryBgm ?? new Audio(A(file));
      audio.currentTime = 0;
      audio.loop = false;
      audio.volume = 0.4 * this.musicVolume * this.masterVolume;
      this.raidBgm = audio;
      this.raidFile = file;
    }
    if (this.musicOn && this.canPlay()) void this.raidBgm!.play().catch(() => this.arm());
  }

  // Leave a raid: stop the raid track and hand the farm bgm back. `keepFarmPaused`
  // is used internally when immediately swapping to another raid track.
  exitRaid(keepFarmPaused = false) {
    if (this.raidBgm) {
      if (this.raidBgm === this.victoryBgm) this.victoryBgm = null;
      this.raidBgm.pause();
      this.raidBgm.src = "";
      this.raidBgm = null;
      this.raidFile = "";
    }
    if (!keepFarmPaused && this.musicOn && this.canPlay()) void this.bgm.play().catch(() => this.arm());
  }

  // --- sfx -----------------------------------------------------------------
  setSfx(on: boolean) {
    this.sfxOn = on;
    this.persist();
  }

  setSfxVolume(value: number) {
    this.sfxVolume = clampVolume(value);
    this.persist();
  }

  // Fire-and-forget one-shot (new element each time so overlaps don't cut off).
  play(name: Sfx) {
    if (!this.sfxOn || !this.canPlay()) return;
    this.playOneShot(SFX_FILE[name], SFX_VOL[name] ?? DEFAULT_VOL);
  }

  /** Play the attack cue authored for the side/type that landed a raid strike. */
  fightStrike(strike: FightStrike) {
    if (!this.sfxOn || !this.canPlay()) return;
    this.playOneShot(fightStrikeFile(strike), strike.team === "player" ? 0.55 : 0.42);
  }

  // A zombie's "Brains…" bark when it's tapped on the farm, chosen by its group.
  brain(group: string, key: string) {
    if (!this.sfxOn || !this.canPlay()) return;
    const file = brainFile(group, key);
    if (file) this.playOneShot(file, 0.7);
  }

  // Raid combat carries the actor key rather than the farm catalog group. Derive
  // the same group from that key so brain-bubble releases use the farm tap bark.
  brainForZombie(key: string) {
    this.brain(zombieGroupFromKey(key), key);
  }

  /** Supply deployed owned zombies for occasional, group-correct farm barks. */
  setZombieBarkSource(source: () => { group: string; key: string } | null) {
    this.zombieBarkSource = source;
  }

  // A placed decoration's signature tap sound (TileProperties tapSoundEffect /
  // soundID — e.g. the Liberty Bell toll, Gnome King laugh). Gated on SFX.
  tap(file: string) {
    if (!this.sfxOn || !file || !this.canPlay()) return;
    this.playOneShot(file, 0.7);
  }

  /**
   * Fire one short sound effect.
   *
   * Prefers Web Audio: a decoded AudioBuffer played through a throwaway
   * AudioBufferSourceNode costs microseconds. An HTMLAudioElement.play() instead
   * enters the browser's media-element pipeline — on iOS an AVAudioSession round
   * trip per cue, several MAIN-THREAD milliseconds each. Raids fire an attack cue
   * on nearly every 50 ms combat tick, so that per-play cost is what made frame
   * rate collapse the moment zombies started swinging.
   *
   * The element path stays as the fallback for the very first play of a clip
   * (while it decodes), for browsers without Web Audio, and while the context is
   * still suspended awaiting a user gesture. Long looping tracks (music/ambience)
   * deliberately keep using media elements, where streaming is the point.
   */
  private playOneShot(file: string, volume: number, channelVolume = this.sfxVolume) {
    const url = A(file);
    const gain = volume * channelVolume * this.masterVolume;
    if (this.playBuffered(url, gain)) return;
    this.playElement(url, gain);
  }

  /** The AudioContext, created on first use. Returns null where Web Audio is
   *  unavailable (or construction threw), which routes callers to the element
   *  fallback for the rest of the session. */
  private audioContext(): AudioContext | null {
    if (this.ctx || this.ctxUnavailable) return this.ctx;
    const Ctor = typeof window !== "undefined"
      ? (window as unknown as {
          AudioContext?: typeof AudioContext;
          webkitAudioContext?: typeof AudioContext;
        })
      : undefined;
    const Impl = Ctor?.AudioContext ?? Ctor?.webkitAudioContext;
    if (!Impl) {
      this.ctxUnavailable = true;
      return null;
    }
    try {
      this.ctx = new Impl();
    } catch {
      this.ctxUnavailable = true; // blocked or out of hardware contexts
    }
    return this.ctx;
  }

  /** Decoded clip for `url`, kicking off a one-time fetch+decode when missing.
   *  Returns undefined until that lands, so the caller falls back this once. */
  private buffer(url: string): AudioBuffer | undefined {
    const ready = this.buffers.get(url);
    if (ready) return ready;
    const ctx = this.audioContext();
    if (!ctx || this.decoding.has(url)) return undefined;
    this.decoding.add(url);
    void fetch(url)
      .then((response) => response.arrayBuffer())
      .then((data) => ctx.decodeAudioData(data))
      .then((decoded) => { this.buffers.set(url, decoded); })
      // A failed fetch/decode simply leaves this clip on the element path; it must
      // never reject into the console on every subsequent cue, so drop it and let
      // the next call retry.
      .catch(() => { /* stays on the element fallback */ })
      .finally(() => { this.decoding.delete(url); });
    return undefined;
  }

  /** Play through Web Audio. Returns false when that isn't possible yet, meaning
   *  the caller should use the media element for this one cue. */
  private playBuffered(url: string, gain: number): boolean {
    const ctx = this.audioContext();
    if (!ctx) return false;
    const buffer = this.buffer(url);
    if (!buffer) return false;
    // Autoplay policy parks a context created outside a gesture in "suspended".
    // Ask once and fall back meanwhile; resumeFromGesture does the real unlock.
    if (ctx.state !== "running") {
      void ctx.resume().catch(() => { /* still gesture-locked */ });
      return false;
    }
    if (this.voices >= MAX_VOICES) return true; // drop, don't queue: it's inaudible anyway
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const amp = ctx.createGain();
    amp.gain.value = gain;
    source.connect(amp).connect(ctx.destination);
    this.voices++;
    source.onended = () => {
      this.voices--;
      source.disconnect();
      amp.disconnect();
    };
    source.start();
    return true;
  }

  /** Media-element fallback. Pooled per file, because a fresh `new Audio()` per cue
   *  makes iOS re-enter its media-loading pipeline every time. */
  private playElement(url: string, gain: number) {
    // Elements are only reclaimed when playback reports back; refuse to allocate
    // past the cap so a browser that never fires `ended` can't accumulate media
    // resources for the whole fight.
    if (this.oneShots.size >= MAX_VOICES && !this.oneShotPool.get(url)?.length) return;
    const a = this.oneShotPool.get(url)?.pop() ?? new Audio(url);
    a.volume = gain;
    this.oneShots.add(a);
    let settled = false;
    const done = () => {
      if (settled) return; // `ended` and a late `error` must not pool twice
      settled = true;
      clearTimeout(reclaim);
      this.oneShots.delete(a);
      const pool = this.oneShotPool.get(url) ?? [];
      if (pool.length < 6) {
        pool.push(a);
        this.oneShotPool.set(url, pool);
      }
    };
    const reclaim = setTimeout(done, ONE_SHOT_RECLAIM_MS);
    // Property handlers (not addEventListener) so reuse replaces the previous
    // play's callbacks instead of stacking them.
    a.onended = done;
    a.onerror = done;
    if (a.currentTime > 0) a.currentTime = 0; // reused element: rewind
    void a.play().catch(done);
  }

  // --- ambience ------------------------------------------------------------
  setAmbience(on: boolean) {
    this.ambienceOn = on;
    if (on && this.canPlay()) this.startAmbience();
    else this.stopAmbience();
    this.persist();
  }

  setAmbienceVolume(value: number) {
    this.ambienceVolume = clampVolume(value);
    this.applyLoopVolumes();
    this.persist();
  }

  private startAmbience() {
    void this.ambBed.play().catch(() => this.arm());
    this.scheduleAmbienceOneShot();
  }

  private stopAmbience() {
    this.ambBed.pause();
    if (this.ambTimer !== null) {
      clearTimeout(this.ambTimer);
      this.ambTimer = null;
    }
  }

  private scheduleAmbienceOneShot() {
    if (this.ambTimer !== null) clearTimeout(this.ambTimer);
    const delay = AMBIENCE_MIN_MS + Math.random() * (AMBIENCE_MAX_MS - AMBIENCE_MIN_MS);
    this.ambTimer = setTimeout(() => {
      if (this.ambienceOn && this.canPlay()) {
        const zombie = Math.random() < 0.25 ? this.zombieBarkSource?.() : null;
        const bark = zombie ? brainFile(zombie.group, zombie.key) : null;
        if (bark) this.playOneShot(bark, 0.45, this.ambienceVolume);
        else {
          const file = AMBIENCE_ONESHOTS[Math.floor(Math.random() * AMBIENCE_ONESHOTS.length)];
          this.playOneShot(file, 0.3, this.ambienceVolume);
        }
        this.scheduleAmbienceOneShot();
      }
    }, delay);
  }
}
