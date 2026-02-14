import { promises as fs } from "node:fs";
import path from "node:path";
import { AlertRow, CandlePoint, DashboardPayload, DecisionRow, StrategyCard } from "@/lib/types";

const SNAPSHOT_SCHEMA_VERSION = "dashboard.v2";

const DEFAULT_OUTPUTS_DIR = path.resolve(process.cwd(), "../outputs");
const DEFAULT_LIVE_DATA_DIR = path.resolve(process.cwd(), "../data/live");

const outputsDir = process.env.OUTPUTS_DIR ?? DEFAULT_OUTPUTS_DIR;
const liveDataDir = process.env.LIVE_DATA_DIR ?? DEFAULT_LIVE_DATA_DIR;

async function readTextSafe(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

function parseNum(v: string | number | null | undefined): number {
  if (typeof v === "number") return v;
  if (!v) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toEpochSeconds(ts: string): number {
  const d = new Date(ts);
  return Number.isFinite(d.getTime()) ? Math.floor(d.getTime() / 1000) : 0;
}

function parseIsoMs(ts: unknown): number {
  if (typeof ts !== "string") return 0;
  const ms = new Date(ts).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function buildRecentTradeSnapshot(rows: Record<string, unknown>[], nowMs: number) {
  const sinceMs = nowMs - 24 * 60 * 60 * 1000;
  let pnlKrw = 0;
  let trades = 0;

  for (const row of rows) {
    if (String(row.event ?? "") !== "close") continue;
    const tsMs = parseIsoMs(row.ts);
    if (tsMs <= 0 || tsMs < sinceMs) continue;
    pnlKrw += parseNum(row.pnl as string | number);
    trades += 1;
  }

  return { pnlKrw, trades };
}

async function readCandlesFromCsv(fileName: string, limit = 240): Promise<CandlePoint[]> {
  const csv = await readTextSafe(path.join(liveDataDir, fileName));
  if (!csv) return [];

  const lines = csv.trim().split(/\r?\n/);
  const data = lines.slice(1).filter(Boolean).slice(-limit);

  return data
    .map((line) => {
      const [timestamp, open, high, low, close, volume] = line.split(",");
      return {
        time: toEpochSeconds(timestamp),
        open: parseNum(open),
        high: parseNum(high),
        low: parseNum(low),
        close: parseNum(close),
        volume: parseNum(volume),
      };
    })
    .filter((c) => c.time > 0);
}

function latestDecisionTimelineMs(
  eventActivityRows: Record<string, unknown>[],
  decisionsByProfile: Record<string, unknown>[][],
): number {
  const eventTsMs = eventActivityRows.reduce((acc, row) => Math.max(acc, parseIsoMs(row.bar_ts ?? row.ts)), 0);
  const decisionTsMs = decisionsByProfile.flat().reduce((acc, row) => Math.max(acc, parseIsoMs(row.ts)), 0);
  return Math.max(eventTsMs, decisionTsMs);
}

function selectCandleSource(params: {
  candles1m: CandlePoint[];
  candles5m: CandlePoint[];
  latestDecisionMs: number;
  nowMs: number;
}): {
  candles: CandlePoint[];
  selectedTimeframe: "1m" | "5m";
  selectedSourceFile: string;
  fallbackFrom: "1m" | null;
  warning: string | null;
} {
  const { candles1m, candles5m, latestDecisionMs, nowMs } = params;
  const last1 = candles1m.at(-1)?.time ? candles1m.at(-1)!.time * 1000 : 0;
  const last5 = candles5m.at(-1)?.time ? candles5m.at(-1)!.time * 1000 : 0;

  if (candles1m.length === 0 && candles5m.length > 0) {
    return {
      candles: candles5m,
      selectedTimeframe: "5m",
      selectedSourceFile: "btc_5m.csv",
      fallbackFrom: "1m",
      warning: "1m 캔들이 비어 5m 캔들로 대체 표시 중",
    };
  }

  if (candles1m.length === 0) {
    return {
      candles: [],
      selectedTimeframe: "1m",
      selectedSourceFile: "btc_1m.csv",
      fallbackFrom: null,
      warning: null,
    };
  }

  if (candles5m.length === 0) {
    return {
      candles: candles1m,
      selectedTimeframe: "1m",
      selectedSourceFile: "btc_1m.csv",
      fallbackFrom: null,
      warning: null,
    };
  }

  const decisionGap1m = latestDecisionMs > 0 ? latestDecisionMs - last1 : 0;
  const decisionGap5m = latestDecisionMs > 0 ? latestDecisionMs - last5 : 0;
  const age1m = last1 > 0 ? nowMs - last1 : Number.POSITIVE_INFINITY;

  const oneMinuteStaleVsDecision = decisionGap1m > 4 * 60 * 1000;
  const fiveMinuteStillUsable = decisionGap5m <= 10 * 60 * 1000;
  const oneMinuteTooOld = age1m > 8 * 60 * 1000;

  if ((oneMinuteStaleVsDecision && fiveMinuteStillUsable) || oneMinuteTooOld) {
    return {
      candles: candles5m,
      selectedTimeframe: "5m",
      selectedSourceFile: "btc_5m.csv",
      fallbackFrom: "1m",
      warning: "1m 캔들이 실행 타임라인보다 지연되어 5m 캔들로 자동 전환",
    };
  }

  return {
    candles: candles1m,
    selectedTimeframe: "1m",
    selectedSourceFile: "btc_1m.csv",
    fallbackFrom: null,
    warning: null,
  };
}

async function readJsonSafe<T>(filePath: string, fallback: T): Promise<T> {
  const text = await readTextSafe(filePath);
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

async function readJsonl(filePath: string, limit = 50): Promise<Record<string, unknown>[]> {
  const text = await readTextSafe(filePath);
  if (!text) return [];
  return text
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-limit)
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return {};
      }
    });
}

