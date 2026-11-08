//! 桌面壳单元测试。
//! 集成测试目标会链接 tests.manifest.xml（声明 Common-Controls v6），
//! 避免 lib 内联测试因缺 manifest 在加载期崩 STATUS_ENTRYPOINT_NOT_FOUND。

use codex_compat_desktop_lib::gateway::{parse_control_token, read_dotenv};
use codex_compat_desktop_lib::settings::{self, ShellSettings};

// ---------------- 控制令牌解析 ----------------

const VALID_TOKEN: &str = "CorYHLGx_RGSgvs-q7AksdMbdMi9FQMB";

#[test]
fn parse_control_token_accepts_valid_base64url() {
    let html = format!("const TOKEN = \"{VALID_TOKEN}\";");
    assert_eq!(parse_control_token(&html).as_deref(), Some(VALID_TOKEN));
}

#[test]
fn parse_control_token_rejects_wrong_length() {
    assert_eq!(parse_control_token("const TOKEN = \"short\";"), None);
}

#[test]
fn parse_control_token_rejects_invalid_chars() {
    let token = "a".repeat(31) + "%";
    let html = format!("const TOKEN = \"{token}\";");
    assert_eq!(parse_control_token(&html), None);
}

#[test]
fn parse_control_token_rejects_missing_marker() {
    assert_eq!(parse_control_token("<html></html>"), None);
}

// ---------------- .env 播种解析 ----------------

#[test]
fn read_dotenv_parses_comments_quotes_and_ignores_garbage() {
    let dir = std::env::temp_dir().join(format!("ccdesktop-dotenv-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join(".env"),
        "# 注释\nCODEX_COMPAT_UPSTREAM=\"https://agentrouter.org\"\n\nCODEX_COMPAT_PORT = 57330\nbroken line\n=empty\n",
    )
    .unwrap();
    let pairs = read_dotenv(Some(&dir));
    assert_eq!(
        pairs[0],
        (
            "CODEX_COMPAT_UPSTREAM".to_string(),
            "https://agentrouter.org".to_string()
        )
    );
    assert_eq!(pairs[1], ("CODEX_COMPAT_PORT".to_string(), "57330".to_string()));
    assert_eq!(pairs.len(), 2);
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn read_dotenv_returns_empty_without_file() {
    let dir = std::env::temp_dir().join(format!("ccdotenv-none-{}", std::process::id()));
    assert!(read_dotenv(Some(&dir)).is_empty());
}

// ---------------- 壳设置持久化 ----------------
// 测试进程共享环境变量，APPDATA 相关断言合并进单个测试函数避免竞态。

#[test]
fn settings_round_trip_defaults_and_validation() {
    let original = std::env::var("APPDATA").ok();
    let dir = std::env::temp_dir().join(format!("ccdesktop-settings-{}", std::process::id()));
    std::fs::remove_dir_all(&dir).ok();
    std::env::set_var("APPDATA", &dir);

    // 无文件时给默认值
    let loaded = settings::load();
    assert_eq!(loaded.port, 57330);
    assert_eq!(loaded.node_path, "node");

    // 保存 -> 加载 往返一致
    let value = ShellSettings {
        node_path: "C:\\node\\node.exe".to_string(),
        script_path: "D:\\x\\server.mjs".to_string(),
        port: 59000,
    };
    let saved = settings::save(&value).unwrap();
    assert_eq!(saved, value);
    assert_eq!(settings::load(), value);
    assert!(settings::exists());

    // 损坏文件回退默认，不阻塞启动
    std::fs::write(settings::settings_file(), "{broken").unwrap();
    let fallback = settings::load();
    assert_eq!(fallback.port, 57330);

    // 非法端口被拒绝
    let invalid = ShellSettings {
        node_path: "node".to_string(),
        script_path: "server.mjs".to_string(),
        port: 0,
    };
    assert!(settings::save(&invalid).is_err());

    std::fs::remove_dir_all(&dir).ok();
    if let Some(appdata) = original {
        std::env::set_var("APPDATA", appdata);
    }
}
