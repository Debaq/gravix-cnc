mod commands;
mod job_queue;
mod json_store;
mod license;
mod mdns;
mod paths;
mod shared_state;
mod web_server;
mod workspace;

use commands::{auth, files, image_processing, license_cmd, machines, materials, serial, tools, web_server_cmd, workspace_cmd};
use shared_state::AppState;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU16};
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::Notify;

#[tauri::command]
async fn close_splashscreen(app: tauri::AppHandle) {
    if let Some(splash) = app.get_webview_window("splashscreen") {
        let _ = splash.close();
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
                .join("data");

            // En dev: ../dist (relativo a src-tauri/), en producción: resource_dir
            let dist_dir = if cfg!(debug_assertions) {
                PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist")
            } else {
                app.path()
                    .resource_dir()
                    .unwrap_or_else(|_| PathBuf::from("../dist"))
            };

            let (event_tx, _) = tokio::sync::broadcast::channel(256);

            let shared = Arc::new(AppState {
                serial: Arc::new(serial::SerialState::new()),
                job_queue: job_queue::JobQueue::new(&data_dir),
                data_dir,
                dist_dir,
                event_tx,
                server_running: AtomicBool::new(false),
                server_port: AtomicU16::new(0),
                server_shutdown: Notify::new(),
            });

            app.manage(shared.serial.clone());
            app.manage(shared.clone());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            close_splashscreen,
            workspace_cmd::get_workspace,
            workspace_cmd::pick_workspace,
            workspace_cmd::get_recent_workspaces,
            workspace_cmd::set_workspace,
            workspace_cmd::list_projects,
            workspace_cmd::save_gravix_project,
            workspace_cmd::load_gravix_project,
            workspace_cmd::delete_gravix_project,
            workspace_cmd::backup_gravix_project,
            tools::get_tools,
            tools::save_tool,
            tools::delete_tool,
            materials::get_materials,
            materials::save_material,
            materials::delete_material,
            machines::get_machines,
            machines::save_machines,
            files::save_project,
            files::load_project,
            auth::authenticate,
            serial::serial_list_ports,
            serial::serial_connect,
            serial::serial_disconnect,
            serial::serial_send,
            serial::serial_send_gcode,
            serial::serial_cancel_send,
            serial::serial_realtime,
            serial::serial_check_bounds,
            serial::serial_get_status,
            image_processing::process_image_for_laser,
            image_processing::process_image_base64_for_laser,
            image_processing::read_raster_pixels,
            web_server_cmd::get_server_status,
            web_server_cmd::start_web_server,
            web_server_cmd::stop_web_server,
            web_server_cmd::check_port,
            web_server_cmd::get_local_ips,
            web_server_cmd::check_firewall,
            license_cmd::activate_license,
            license_cmd::get_license_status,
            license_cmd::remove_license,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
