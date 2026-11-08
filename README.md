# Codex Compat Desktop

为 [codex-api-compat](../codex-api-compat) 做的桌面管理壳——参考 [ag-relay](../ag-relay) 的产品形态，给单文件代理补上窗口化仪表盘、系统托盘、单实例锁与退出排空。

**壳只管进程生命周期，网关逻辑零改动。** 上游管理、重试参数、请求净化、SSE 语义全部仍由 `codex-api-compat/server.mjs` 承担；本项目的 Rust 壳负责把 node 子进程拉起来、盯住健康状态、优雅停掉。

```
┌──────────────────────────────────────────────┐
│  React 仪表盘（总览 / 请求 / 设置 三页）        │
│      │ invoke()                ▲ event 2s    │
│      ▼                        │             │
│  Rust 壳 (Tauri 2)             │             │
│  ├─ gateway.rs   spawn/健康轮询/优雅停止/接管  │
│  ├─ tray.rs      托盘菜单：启停/重启/退出排空   │
│  ├─ settings.rs  node 路径/脚本路径/端口 持久化 │
│  └─ single-instance  二次启动唤起已有窗口      │
│      │ spawn node                            │
│      ▼                                       │
│  codex-api-compat/server.mjs（零改动，:57330） │
└──────────────────────────────────────────────┘
```

## 功能

**总览页**：运行状态卡（含外部实例徽标）、上游、运行时长、请求总数、内部重试分布、P50/P95 延迟、净化统计、状态码分布；启动 / 停止 / 重启 / 打开日志目录。

**请求页**：最近 100 条请求（含重试事件），时间 / 类型 / 路径 / 状态 / 耗时 / 请求体 / 重试原因 / 净化计数，重试行高亮。

**设置页**：
- 上游管理（增删改 / 激活 / 探活，与内置面板同契约）
- 重试参数热更（间隔 / 上限 / 抖动）
- 诊断日志开关与清空
- 壳设置：node 路径、`server.mjs` 路径、本地端口（下次启动生效）

**桌面能力**：
- **系统托盘**：左键切换面板显隐；右键启动 / 停止 / 重启网关、打开日志目录、退出
- **单实例锁**：重复启动唤起已有窗口
- **关窗即隐藏**：网关继续服务，真正退出走托盘菜单
- **退出排空**：退出先走网关自身的 `/__compat/control stop` 优雅关闭（等最多 6 秒），超时强杀自有子进程，不留孤儿 node
- **外部实例接管**：端口上已有手动启动的代理时，壳接管显示（黄色徽标）而不重复拉起；`.env` 播种逻辑与 `start-proxy.ps1` 对齐

## 开发与构建

前置：Node 22+、Rust（GNU 工具链已验证）、WebView2。

```sh
npm install
npm run tauri dev        # 开发调试
npm run tauri build      # 产出 NSIS 安装包
cargo build --release    # 仅出裸 exe（约 24MB），免安装器
```

> **MinGW 工具链注意**：本机 Rust 为 `x86_64-pc-windows-gnu` 时，`[lib] crate-type` **不能含 `cdylib`**——否则 ld 报 `export ordinal too large`（Tauri 符号数超 65535 导出上限）。本仓库已固定为 `["rlib"]`。

## 安全边界

- 前端对网关控制面的所有 HTTP 都经 Rust `proxy_request` 命令转发（绕开 WebView CORS），且**只放行 `/__compat/` 保留命名空间**；
- 写操作令牌由壳从 `/__compat/panel` 提取（回环专属），不落盘、不进日志；
- 停止 / 重启不走网关的 detached 自重启路径，保证壳始终拥有子进程句柄；
- 诊断日志、配置文件、令牌语义与 codex-api-compat 原有设计完全一致。

## 已知边界

- 「退出排空」采用网关自带的 stop 语义（close + closeAllConnections），在途流会被上游项目按其设计终止——这是 codex-api-compat 的既定行为，壳不越权改动；
- node 不随包分发（依赖系统 PATH），如需离线分发可仿照 ag-relay 打包 node.exe；
- 托盘图标取自应用默认图标；未做开机自启（按需求裁剪）。

## License

MIT。