function signalQualityFromDecision(d: Record<string, unknown> | undefined): StrategyCard["signalQuality"] {
  if (!d) return "unknown";
  const finalSignal = parseNum((d.final_signal as string) ?? (d.final_signal as number));
  const baseSignal = parseNum((d.base_signal as string) ?? (d.base_signal as number));
  const reasons = ((d.block_reasons as unknown[]) ?? []).length;
  if (finalSignal !== 0) return "final";
  if (baseSignal !== 0 && reasons > 0) return "weak-filtered";
  if (baseSignal !== 0) return "strong";
  return "unknown";
}

function decisionAction(signal: number): "BUY" | "SELL" | "HOLD" {
  if (signal > 0) return "BUY";
  if (signal < 0) return "SELL";
  return "HOLD";
}

function buildExecutionDiagnosticsFromActivity(rows: Record<string, unknown>[]): DashboardPayload["executionDiagnostics"] {
  const nowMs = Date.now();
  const sinceMs = nowMs - 60 * 60 * 1000;
  const bars = new Set<string>();
  let executed = 0;
  const skippedReasons: Record<string, number> = {};

  for (const r of rows) {
    const tsMs = parseIsoMs(r.ts);
    if (tsMs <= 0 || tsMs < sinceMs) continue;
    if (typeof r.bar_ts === "string" && r.bar_ts) bars.add(r.bar_ts);
    if (r.status === "executed") executed += 1;
    if (r.status === "skipped") {
      const reason = typeof r.reason === "string" && r.reason ? r.reason : "unknown";
      skippedReasons[reason] = (skippedReasons[reason] ?? 0) + 1;
    }
  }

  return {
    last60m_expected: 12,
    observed_events: bars.size,
    executed_decisions: executed,
    skipped_reasons: skippedReasons,
    source: "event_activity",
  };
}

