import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { CompatConfig, GatewayStatus, ShellSettings, Upstream } from "../types";

interface Props {
  status: GatewayStatus | null;
  report: (text: string) => void;
  reportError: (err: unknown) => void;
}

const SANITIZED_ORIGIN_HINT = "只填协议 + 主机 + 端口，不带路径、账号密码或 query。";

/** 从 origin 推导默认名称：优先 host（含端口），非法 URL 时退化为去协议去路径的原文。 */
function deriveName(origin: string): string {
  try {
    return new URL(origin).host || origin;
  } catch {
    const stripped = origin.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/\/.*$/, "");
    return stripped || origin;
  }
}

export default function SettingsPage({ status, report, reportError }: Props) {
  const [config, setConfig] = useState<CompatConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);

  // 上游表单
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [formName, setFormName] = useState("");
  const [formOrigin, setFormOrigin] = useState("");
  const [formNote, setFormNote] = useState("");
  const [probeResult, setProbeResult] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // 重试参数
  const [delayMs, setDelayMs] = useState("3000");
  const [maxRetries, setMaxRetries] = useState("");
  const [jitter, setJitter] = useState("0");

  // 日志
  const [logEnabled, setLogEnabled] = useState(true);
  const [logFile, setLogFile] = useState("");

  // 壳设置
  const [settings, setSettings] = useState<ShellSettings | null>(null);
  const [autostart, setAutostart] = useState(false);

  const loadConfig = useCallback(async () => {
    setConfigLoading(true);
    try {
      const response = await api.config();
      setConfig(response.config);
      const retry = response.config.retry;
      setDelayMs(String(retry.delayMs));
      setMaxRetries(retry.maxRetries === null ? "" : String(retry.maxRetries));
      setJitter(String(retry.jitter));
      setLogEnabled(response.config.log.enabled);
      setLogFile(response.config.log.file);
    } catch (err) {
      reportError(err);
    } finally {
      setConfigLoading(false);
    }
  }, [reportError]);

  useEffect(() => {
    loadConfig();
    api.settings().then(setSettings).catch(() => undefined);
    api.autostartGet().then(setAutostart).catch(() => undefined);
  }, [loadConfig]);

  const toggleAutostart = useCallback(
    async (enabled: boolean) => {
      setAutostart(enabled);
      try {
        setAutostart(await api.autostartSet(enabled));
        report(enabled ? "已开启开机自启" : "已关闭开机自启");
      } catch (err) {
        setAutostart(!enabled);
        reportError(err);
      }
    },
    [report, reportError]
  );

  const applyConfig = useCallback(
    (next: CompatConfig) => {
      setConfig(next);
      report("已保存并热生效");
    },
    [report]
  );

  const resetForm = useCallback(() => {
    setEditingId(null);
    setFormName("");
    setFormOrigin("");
    setFormNote("");
    setShowAdvanced(false);
  }, []);

  const startEdit = useCallback((upstream: Upstream) => {
    setEditingId(upstream.id);
    setFormName(upstream.name);
    setFormOrigin(upstream.origin);
    setFormNote(upstream.note);
    setProbeResult(null);
    setShowAdvanced(true);
  }, []);

  const runAction = useCallback(
    async (name: string, action: () => Promise<{ config?: CompatConfig }>, done?: string) => {
      if (busy) return;
      setBusy(name);
      try {
        const response = await action();
        if (response.config) {
          applyConfig(response.config);
        } else if (done) {
          report(done);
        }
      } catch (err) {
        reportError(err);
      } finally {
        setBusy(null);
      }
    },
    [busy, applyConfig, report, reportError]
  );

  const submitUpstream = useCallback(() => {
    if (busy) return;
    const origin = formOrigin.trim();
    if (!origin) {
      reportError("上游地址不能为空。" + SANITIZED_ORIGIN_HINT);
      return;
    }
    // 名称留空时自动取主机名；id 交给服务端生成（slugify + 去重），与原版面板一致。
    const name = formName.trim() || deriveName(origin);
    if (editingId) {
      void runAction(
        "upstream",
        () =>
          api.upstreamAction({
            action: "update",
            upstream: { id: editingId, name, origin, note: formNote.trim() },
          }),
        "上游已更新"
      );
    } else {
      void runAction(
        "upstream",
        () => api.upstreamAction({ action: "add", upstream: { name, origin, note: formNote.trim() } }),
        "上游已添加"
      );
    }
    resetForm();
  }, [busy, formName, formOrigin, formNote, editingId, runAction, reportError, resetForm]);

  const probeForm = useCallback(async () => {
    if (busy) return;
    const origin = formOrigin.trim();
    if (!origin) {
      reportError("先填写上游地址再探活。");
      return;
    }
    setBusy("probe");
    setProbeResult(null);
    try {
      const response = await api.upstreamAction({ action: "probe", origin });
      const probe = response.probe;
      if (probe?.ok) {
        setProbeResult(`探活成功：HTTP ${probe.status ?? "?"}，耗时 ${probe.durationMs}ms`);
      } else {
        setProbeResult(`探活失败：${probe?.error ?? "未知错误"}`);
      }
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(null);
    }
  }, [busy, formOrigin, reportError]);

  const saveRetry = useCallback(() => {
    if (busy) return;
    const delay = Number(delayMs);
    const parsedJitter = Number(jitter);
    const trimmedMax = maxRetries.trim();
    let parsedMax: number | null = null;
    if (trimmedMax !== "") {
      parsedMax = Number(trimmedMax);
    }
    if (!Number.isInteger(delay) || delay < 0) {
      reportError("重试间隔必须是非负整数（毫秒）。");
      return;
    }
    if (parsedMax !== null && (!Number.isInteger(parsedMax) || parsedMax < 0)) {
      reportError("重试上限必须是非负整数，留空表示不限制。");
      return;
    }
    if (!Number.isFinite(parsedJitter) || parsedJitter < 0 || parsedJitter > 1) {
      reportError("抖动比例必须在 0 到 1 之间。");
      return;
    }
    void runAction(
      "retry",
      () => api.patchConfig({ retry: { delayMs: delay, maxRetries: parsedMax, jitter: parsedJitter } })
    );
  }, [busy, delayMs, maxRetries, jitter, runAction, reportError]);

  const saveLog = useCallback(() => {
    if (busy) return;
    void runAction("log", () => api.patchConfig({ log: { enabled: logEnabled, file: logFile.trim() } }));
  }, [busy, logEnabled, logFile, runAction]);

  const saveSettings = useCallback(async () => {
    if (busy || !settings) return;
    setBusy("shell");
    try {
      const saved = await api.saveSettings(settings);
      setSettings(saved);
      report("壳设置已保存，下次启动网关时生效");
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(null);
    }
  }, [busy, settings, report, reportError]);

  const activeId = config?.activeUpstreamId ?? "";
  const upstreams = config?.upstreams ?? [];

  return (
    <div className="page">
      <section className="panel panel-full">
        <h3>上游管理{configLoading ? "（加载中…）" : ""}</h3>
        {upstreams.length === 0 && !configLoading && (
          <p className="muted">还没有上游。添加一个 HTTPS origin 后，代理才能转发请求。</p>
        )}
        {upstreams.map((upstream) => (
          <div key={upstream.id} className={`upstream-row ${upstream.id === activeId ? "upstream-active" : ""}`}>
            <div className="upstream-info">
              <div className="upstream-name">
                {upstream.name}
                {upstream.id === activeId && <span className="badge badge-active">当前</span>}
              </div>
              <code className="mono">{upstream.origin}</code>
              {upstream.note && <div className="muted small">{upstream.note}</div>}
            </div>
            <div className="upstream-actions">
              <button
                type="button"
                className="btn btn-small"
                disabled={upstream.id === activeId || busy !== null}
                onClick={() =>
                  void runAction(
                    "activate",
                    () => api.upstreamAction({ action: "activate", id: upstream.id }),
                    "已切换上游"
                  )
                }
              >
                激活
              </button>
              <button type="button" className="btn btn-small" onClick={() => startEdit(upstream)}>
                编辑
              </button>
              <button
                type="button"
                className="btn btn-small btn-danger"
                disabled={busy !== null}
                onClick={() => {
                  if (upstream.id === activeId) {
                    reportError("不能删除当前激活的上游，请先切换到其他上游。");
                    return;
                  }
                  void runAction(
                    "remove",
                    () => api.upstreamAction({ action: "remove", id: upstream.id }),
                    "上游已删除"
                  );
                }}
              >
                删除
              </button>
            </div>
          </div>
        ))}

        <div className="quick-row">
          <input
            value={formOrigin}
            onChange={(event) => setFormOrigin(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submitUpstream();
            }}
            placeholder="粘贴上游地址，回车添加：https://api.example.com"
          />
          <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={submitUpstream}>
            {editingId ? "保存修改" : "添加"}
          </button>
          <button type="button" className="btn" disabled={busy !== null} onClick={probeForm}>
            探活
          </button>
          {!editingId && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              {showAdvanced ? "收起" : "高级"}
            </button>
          )}
          {editingId && (
            <button type="button" className="btn btn-ghost" onClick={resetForm}>
              取消编辑
            </button>
          )}
        </div>
        <p className="muted small">{SANITIZED_ORIGIN_HINT}；名称留空时自动取主机名。</p>
        {(showAdvanced || editingId) && (
          <div className="form-grid">
            <label>
              名称（留空 = 自动取主机名）
              <input
                value={formName}
                onChange={(event) => setFormName(event.target.value)}
                placeholder="例如 Azure eastus2"
              />
            </label>
            <label>
              备注
              <input
                value={formNote}
                onChange={(event) => setFormNote(event.target.value)}
                placeholder="可选"
              />
            </label>
          </div>
        )}
        {probeResult && <p className="probe-result">{probeResult}</p>}
      </section>

      <section className="panel">
        <h3>重试参数</h3>
        <div className="form-grid form-grid-3">
          <label>
            固定间隔（毫秒）
            <input value={delayMs} onChange={(event) => setDelayMs(event.target.value)} />
          </label>
          <label>
            重试上限（留空 = 不限）
            <input value={maxRetries} onChange={(event) => setMaxRetries(event.target.value)} />
          </label>
          <label>
            抖动比例 0–1
            <input value={jitter} onChange={(event) => setJitter(event.target.value)} />
          </label>
        </div>
        <div className="actions">
          <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={saveRetry}>
            保存重试参数
          </button>
        </div>
      </section>

      <section className="panel">
        <h3>诊断日志</h3>
        <label className="check-row">
          <input
            type="checkbox"
            checked={logEnabled}
            onChange={(event) => setLogEnabled(event.target.checked)}
          />
          启用 JSONL 日志（proxy.log.jsonl）
        </label>
        <div className="form-grid">
          <label>
            日志路径（留空 = 默认 ~/.codex/api-compat/）
            <input value={logFile} onChange={(event) => setLogFile(event.target.value)} />
          </label>
        </div>
        <div className="actions">
          <button type="button" className="btn" disabled={busy !== null} onClick={saveLog}>
            保存日志设置
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy !== null}
            onClick={() =>
              void runAction(
                "clearLog",
                async () => {
                  await api.clearLog();
                  return {};
                },
                "日志已清空"
              )
            }
          >
            清空日志
          </button>
        </div>
      </section>

      <section className="panel">
        <h3>壳设置（桌面台自身）</h3>
        <label className="check-row">
          <input
            type="checkbox"
            checked={autostart}
            onChange={(event) => void toggleAutostart(event.target.checked)}
          />
          开机自启（登录后自动运行桌面台并拉起网关）
        </label>
        <div className="form-grid">
          <label>
            Node 可执行文件
            <input
              value={settings?.node_path ?? ""}
              onChange={(event) =>
                setSettings((prev) => (prev ? { ...prev, node_path: event.target.value } : prev))
              }
            />
          </label>
          <label>
            网关脚本 server.mjs 路径
            <input
              value={settings?.script_path ?? ""}
              onChange={(event) =>
                setSettings((prev) => (prev ? { ...prev, script_path: event.target.value } : prev))
              }
            />
          </label>
          <label>
            本地端口
            <input
              value={settings ? String(settings.port) : ""}
              onChange={(event) =>
                setSettings((prev) =>
                  prev ? { ...prev, port: Number(event.target.value) || 0 } : prev
                )
              }
            />
          </label>
        </div>
        <div className="actions">
          <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={saveSettings}>
            保存壳设置
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => void api.openSettingsDir()}>
            打开壳数据目录
          </button>
        </div>
        <p className="muted small">
          当前网关：{status?.script_path || "未配置"} · 修改壳设置后需要重启网关生效。
        </p>
      </section>
    </div>
  );
}
