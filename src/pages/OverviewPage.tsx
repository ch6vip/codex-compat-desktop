import { useCallback, useState } from "react";
import { api, formatMs, formatUptime } from "../api";
import type { GatewayStatus, StatsSnapshot } from "../types";

interface Props {
  status: GatewayStatus | null;
  stats: StatsSnapshot | null;
  report: (text: string) => void;
  reportError: (err: unknown) => void;
  refreshStats: () => Promise<void>;
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card">
      <div className="card-label">{label}</div>
      <div className="card-value">{value}</div>
      {sub && <div className="card-sub">{sub}</div>}
    </div>
  );
}

export default function OverviewPage({ status, stats, report, reportError, refreshStats }: Props) {
  const [busy, setBusy] = useState<string | null>(null);

  const run = useCallback(
    async (name: string, action: () => Promise<unknown>, done?: string) => {
      if (busy) return;
      setBusy(name);
      try {
        await action();
        if (done) report(done);
        await refreshStats();
      } catch (err) {
        reportError(err);
      } finally {
        setBusy(null);
      }
    },
    [busy, report, reportError, refreshStats]
  );

  const running = status?.running ?? false;
  const requests = stats?.requests;

  const runStateLabel = running ? (status?.external ? "外部实例" : "运行中") : "已停止";
  const runStateSub = status?.pid ? `PID ${status.pid}` : running ? "未接管进程" : undefined;

  return (
    <div className="page">
      <div className="actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={running || busy !== null}
          onClick={() => run("start", api.startGateway, "网关已启动")}
        >
          {busy === "start" ? "启动中…" : "启动网关"}
        </button>
        <button
          type="button"
          className="btn btn-danger"
          disabled={!running || busy !== null}
          onClick={() => run("stop", api.stopGateway, "网关已停止")}
        >
          {busy === "stop" ? "停止中…" : "停止网关"}
        </button>
        <button
          type="button"
          className="btn"
          disabled={!running || busy !== null}
          onClick={() => run("restart", api.restartGateway, "网关已重启")}
        >
          {busy === "restart" ? "重启中…" : "重启网关"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => run("logs", api.openLogDir)}
        >
          打开日志目录
        </button>
      </div>

      <div className="cards">
        <Card
          label="运行状态"
          value={runStateLabel}
          sub={runStateSub}
        />
        <Card label="上游" value={stats?.upstream ?? status?.upstream ?? "—"} sub={`本地端口 ${status?.base ?? "—"}`} />
        <Card
          label="已运行"
          value={formatUptime(stats?.uptimeMs ?? status?.uptime_ms)}
          sub={stats ? `自 ${new Date(stats.startedAt).toLocaleTimeString("zh-CN", { hour12: false })}` : undefined}
        />
        <Card
          label="请求总数"
          value={requests ? String(requests.total) : "—"}
          sub={requests ? `成功 ${requests.ok} · 失败 ${requests.failed} · 中断 ${requests.aborted}` : undefined}
        />
      </div>

      <div className="cards cards-secondary">
        <Card
          label="内部重试"
          value={stats ? String(stats.retries.total) : "—"}
          sub={
            stats && Object.keys(stats.retries.byReason).length
              ? Object.entries(stats.retries.byReason)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 3)
                  .map(([reason, count]) => `${reason} ×${count}`)
                  .join(" · ")
              : "无重试"
          }
        />
        <Card
          label="延迟"
          value={
            stats && stats.latency.p50 !== null ? `${formatMs(stats.latency.p50)} / ${formatMs(stats.latency.p95)}` : "—"
          }
          sub={stats?.latency.samples ? `P50 / P95 · ${stats.latency.samples} 样本` : "暂无样本"}
        />
        <Card
          label="请求净化"
          value={stats ? String(Object.values(stats.sanitized).reduce((a, b) => a + b, 0)) : "—"}
          sub={
            stats
              ? `id ${stats.sanitized.ids ?? 0} · 加密 ${stats.sanitized.encryptedContents ?? 0} · 引用 ${stats.sanitized.itemReferences ?? 0}`
              : undefined
          }
        />
        <Card
          label="流量"
          value={stats ? `${(stats.requests.bytesIn / 1024 / 1024).toFixed(1)} MB` : "—"}
          sub="仅入站请求体累计"
        />
      </div>

      <section className="panel">
        <h3>状态码分布</h3>
        {stats && Object.keys(stats.statuses).length > 0 ? (
          <div className="chips">
            {Object.entries(stats.statuses)
              .sort((a, b) => b[1] - a[1])
              .map(([code, count]) => (
                <span key={code} className="chip">
                  {code} × {count}
                </span>
              ))}
          </div>
        ) : (
          <p className="muted">暂无数据 — 网关运行后请求会实时统计在这里。</p>
        )}
      </section>

      <section className="panel">
        <h3>壳信息</h3>
        <div className="kv">
          <span>网关脚本</span>
          <code>{status?.script_path || "未找到（请在设置中指定 server.mjs 路径）"}</code>
        </div>
        <div className="kv">
          <span>Node</span>
          <code>{status?.node_path || "node"}</code>
        </div>
        <div className="kv">
          <span>控制令牌</span>
          <code>{status?.token_ready ? "已获取（可修改上游与配置）" : "未获取（仅监控）"}</code>
        </div>
      </section>
    </div>
  );
}
