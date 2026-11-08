import { invoke } from "@tauri-apps/api/core";
import type { CompatConfig, GatewayStatus, ShellSettings, StatsSnapshot } from "./types";

async function proxy<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  return invoke<T>("proxy_request", { path, method, body: body ?? null });
}

export const api = {
  startGateway: () => invoke<GatewayStatus>("gateway_start"),
  stopGateway: () => invoke<GatewayStatus>("gateway_stop"),
  restartGateway: () => invoke<GatewayStatus>("gateway_restart"),
  gatewayStatus: () => invoke<GatewayStatus>("gateway_status"),
  settings: () => invoke<ShellSettings>("shell_settings_get"),
  saveSettings: (settings: ShellSettings) => invoke<ShellSettings>("shell_settings_set", { settings }),
  openLogDir: () => invoke<void>("open_log_dir"),
  openSettingsDir: () => invoke<void>("open_settings_dir"),
  autostartGet: () => invoke<boolean>("autostart_get"),
  autostartSet: (enabled: boolean) => invoke<boolean>("autostart_set", { enabled }),

  stats: () => proxy<StatsSnapshot>("/__compat/stats"),
  config: () =>
    proxy<{ ok: boolean; config: CompatConfig; activeOrigin: string | null; controlAvailable: boolean }>(
      "/__compat/config"
    ),
  patchConfig: (patch: { retry?: unknown; log?: unknown }) =>
    proxy<{ ok: boolean; config: CompatConfig }>("/__compat/config", "POST", patch),
  upstreamAction: (payload: Record<string, unknown>) =>
    proxy<{ ok: boolean; config: CompatConfig; probe?: { ok: boolean; status?: number; durationMs: number; error?: string } }>(
      "/__compat/upstreams",
      "POST",
      payload
    ),
  clearLog: () => proxy<{ ok: boolean; cleared: boolean }>("/__compat/log", "POST", { action: "clear" }),
};

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "upstream";
}

export function formatUptime(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}小时${m}分`;
  if (m > 0) return `${m}分${s}秒`;
  return `${s}秒`;
}

export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function formatTime(iso: string | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("zh-CN", { hour12: false });
}