export async function getDashboardPayload(): Promise<DashboardPayload> {
  const [candles1m, candles5m, perfSummary, perfRawAlerts, eventActivityRaw, executionDiagnosticsRaw] = await Promise.all([
    readCandlesFromCsv("btc_1m.csv", 240),
    readCandlesFromCsv("btc_5m.csv", 240),
    readJsonSafe<{ profiles?: Array<Record<string, unknown>> }>(path.join(outputsDir, "alerts_performance.json"), {}),
    readJsonSafe<Record<string, unknown>>(path.join(outputsDir, "alerts_performance.json"), {}),
    readJsonl(path.join(outputsDir, "event_executor_activity.jsonl"), 200),
    readJsonSafe<Record<string, unknown>>(path.join(outputsDir, "execution_diagnostics_60m.json"), {}),
  ]);

  const profiles: Array<"A" | "B" | "C"> = ["A", "B", "C"];

  const stateEntries = await Promise.all(
    profiles.map((p) => readJsonSafe<Record<string, unknown>>(path.join(outputsDir, `paper_state.${p}.json`), {})),
  );

  const decisionsByProfile = await Promise.all(
    profiles.map((p) => readJsonl(path.join(outputsDir, `paper_decisions.${p}.jsonl`), 40)),
  );
  const tradesByProfile = await Promise.all(
    profiles.map((p) => readJsonl(path.join(outputsDir, `paper_trades.${p}.jsonl`), 400)),
  );

  const opsAlertsRaw = await readJsonl(path.join(outputsDir, "alerts_ops.jsonl"), 30);

  const performanceProfiles = new Map<string, Record<string, unknown>>(
    (perfSummary.profiles ?? []).map((p) => [String(p.profile), p]),
  );

  const nowMs = Date.now();
  const latestDecisionMs = latestDecisionTimelineMs(eventActivityRaw, decisionsByProfile);
  const candleSelection = selectCandleSource({ candles1m, candles5m, latestDecisionMs, nowMs });
  const candles = candleSelection.candles;

  const strategies: StrategyCard[] = profiles.map((profile, idx) => {
    const st = stateEntries[idx] ?? {};
    const lastDecision = decisionsByProfile[idx]?.at(-1);
    const perf = performanceProfiles.get(profile) ?? {};
    const recent = buildRecentTradeSnapshot(tradesByProfile[idx] ?? [], nowMs);
    const baseCapital = parseNum(st.day_start_cash as string | number) || 10_000_000;

    return {
      profile,
      position: parseNum(st.position as string | number),
      qty: parseNum(st.qty as string | number),
      entry: parseNum(st.entry as string | number),
      cash: parseNum(st.cash as string | number),
      realizedPnlKrw: parseNum(st.realized_pnl as string | number),
      realizedPnlPct: parseNum(perf.realized_pnl_pct as string | number),
      recentPnl24hKrw: recent.pnlKrw,
      recentPnl24hPct: baseCapital > 0 ? (recent.pnlKrw / baseCapital) * 100 : 0,
      recentTrades24h: recent.trades,
      winRate:
        perf.win_rate === undefined || perf.win_rate === null ? null : parseNum(perf.win_rate as string | number) * 100,
      mddPct:
        perf.max_drawdown_pct === undefined || perf.max_drawdown_pct === null
          ? null
          : parseNum(perf.max_drawdown_pct as string | number),
      tradesClosed: parseNum(perf.trades_closed as string | number),
      signalQuality: signalQualityFromDecision(lastDecision),
      lastDecisionTs: (lastDecision?.ts as string) ?? null,
    };
  });

  const eventDrivenDecisions: DecisionRow[] = eventActivityRaw
    .flatMap((r) => {
      const ts = String(r.ts ?? r.bar_ts ?? "");
      const status = String(r.status ?? "");
      if (!ts || (status !== "executed" && status !== "skipped")) return [];
      const row: DecisionRow = {
        ts,
        profile: "EVT",
        signal: 0,
        action: status === "executed" ? "EXECUTED" : "SKIPPED",
        reason: status === "executed" ? "event_5m_trigger" : String(r.reason ?? "unknown"),
      };
      return [row];
    })
    .sort((a, b) => (new Date(a.ts).getTime() > new Date(b.ts).getTime() ? -1 : 1))
    .slice(0, 20);

  const legacyDecisions: DecisionRow[] = decisionsByProfile
    .flatMap((rows, idx) =>
      rows.map((r) => ({
        ts: String(r.ts ?? ""),
        profile: profiles[idx],
        signal: parseNum(r.final_signal as string | number),
        action: decisionAction(parseNum(r.final_signal as string | number)),
        reason: Array.isArray(r.block_reasons) && r.block_reasons.length > 0 ? String((r.block_reasons as unknown[]).join(",")) : "final",
      })),
    )
    .filter((d) => d.ts)
    .sort((a, b) => (new Date(a.ts).getTime() > new Date(b.ts).getTime() ? -1 : 1))
    .slice(0, 20);

  const mergedDecisions: DecisionRow[] = eventDrivenDecisions.length > 0 ? eventDrivenDecisions : legacyDecisions;

  const opsAlerts: AlertRow[] = opsAlertsRaw
    .map((a) => ({
      ts: String(a.checked_at_utc ?? a.ts ?? ""),
      severity: String(a.severity ?? "info"),
      type: String(a.type ?? "ops"),
      message: String(a.message ?? ""),
    }))
    .filter((a) => a.ts)
    .reverse();

  const perfAlerts: AlertRow[] = [
    {
      ts: String(perfRawAlerts.generated_at_utc ?? ""),
      severity: String(perfRawAlerts.status ?? "info"),
      type: "performance_summary",
      message: `sample_ready=${String(perfRawAlerts.sample_ready ?? false)}, target_reached=${String(perfRawAlerts.target_reached ?? false)}`,
    },
  ].filter((a) => a.ts);

  const last = candles.at(-1);
  const first = candles[0];
  const closes = candles.map((c) => c.close);
  const vols = candles.map((c) => c.volume);

  const high24h = closes.length ? Math.max(...closes) : null;
  const low24h = closes.length ? Math.min(...closes) : null;
  const volume24h = vols.length ? vols.reduce((sum, v) => sum + v, 0) : null;

  const executionDiagnostics: DashboardPayload["executionDiagnostics"] = eventActivityRaw.length
    ? buildExecutionDiagnosticsFromActivity(eventActivityRaw)
    : {
        last60m_expected: parseNum(executionDiagnosticsRaw.expected_5m_events as string | number) || 12,
        observed_events: parseNum(executionDiagnosticsRaw.observed_5m_events as string | number),
        executed_decisions: parseNum(executionDiagnosticsRaw.executed_decisions as string | number),
        skipped_reasons:
          typeof executionDiagnosticsRaw.skipped_reasons === "object" && executionDiagnosticsRaw.skipped_reasons !== null
            ? (executionDiagnosticsRaw.skipped_reasons as Record<string, number>)
            : {},
        source: "execution_diagnostics",
      };

  return {
    snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
    symbol: "KRW-BTC",
    updatedAt: new Date().toISOString(),
    market: {
      lastPrice: last?.close ?? null,
      changePct: first && last ? ((last.close - first.open) / first.open) * 100 : null,
      high24h,
      low24h,
      volume24h,
    },
    candles,
    candleSource: {
      selectedTimeframe: candleSelection.selectedTimeframe,
      selectedSourceFile: candleSelection.selectedSourceFile,
      fallbackFrom: candleSelection.fallbackFrom,
      warning: candleSelection.warning,
      lastCandleTs: candles.at(-1)?.time ? new Date(candles.at(-1)!.time * 1000).toISOString() : null,
      decisionLatestTs: latestDecisionMs > 0 ? new Date(latestDecisionMs).toISOString() : null,
    },
    strategies,
    decisions: mergedDecisions,
    executionDiagnostics,
    alerts: {
      ops: opsAlerts,
      performance: perfAlerts,
    },
  };
}
