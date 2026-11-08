mod gateway;
mod settings;
mod tray;

use std::sync::Mutex;
use tauri::{Manager};

pub fn run() {
    let manager = gateway::GatewayManager::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .manage(Mutex::new(manager))
        .invoke_handler(tauri::generate_handler![
            gateway::gateway_start,
            gateway::gateway_stop,
            gateway::gateway_restart,
            gateway::gateway_status,
            gateway::proxy_request,
            gateway::shell_settings_get,
            gateway::shell_settings_set,
            gateway::open_log_dir,
            gateway::open_settings_dir,
        ])
        .setup(|app| {
            tray::create_tray(app.handle())?;
            gateway::start_status_loop(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // 关窗 = 隐藏到托盘，网关继续服务；真正退出走托盘菜单。
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
