// gateway 与 settings 公开给集成测试（tests/unit_tests.rs）访问；tray 仅内部使用。
pub mod gateway;
pub mod settings;
mod tray;

use std::sync::Mutex;
use tauri::Manager;

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
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
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
            gateway::autostart_get,
            gateway::autostart_set,
        ])
        .setup(|app| {
            tray::create_tray(app.handle())?;
            gateway::start_status_loop(app.handle().clone());
            // 启动即拉网关：与 ag-relay 一致的开箱即用体验。
            // 外部实例会被接管；失败（如脚本未配置）只反映在状态里，不阻塞窗口。
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(800)).await;
                let _ = gateway::do_start(&handle).await;
            });
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
