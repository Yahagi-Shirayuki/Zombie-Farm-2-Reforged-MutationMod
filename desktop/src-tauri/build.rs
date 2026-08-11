fn main() {
    // Reads tauri.conf.json, embeds the Windows icon and version resource, and
    // generates the context that tauri::generate_context!() expands to.
    tauri_build::build()
}
