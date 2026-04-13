mod commands;

use commands::{tools, materials, files, auth, serial, image_processing};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(serial::SerialState::new())
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
            serial::serial_list_ports,
            serial::serial_connect,
            serial::serial_disconnect,
            serial::serial_send,
            serial::serial_send_gcode,
            serial::serial_cancel_send,
            image_processing::process_image_for_laser,
            image_processing::process_image_base64_for_laser,
            image_processing::read_raster_pixels,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
