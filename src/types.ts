export interface GatewayStatus {
  running: boolean;
  external: boolean;
  pid: number | null;
  token_ready: boolean;
  base: string;
  node_path: string;
  script_path: string;
  uptime_ms: number | null;
  upstream: string | null;
}

export interface Upstream {
  id: string;
  name: string;
  origin: string;
  note: string;
}

export interface RetryConfig {
  delayMs: number;
  maxRetries: number | null;
  jitter: number;
}

export interface LogConfig {
  enabled: boolean;
  file: string;
}

export interface CompatConfig {
  version: number;
  activeUpstreamId: string;
  upstreams: Upstream[];
  retry: RetryConfig;
  log: LogConfig;
}

export interface ShellSettings {
  node_path: string;
  script_path: string;
  port: number;
}

export interface RemovedCounts {
  ids?: number;
  encryptedContents?: number;
  itemReferences?: number;
  previousResponseIds?: number;
  encryptedIncludeFlags?: number;
}

export interface RecentEntry {
  time?: string;
  method?: string;
  path?: string;
  status?: number;
  durationMs?: number;
  requestBytes?: number;
  removed?: RemovedCounts | null;
  rateLimitRetries?: number;
  retryInMs?: number;
  reason?: string;
  error?: string;
  kind: "request" | "retry";
}

export interface StatsSnapshot {
  ok: boolean;
  upstream: string | null;
  pid: number | null;
  port: number | null;
  controlAvailable: boolean;
  configFile: string | null;
  config: CompatConfig;
  startedAt: string;
  uptimeMs: number;
  requests: { total: number; ok: number; failed: number; aborted: number; bytesIn: number };
  retries: { total: number; byReason: Record<string, number> };
  statuses: Record<string, number>;
  sanitized: Record<string, number>;
  latency: { samples: number; p50: number | null; p95: number | null; max: number | null };
  recent: RecentEntry[];
}

export interface ConfigResponse {
  ok: boolean;
  config: CompatConfig;
  activeOrigin: string | null;
  controlAvailable: boolean;
}

export interface ProbeResult {
  origin: string;
  durationMs: number;
  ok: boolean;
  status?: number;
  error?: string;
}
