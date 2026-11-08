use serde::Serialize;
use serde_json::json;
use std::fs;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

use crate::settings::{self, ShellSettings};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 推送给前端的网关状态快照。
#[derive(Serialize, Clone, Debug)]
pub struct GatewayStatus {
    pub running: bool,
    pub external: bool,
    pub pid: Option<u32>,
    pub token_ready: bool,
    pub base: String,
    pub node_path: String,
    pub script_path: String,
    pub uptime_ms: Option<u64>,
    pub upstream: Option<String>,
}

/// 网关进程管理器。桌面壳直接拥有子进程；
/// 若端口上已有外部实例（例如手动跑过 start.bat），启动时会接管显示而不重复拉起。
pub struct GatewayManager {
    child: Option<Child>,
    external: bool,
    pid: Option<u32>,
    token: Option<String>,
    base: String,
    port: u16,
    node_path: String,
    script_path: PathBuf,
    settings_file: PathBuf,
    client: reqwest::Client,
}

impl GatewayManager {
    pub fn new() -> Self {
        let settings = settings::load();
        let base = format!("http://127.0.0.1:{}", settings.port);
        Self {
            child: None,
            external: false,
            pid: None,
            token: None,
            base,
            port: settings.port,
            node_path: settings.node_path.clone(),
            script_path: PathBuf::from(&settings.script_path),
            settings_file: settings::settings_file(),
            client: reqwest::Client::new(),
        }
    }

    /// 应用壳设置；端口与 base 仅在网关未运行时切换，避免打断在途请求。
    pub fn apply_settings(&mut self, value: &ShellSettings) {
        self.node_path = value.node_path.clone();
        self.script_path = PathBuf::from(&value.script_path);
        if !self.is_running() {
            self.port = value.port;
            self.base = format!("http://127.0.0.1:{}", self.port);
        }
    }

    pub fn is_running(&self) -> bool {
        self.child.is_some() || self.external
    }

    /// 检查子进程是否已退出；返回 true 表示状态发生迁移（运行 -> 停止）。
    pub fn refresh(&mut self) -> bool {
        if let Some(child) = self.child.as_mut() {
            match child.try_wait() {
                Ok(Some(_)) => {
                    self.child = None;
                    self.pid = None;
                    self.token = None;
                    self.external = false;
                    return true;
                }
                _ => return false,
            }
        }
        false
    }

    /// 结束自有子进程（外部实例不受影响）。
    fn kill_owned(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        self.pid = None;
    }

    /// 完全重置状态（停止后调用）。
    fn reset(&mut self) {
        self.kill_owned();
        self.external = false;
        self.token = None;
    }

    fn spawn_gateway(&mut self) -> Result<(), String> {
        let script = self.script_path.clone();
        if !script.is_file() {
            return Err(format!(
                "找不到网关脚本：{}。请在设置页填写 server.mjs 的完整路径。",
                script.display()
            ));
        }
        let mut command = Command::new(&self.node_path);
        command.arg(&script);
        // 与 start-proxy.ps1 对齐：读取脚本目录的 .env 播种初始配置，不覆盖系统环境。
        for (key, value) in read_dotenv(script.parent()) {
            if std::env::var_os(&key).is_none() {
                command.env(&key, value);
            }
        }
        command.stdin(Stdio::null()).stdout(Stdio::null());
        let stderr_target = self
            .settings_file
            .parent()
            .map(|dir| dir.join("gateway-stderr.log"));
        match stderr_target {
            Some(path) => match fs::File::create(&path) {
                Ok(file) => {
                    command.stderr(Stdio::from(file));
                }
                Err(_) => {
                    command.stderr(Stdio::null());
                }
            },
            None => {
                command.stderr(Stdio::null());
            }
        }
        #[cfg(windows)]
        command.creation_flags(CREATE_NO_WINDOW);
        match command.spawn() {
            Ok(child) => {
                self.pid = Some(child.id());
                self.child = Some(child);
                self.external = false;
                self.token = None;
                Ok(())
            }
            Err(error) => Err(format!("无法启动 node（{}）：{error}", self.node_path)),
        }
    }
}

fn lock_manager<'a>(app: &'a AppHandle) -> MutexGuard<'a, GatewayManager> {
    app.state::<Mutex<GatewayManager>>().inner().lock().unwrap()
}

fn build_status(mgr: &GatewayManager, health: Option<&serde_json::Value>) -> GatewayStatus {
    let running = mgr.is_running();
    let mut uptime_ms = None;
    let mut upstream = None;
    let mut reported_pid = None;
    if let Some(value) = health {
        uptime_ms = value.get("uptimeMs").and_then(|item| item.as_u64());
        upstream = value
            .get("upstream")
            .and_then(|item| item.as_str())
            .map(|text| text.to_string());
        reported_pid = value
            .get("pid")
            .and_then(|item| item.as_u64())
            .map(|pid| pid as u32);
    }
    let pid = if running {
        mgr.pid.or(reported_pid)
    } else {
        None
    };
    GatewayStatus {
        running,
        external: mgr.external && running,
        pid,
        token_ready: mgr.token.is_some(),
        base: mgr.base.clone(),
        node_path: mgr.node_path.clone(),
        script_path: mgr.script_path.display().to_string(),
        uptime_ms,
        upstream,
    }
}

