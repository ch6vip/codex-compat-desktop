import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "./api";
import type { GatewayStatus, StatsSnapshot } from "./types";
import OverviewPage from "./pages/OverviewPage";
import RequestsPage from "./pages/RequestsPage";
import SettingsPage from "./pages/SettingsPage";

type Tab = "overview" | "requests" | "settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "总览" },
  { id: "requests", label: "请求" },
  { id: "settings", label: "设置" },
];

export default function App() {
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [stats, setStats] = useState<StatsSnapshot | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const runningRef = useRef(false);

  const report = useCallback((text: string, error = false) => {
    setNotice({ text, error });
    window.setTimeout(() => setNotice(null), error ? 8000 : 4000);
  }, []);

  // 网关状态事件（Rust 每 2 秒推送 + 操作后立即推送）
  useEffect(() => {
    const unlisten = listen<GatewayStatus>("gateway:status", (event) => {
      setStatus(event.payload);
      runningRef.current = event.payload.running;
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // 初始状态
  useEffect(() => {
    api.gatewayStatus().then(setStatus).catch(() => undefined);
  }, []);

  // 运行中每 3 秒拉取一次统计
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      if (runningRef.current) {
        try {
          const next = await api.stats();
          if (!stopped) setStats(next);
        } catch {
          if (!stopped) setStats(null);
        }
      } else if (!stopped) {
        setStats(null);
      }
    };
    tick();
    const timer = window.setInterval(tick, 3000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, []);

  const notify = useCallback((text: string) => report(text), [report]);
  const notifyError = useCallback((err: unknown) => {
    let text: string;
    if (typeof err === "string") {
      text = err;
    } else if (err instanceof Error) {
      text = err.message;
    } else {
      text = String(err);
    }
    report(text, true);
  }, [report]);

  const refreshStats = useCallback(async () => {
    try {
      setStats(await api.stats());
    } catch {
      setStats(null);
    }
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">CC</span>
          <span className="brand-name">Codex API Compat 桌面台</span>
        </div>
        <nav className="tabs">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`tab ${tab === item.id ? "active" : ""}`}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="topbar-status">
          {status?.running ? (
            <span className={`pill ${status.external ? "pill-external" : "pill-ok"}`}>
              ● {status.external ? "网关运行中（外部实例）" : "网关运行中"}
            </span>
          ) : (
            <span className="pill pill-off">● 网关未运行</span>
          )}
        </div>
      </header>

      {notice && (
        <div className={`notice ${notice.error ? "notice-error" : "notice-info"}`}>{notice.text}</div>
      )}

      <main className="content">
        {tab === "overview" && (
          <OverviewPage
            status={status}
            stats={stats}
            report={notify}
            reportError={notifyError}
            refreshStats={refreshStats}
          />
        )}
        {tab === "requests" && <RequestsPage stats={stats} />}
        {tab === "settings" && (
          <SettingsPage status={status} report={notify} reportError={notifyError} />
        )}
      </main>
    </div>
  );
}
