use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// 桌面壳自身的设置。网关业务配置（上游/重试/日志）仍归
/// 网关的 control.json 管，这里只管"怎么把网关拉起来"。
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ShellSettings {
    pub node_path: String,
    pub script_path: String,
    pub port: u16,
}

impl Default for ShellSettings {
    fn default() -> Self {
        Self {
            node_path: "node".to_string(),
            script_path: String::new(),
            port: 57330,
        }
    }
}

pub fn app_data_dir() -> PathBuf {
    let base = std::env::var("APPDATA")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."));
    base.join("codex-compat-desktop")
}

pub fn settings_file() -> PathBuf {
    app_data_dir().join("settings.json")
}

/// 按启发式顺序寻找 codex-api-compat/server.mjs：
/// 优先当前工作目录与 exe 所在目录的兄弟仓库。
fn default_script() -> String {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("../codex-api-compat/server.mjs"));
        candidates.push(cwd.join("codex-api-compat/server.mjs"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("../codex-api-compat/server.mjs"));
            candidates.push(dir.join("codex-api-compat/server.mjs"));
        }
    }
    for candidate in candidates {
        if candidate.is_file() {
            return candidate.to_string_lossy().to_string();
        }
    }
    String::new()
}

pub fn load() -> ShellSettings {
    let mut value = ShellSettings::default();
    if let Ok(text) = fs::read_to_string(settings_file()) {
        if let Ok(parsed) = serde_json::from_str::<ShellSettings>(&text) {
            value = parsed;
        }
    }
    if value.script_path.trim().is_empty() {
        value.script_path = default_script();
    }
    if value.node_path.trim().is_empty() {
        value.node_path = "node".to_string();
    }
    if value.port == 0 {
        value.port = 57330;
    }
    value
}

pub fn save(value: &ShellSettings) -> Result<ShellSettings, String> {
    let mut value = value.clone();
    if value.script_path.trim().is_empty() {
        value.script_path = default_script();
    }
    if value.node_path.trim().is_empty() {
        value.node_path = "node".to_string();
    }
    if !(1..=65535).contains(&value.port) {
        return Err("端口必须在 1 到 65535 之间。".to_string());
    }
    let dir = app_data_dir();
    fs::create_dir_all(&dir).map_err(|error| format!("无法创建设置目录：{error}"))?;
    let text = serde_json::to_string_pretty(&value).map_err(|error| error.to_string())?;
    // 临时文件 + rename，进程崩溃不会截断设置。
    let temp = dir.join("settings.json.tmp");
    fs::write(&temp, text).map_err(|error| format!("无法写入设置：{error}"))?;
    fs::rename(&temp, settings_file()).map_err(|error| format!("无法保存设置：{error}"))?;
    Ok(value)
}