fn emit_status(app: &AppHandle, mgr: &GatewayManager, health: Option<&serde_json::Value>) {
    let status = build_status(mgr, health);
    let _ = app.emit("gateway:status", &status);
}

async fn health_once(client: &reqwest::Client, base: &str) -> Option<serde_json::Value> {
    let url = format!("{base}/__compat/health");
    let response = client
        .get(url)
        .timeout(Duration::from_secs(2))
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    response.json::<serde_json::Value>().await.ok()
}

/// 从面板 HTML 提取控制令牌（`const TOKEN = "..."`，32 位 base64url）。
/// 面板仅对回环开放；壳与网关同机，属合法消费方。
async fn fetch_control_token(client: &reqwest::Client, base: &str) -> Option<String> {
    const MARK: &str = "const TOKEN = \"";
    let response = client
        .get(format!("{base}/__compat/panel"))
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .ok()?;
    let text = response.text().await.ok()?;
    let start = text.find(MARK)? + MARK.len();
    let rest = &text[start..];
    let end = rest.find('"')?;
    let token = &rest[..end];
    let valid = token.len() == 32
        && token
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    valid.then(|| token.to_string())
}

fn read_dotenv(dir: Option<&std::path::Path>) -> Vec<(String, String)> {
    let Some(dir) = dir else {
        return Vec::new();
    };
    let Ok(text) = fs::read_to_string(dir.join(".env")) else {
        return Vec::new();
    };
    let mut pairs = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim().to_string();
        let mut value = value.trim().to_string();
        if value.len() >= 2 && value.starts_with('"') && value.ends_with('"') {
            value = value[1..value.len() - 1].to_string();
        }
        if !key.is_empty() {
            pairs.push((key, value));
        }
    }
    pairs
}

fn deadline_after(seconds: u64) -> Instant {
    Instant::now() + Duration::from_secs(seconds)
}

/// 启动网关：spawn 子进程 -> 轮询 /__compat/health -> 提取控制令牌。
/// 若端口已有外部实例，子进程会因端口占用退出，此时接管显示外部实例。
pub async fn do_start(app: &AppHandle) -> Result<GatewayStatus, String> {
    {
        let mut mgr = lock_manager(app);
        mgr.refresh();
        if mgr.is_running() {
            return Ok(build_status(&mgr, None));
        }
        // 启动前重读壳设置，确保重启能应用最新配置。
        let latest = settings::load();
        mgr.apply_settings(&latest);
        mgr.spawn_gateway()?;
    }
    let (client, base) = {
        let mgr = lock_manager(app);
        (mgr.client.clone(), mgr.base.clone())
    };
    let deadline = deadline_after(15);
    loop {
        tokio::time::sleep(Duration::from_millis(400)).await;
        if let Some(health) = health_once(&client, &base).await {
            let token = fetch_control_token(&client, &base).await;
            let status = {
                let mut mgr = lock_manager(app);
                if mgr.child.is_none() {
                    mgr.external = true;
                }
                if mgr.token.is_none() {
                    mgr.token = token;
                }
                emit_status(app, &mgr, Some(&health));
                build_status(&mgr, Some(&health))
            };
            return Ok(status);
        }
        {
            let mut mgr = lock_manager(app);
            mgr.refresh();
        }
        if Instant::now() >= deadline {
            let mut mgr = lock_manager(app);
            mgr.reset();
            emit_status(app, &mgr, None);
            return Err(
                "网关启动超时：15 秒内未收到 /__compat/health 响应。请查看壳数据目录中的 gateway-stderr.log。"
                    .to_string(),
            );
        }
    }
}

/// 停止网关：先走网关自身的控制端点优雅关闭，等待最多 6 秒，超时强杀自有子进程。
pub async fn do_stop(app: &AppHandle) -> Result<GatewayStatus, String> {
    let (client, base, token, running) = {
        let mut mgr = lock_manager(app);
        mgr.refresh();
        let running = mgr.is_running();
        (
            mgr.client.clone(),
            mgr.base.clone(),
            mgr.token.clone(),
            running,
        )
    };
    if !running {
        let mgr = lock_manager(app);
        return Ok(build_status(&mgr, None));
    }
    let mut request = client
        .post(format!("{base}/__compat/control"))
        .json(&json!({ "action": "stop" }))
        .timeout(Duration::from_secs(3));
    if let Some(value) = &token {
        request = request.header("x-compat-token", value);
    }
    let _ = request.send().await;

    let deadline = deadline_after(6);
    loop {
        tokio::time::sleep(Duration::from_millis(200)).await;
        {
            let mut mgr = lock_manager(app);
            if mgr.refresh() {
                break;
            }
        }
        if Instant::now() >= deadline {
            break;
        }
    }
    let still_alive = health_once(&client, &base).await.is_some();
    let status = {
        let mut mgr = lock_manager(app);
        if still_alive {
            mgr.external = true;
        } else {
            mgr.reset();
        }
        emit_status(app, &mgr, None);
        build_status(&mgr, None)
    };
    if still_alive {
        return Err("停止请求已发送，但网关仍在运行（外部实例未响应）。".to_string());
    }
    Ok(status)
}

