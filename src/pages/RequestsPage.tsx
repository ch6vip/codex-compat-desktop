import { formatBytes, formatMs, formatTime } from "../api";
import type { RecentEntry, StatsSnapshot } from "../types";

function removedSummary(entry: RecentEntry): string {
  const removed = entry.removed ?? {};
  const parts: string[] = [];
  if (removed.ids) parts.push(`id ${removed.ids}`);
  if (removed.encryptedContents) parts.push(`enc ${removed.encryptedContents}`);
  if (removed.itemReferences) parts.push(`ref ${removed.itemReferences}`);
  if (removed.previousResponseIds) parts.push(`prev ${removed.previousResponseIds}`);
  if (removed.encryptedIncludeFlags) parts.push(`incl ${removed.encryptedIncludeFlags}`);
  return parts.join(" / ") || "—";
}

function statusClass(status: number | undefined): string {
  if (!status) return "st-unknown";
  if (status >= 200 && status < 400) return "st-ok";
  if (status === 429) return "st-retry";
  return "st-fail";
}

export default function RequestsPage({ stats }: { stats: StatsSnapshot | null }) {
  const recent = stats?.recent ?? [];
  return (
    <div className="page">
      <section className="panel panel-full">
        <h3>最近请求（最新 {recent.length} 条，倒序）</h3>
        {recent.length === 0 ? (
          <p className="muted">暂无请求。网关运行并接收到流量后，这里会实时显示最近 100 条。</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>类型</th>
                  <th>方法</th>
                  <th>路径</th>
                  <th>状态</th>
                  <th>耗时</th>
                  <th>请求体</th>
                  <th>内部重试</th>
                  <th>原因 / 错误</th>
                  <th>净化</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((entry, index) => {
                  const isRetry = entry.kind === "retry";
                  return (
                    <tr key={index} className={isRetry ? "row-retry" : ""}>
                      <td>{formatTime(entry.time)}</td>
                      <td>
                        <span className={`badge ${isRetry ? "badge-retry" : "badge-req"}`}>
                          {isRetry ? "重试" : "请求"}
                        </span>
                      </td>
                      <td>{entry.method ?? "—"}</td>
                      <td className="mono">{entry.path ?? "—"}</td>
                      <td>
                        <span className={`status ${statusClass(entry.status)}`}>{entry.status ?? "—"}</span>
                      </td>
                      <td>{formatMs(entry.durationMs)}</td>
                      <td>{formatBytes(entry.requestBytes)}</td>
                      <td>
                        {entry.rateLimitRetries ? `第 ${entry.rateLimitRetries} 次` : "—"}
                        {entry.retryInMs ? `（${formatMs(entry.retryInMs)} 后）` : ""}
                      </td>
                      <td className="mono small">{entry.error ?? entry.reason ?? "—"}</td>
                      <td className="mono small">{removedSummary(entry)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
