mod commands;

use commands::{tools, materials, files, auth};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            tools::get_tools,
            tools::save_tool,
            tools::delete_tool,
            materials::get_materials,
            materials::save_material,
            materials::delete_material,
            files::save_project,
            files::load_project,
            auth::authenticate,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