pub async fn do_restart(app: &AppHandle) -> Result<GatewayStatus, String> {
    let _ = do_stop(app).await;
    do_start(app).await
}

/// 每 2 秒巡检：检测子进程退出 / 外部实例消失，并推送带 uptime 的状态。
pub fn start_status_loop(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(2)).await;
            let (client, base) = {
                let mut mgr = lock_manager(&app);
                if mgr.refresh() {
                    emit_status(&app, &mgr, None);
                }
                if !mgr.is_running() {
                    continue;
                }
                (mgr.client.clone(), mgr.base.clone())
            };
            let health = health_once(&client, &base).await;
            let mut mgr = lock_manager(&app);
            match health {
                Some(value) => emit_status(&app, &mgr, Some(&value)),
                None => {
                    if mgr.child.is_some() {
                        // 子进程还在启动中，尚未监听端口。
                        emit_status(&app, &mgr, None);
                    } else if mgr.external {
                        mgr.external = false;
                        mgr.token = None;
                        emit_status(&app, &mgr, None);
                    }
                }
            }
        }
    });
}

// ---------------- Tauri 命令 ----------------

#[tauri::command]
pub async fn gateway_start(app: AppHandle) -> Result<GatewayStatus, String> {
    do_start(&app).await
}

#[tauri::command]
pub async fn gateway_stop(app: AppHandle) -> Result<GatewayStatus, String> {
    do_stop(&app).await
}

#[tauri::command]
pub async fn gateway_restart(app: AppHandle) -> Result<GatewayStatus, String> {
    do_restart(&app).await
}

#[tauri::command]
pub fn gateway_status(app: AppHandle) -> GatewayStatus {
    let mut mgr = lock_manager(&app);
    mgr.refresh();
    build_status(&mgr, None)
}

/// 代理前端对网关控制面的访问：绕开 WebView 的 CORS，
/// 并只放行 /__compat/ 保留命名空间。写操作自动附加控制令牌。
#[tauri::command]
pub async fn proxy_request(
    app: AppHandle,
    method: String,
    path: String,
    body: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    if !path.starts_with("/__compat/") {
        return Err("出于安全考虑，仅允许访问 /__compat/ 命名空间。".to_string());
    }
    let (client, base, token) = {
        let mgr = lock_manager(&app);
        (mgr.client.clone(), mgr.base.clone(), mgr.token.clone())
    };
    let url = format!("{base}{path}");
    let mut request = match method.to_ascii_uppercase().as_str() {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        other => return Err(format!("不支持的方法：{other}")),
    };
    if let Some(payload) = &body {
        request = request.json(payload);
    }
    if let Some(value) = &token {
        request = request.header("x-compat-token", value);
    }
    let response = request
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|error| format!("请求网关失败：{error}"))?;
    let status = response.status();
    let text = response.text().await.map_err(|error| error.to_string())?;
    let parsed: serde_json::Value =
        serde_json::from_str(&text).unwrap_or(serde_json::Value::String(text));
    if !status.is_success() {
        return Err(format!("网关返回 HTTP {}：{parsed}", status.as_u16()));
    }
    Ok(parsed)
}

#[tauri::command]
pub fn shell_settings_get() -> ShellSettings {
    settings::load()
}

#[tauri::command]
pub fn shell_settings_set(
    app: AppHandle,
    settings: ShellSettings,
) -> Result<ShellSettings, String> {
    let saved = settings::save(&settings)?;
    let mut mgr = lock_manager(&app);
    mgr.apply_settings(&saved);
    Ok(saved)
}

#[tauri::command]
pub fn open_log_dir() -> Result<(), String> {
    let home = std::env::var("USERPROFILE").map_err(|_| "无法定位用户目录。".to_string())?;
    let dir = PathBuf::from(home).join(".codex").join("api-compat");
    let _ = fs::create_dir_all(&dir);
    open_in_explorer(&dir)
}

#[tauri::command]
pub fn open_settings_dir() -> Result<(), String> {
    let dir = settings::app_data_dir();
    let _ = fs::create_dir_all(&dir);
    open_in_explorer(&dir)
}

fn open_in_explorer(path: &PathBuf) -> Result<(), String> {
    #[cfg(windows)]
    {
        Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|error| format!("无法打开资源管理器：{error}"))?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err("仅在 Windows 上支持打开目录。".to_string())
    }
}
