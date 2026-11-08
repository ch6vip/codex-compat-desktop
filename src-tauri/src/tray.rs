use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

use crate::gateway;

pub fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示面板", true, None::<&str>)?;
    let start = MenuItem::with_id(app, "start", "启动网关", true, None::<&str>)?;
    let stop = MenuItem::with_id(app, "stop", "停止网关", true, None::<&str>)?;
    let restart = MenuItem::with_id(app, "restart", "重启网关", true, None::<&str>)?;
    let logs = MenuItem::with_id(app, "logs", "打开日志目录", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出（自动停止网关）", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &show,
            &PredefinedMenuItem::separator(app)?,
            &start,
            &stop,
            &restart,
            &PredefinedMenuItem::separator(app)?,
            &logs,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let mut builder = TrayIconBuilder::with_id("main-tray")
        .tooltip("Codex API Compat 桌面台")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(handle_menu)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    builder.build(app)?;
    Ok(())
}

fn toggle_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let visible = window.is_visible().unwrap_or(false);
        let focused = window.is_focused().unwrap_or(false);
        if visible && focused {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }
}

fn handle_menu(app: &AppHandle, event: MenuEvent) {
    match event.id().as_ref() {
        "show" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }
        "start" => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let _ = gateway::do_start(&app).await;
            });
        }
        "stop" => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let _ = gateway::do_stop(&app).await;
            });
        }
        "restart" => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let _ = gateway::do_restart(&app).await;
            });
        }
        "logs" => {
            let _ = gateway::open_log_dir();
        }
        "quit" => {
            // 退出排空：先优雅停掉网关（最多 6 秒 + 强杀兜底），再退出应用。
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let _ = gateway::do_stop(&app).await;
                app.exit(0);
            });
        }
        _ => {}
    }
}
