import { promises as fs } from "node:fs";
import path from "node:path";
import { AlertRow, CandlePoint, DashboardPayload, DecisionRow, StrategyCard, SystemLogRow } from "@/lib/types";

const SNAPSHOT_SCHEMA_VERSION = "dashboard.v2";

const DEFAULT_OUTPUTS_DIR = path.resolve(process.cwd(), "../outputs");
const DEFAULT_LIVE_DATA_DIR = path.resolve(process.cwd(), "../data/live");

const outputsDir = process.env.OUTPUTS_DIR ?? DEFAULT_OUTPUTS_DIR;
const liveDataDir = process.env.LIVE_DATA_DIR ?? DEFAULT_LIVE_DATA_DIR;
const runtimeLagBreakdownFile = path.join(outputsDir, "runtime_lag_breakdown.json");
const runtimeHealthFile = path.join(outputsDir, "runtime_health.json");
const runtimeSelfHealFile = path.join(outputsDir, "runtime_self_heal_actions.jsonl");

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

function buildTradePerformance(rows: Record<string, unknown>[], initialCapital = 10_000_000) {
  const closes = rows.filter((row) => String(row.event ?? "") === "close");
  const pnls = closes.map((row) => parseNum(row.pnl as string | number));
  const tradesClosed = pnls.length;
  const wins = pnls.filter((p) => p > 0).length;
  const realizedPnlKrw = pnls.reduce((acc, p) => acc + p, 0);
  const realizedPnlPct = initialCapital > 0 ? (realizedPnlKrw / initialCapital) * 100 : 0;
  const winRatePct = tradesClosed > 0 ? (wins / tradesClosed) * 100 : 0;

  let equity = initialCapital;
  let peak = initialCapital;
  let mddPct = 0;
  for (const pnl of pnls) {
    equity += pnl;
    if (equity > peak) peak = equity;
    const ddPct = peak > 0 ? ((equity / peak) - 1) * 100 : 0;
    if (ddPct < mddPct) mddPct = ddPct;
  }

  return { tradesClosed, winRatePct, realizedPnlPct, mddPct };
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

function asNullableNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function countRecentSelfHeal(rows: Record<string, unknown>[], nowMs: number, windowMs: number): number {
  const since = nowMs - windowMs;
  return rows.filter((row) => {
    const tsSec = asNullableNumber(row.ts);
    if (tsSec === null) return false;
    return tsSec * 1000 >= since;
  }).length;
}

function calcFreshnessHealthScore(params: {
  collectorLagSec: number | null;
  sync1mLagSec: number | null;
  sync5mLagSec: number | null;
  selfHealLast1h: number;
  policyState: "recovered" | "watch" | "degraded";
}): number {
  const { collectorLagSec, sync1mLagSec, sync5mLagSec, selfHealLast1h, policyState } = params;
  let score = 100;

  if (collectorLagSec !== null) score -= Math.min(35, Math.floor(collectorLagSec / 8));
  if (sync1mLagSec !== null) score -= Math.min(30, Math.floor(sync1mLagSec / 12));
  if (sync5mLagSec !== null) score -= Math.min(25, Math.floor(sync5mLagSec / 30));
  score -= Math.min(20, selfHealLast1h * 4);

  if (policyState === "watch") score -= 8;
  if (policyState === "degraded") score -= 20;

  return Math.max(0, Math.min(100, score));
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

function humanizeReason(reason: string): string {
  const normalized = reason.trim().toLowerCase();
  if (!normalized || normalized === "final") return "신호 충족";
  const map: Record<string, string> = {
    risk_hold: "리스크 가드로 진입 보류",
    lag_hold: "리스크 가드로 진입 보류",
    entry_filter: "신규 진입 조건 미충족",
    entry_filter_fail: "신규 진입 조건 미충족",
    time_window: "신규 진입 조건 미충족",
    time_block: "신규 진입 조건 미충족",
    stale_data: "데이터 신선도 부족",
    duplicate_bar: "중복 봉 처리 방지",
    stale_bar: "중복 봉 처리 방지",
  };
  const parts = normalized.split(",").map((v) => v.trim()).filter(Boolean);
  const rendered = parts.map((part) => map[part] ?? part.replaceAll("_", " "));
  return rendered.join(", ");
}

function isInfraReason(reason: string): boolean {
  const normalized = reason.trim().toLowerCase();
  if (!normalized) return false;
  return [
    "event_5m_trigger",
    "executor_locked",
    "internal_heartbeat",
    "heartbeat",
    "lock",
    "stale_bar",
    "duplicate_bar",
    "already_processed_bar",
    "ws_stalled",
    "event_stalled",
    "runtime_down",
    "lag_hold",
  ].includes(normalized);
}

function fallbackDecisionReason(rawReasons: string[]): string {
  const normalized = rawReasons.map((v) => v.trim().toLowerCase());
  if (normalized.some((v) => ["stale_bar", "duplicate_bar", "already_processed_bar", "executor_locked", "event_5m_trigger"].includes(v))) {
    return "중복 봉 처리 방지";
  }
  if (normalized.some((v) => ["risk_hold", "lag_hold", "ws_stalled", "event_stalled", "runtime_down"].includes(v))) {
    return "리스크 가드로 진입 보류";
  }
  return "신규 진입 조건 미충족";
}

function toDecisionReason(rawReasons: string[], fallbackWhenEmpty: string): string {
  const cleaned = rawReasons.map((v) => v.trim()).filter(Boolean);
  const decisionReasons = cleaned.filter((v) => !isInfraReason(v));
  if (decisionReasons.length > 0) return humanizeReason(decisionReasons.join(","));
  if (cleaned.length > 0) return fallbackDecisionReason(cleaned);
  return fallbackWhenEmpty;
}

function toDirection(signal: number): DecisionRow["direction"] {
  if (signal > 0) return "LONG";
  if (signal < 0) return "SHORT";
  return "NONE";
}

function toDecisionResult(params: {
  finalSignal: number;
  prevPos: number;
  positionAfter: number;
  reasons: string[];
}): DecisionRow["result"] {
  const { finalSignal, prevPos, positionAfter, reasons } = params;
  if (finalSignal === 0) {
    if (prevPos !== 0 && positionAfter === 0) return "EXIT";
    if (reasons.length > 0) return "NO_ENTRY";
    return "SKIP";
  }
  if (prevPos === 0 && positionAfter !== 0) return "ENTRY";
  if (prevPos !== 0 && positionAfter === 0) return "EXIT";
  if (prevPos !== 0 && Math.sign(prevPos) !== Math.sign(positionAfter)) return "ENTRY";
  return reasons.length > 0 ? "NO_ENTRY" : "SKIP";
}

function pickRiskRatio(row: Record<string, unknown>): number | null {
  const candidates = [row.risk_ratio, row.dyn_ratio, row.size_ratio, row.position_ratio];
  for (const candidate of candidates) {
    const n = parseNum(candidate as string | number);
    if (n > 0 && n <= 1) return n;
  }
  return null;
}

function buildExecutionDiagnosticsFromActivity(rows: Record<string, unknown>[]): DashboardPayload["executionDiagnostics"] {
  const nowMs = Date.now();
  const sinceMs = nowMs - 60 * 60 * 1000;
  const bars = new Set<string>();
  let executed = 0;
  const skippedReasons: Record<string, number> = {};
  const rejectedReasons: Record<string, number> = {};

  for (const r of rows) {
    const tsMs = parseIsoMs(r.ts);
    if (tsMs <= 0 || tsMs < sinceMs) continue;
    if (typeof r.bar_ts === "string" && r.bar_ts) bars.add(r.bar_ts);
    if (r.status === "executed") executed += 1;
    if (r.status === "skipped") {
      const reason = typeof r.reason === "string" && r.reason ? r.reason : "unknown";
      skippedReasons[reason] = (skippedReasons[reason] ?? 0) + 1;
    }
    if (r.status === "rejected") {
      const reason = typeof r.reason === "string" && r.reason ? r.reason : "unknown";
      rejectedReasons[reason] = (rejectedReasons[reason] ?? 0) + 1;
    }
  }

  const reasonSplit = {
    stale_bar: skippedReasons.stale_bar ?? 0,
    entry_filter: skippedReasons.entry_filter ?? 0,
    risk_hold: skippedReasons.risk_hold ?? 0,
    executor_locked: skippedReasons.executor_locked ?? 0,
  };

  const actionableNow = reasonSplit.stale_bar <= 1 && reasonSplit.executor_locked === 0;
  const actionableReason = actionableNow ? "actionable" : reasonSplit.stale_bar > 1 ? "stale_bar_dominant" : "executor_locked";

  return {
    last60m_expected: 12,
    observed_events: bars.size,
    executed_decisions: executed,
    skipped_total: Object.values(skippedReasons).reduce((a, b) => a + b, 0),
    skipped_reasons: skippedReasons,
    rejected_total: Object.values(rejectedReasons).reduce((a, b) => a + b, 0),
    rejected_reasons: rejectedReasons,
    reason_split: reasonSplit,
    actionable_now: actionableNow,
    actionable_reason: actionableReason,
    source: "event_activity",
  };
}

export async function getDashboardPayload(): Promise<DashboardPayload> {
  const [candles1m, candles5m, perfSummary, perfRawAlerts, eventActivityRaw, executionDiagnosticsRaw, runtimeLag, runtimeHealth] = await Promise.all([
    readCandlesFromCsv("btc_1m.csv", 240),
    readCandlesFromCsv("btc_5m.csv", 240),
    readJsonSafe<{ profiles?: Array<Record<string, unknown>> }>(path.join(outputsDir, "alerts_performance.json"), {}),
    readJsonSafe<Record<string, unknown>>(path.join(outputsDir, "alerts_performance.json"), {}),
    readJsonl(path.join(outputsDir, "event_executor_activity.jsonl"), 200),
    readJsonSafe<Record<string, unknown>>(path.join(outputsDir, "execution_diagnostics_60m.json"), {}),
    readJsonSafe<Record<string, unknown>>(runtimeLagBreakdownFile, {}),
    readJsonSafe<Record<string, unknown>>(runtimeHealthFile, {}),
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
  const selfHealRows = await readJsonl(runtimeSelfHealFile, 500);

  // metrics are computed from trade logs (not perf snapshot)

  const nowMs = Date.now();
  const latestDecisionMs = latestDecisionTimelineMs(eventActivityRaw, decisionsByProfile);
  const candleSelection = selectCandleSource({ candles1m, candles5m, latestDecisionMs, nowMs });
  const candles = candleSelection.candles;

  const strategies: StrategyCard[] = profiles.map((profile, idx) => {
    const st = stateEntries[idx] ?? {};
    const lastDecision = decisionsByProfile[idx]?.at(-1);
    const recent = buildRecentTradeSnapshot(tradesByProfile[idx] ?? [], nowMs);
    const baseCapital = parseNum(st.day_start_cash as string | number) || 10_000_000;
    const perf = buildTradePerformance(tradesByProfile[idx] ?? [], 10_000_000);

    return {
      profile,
      position: parseNum(st.position as string | number),
      qty: parseNum(st.qty as string | number),
      entry: parseNum(st.entry as string | number),
      cash: parseNum(st.cash as string | number),
      realizedPnlKrw: parseNum(st.realized_pnl as string | number),
      realizedPnlPct: perf.realizedPnlPct,
      recentPnl24hKrw: recent.pnlKrw,
      recentPnl24hPct: baseCapital > 0 ? (recent.pnlKrw / baseCapital) * 100 : 0,
      recentTrades24h: recent.trades,
      winRate: perf.tradesClosed > 0 ? perf.winRatePct : null,
      mddPct: perf.tradesClosed > 0 ? perf.mddPct : null,
      tradesClosed: perf.tradesClosed,
      signalQuality: signalQualityFromDecision(lastDecision),
      lastDecisionTs: (lastDecision?.ts as string) ?? null,
    };
  });

  const openRatioByProfile = new Map<string, number>();
  profiles.forEach((profile, idx) => {
    const ratios = (tradesByProfile[idx] ?? [])
      .filter((row) => String(row.event ?? "") === "open")
      .map((row) => {
        const amount = parseNum(row.qty as string | number) * parseNum(row.price as string | number);
        const equity = parseNum(row.cash as string | number);
        return equity > 0 ? amount / equity : 0;
      })
      .filter((ratio) => ratio > 0 && Number.isFinite(ratio));

    if (!ratios.length) return;
    ratios.sort((a, b) => a - b);
    openRatioByProfile.set(profile, ratios[Math.floor(ratios.length / 2)]);
  });

  const tradeIndex = new Map<string, Record<string, unknown>>();
  profiles.forEach((profile, idx) => {
    for (const trade of tradesByProfile[idx] ?? []) {
      const ts = String(trade.ts ?? "");
      if (!ts) continue;
      tradeIndex.set(`${profile}:${ts}`, trade);
    }
  });

  const traderDecisions: DecisionRow[] = decisionsByProfile
    .flatMap((rows, idx) => {
      const profile = profiles[idx];
      let prevPos = 0;
      return rows.map((raw) => {
        const ts = String(raw.ts ?? "");
        const finalSignal = parseNum(raw.final_signal as string | number);
        const positionAfter = parseNum(raw.position_after as string | number);
        const reasons = Array.isArray(raw.block_reasons)
          ? (raw.block_reasons as unknown[]).map((v) => String(v)).filter(Boolean)
          : [];

        const trade = tradeIndex.get(`${profile}:${ts}`);
        const actualAmount = trade ? parseNum(trade.qty as string | number) * parseNum(trade.price as string | number) : 0;
        const equity = parseNum((trade?.cash as string | number) ?? (stateEntries[idx]?.day_start_cash as string | number) ?? 0);
        const ratio = pickRiskRatio(raw) ?? openRatioByProfile.get(profile) ?? null;
        const estimatedAmount = ratio !== null && equity > 0 ? equity * ratio : 0;
        const amountKrw = actualAmount > 0 ? actualAmount : estimatedAmount > 0 ? estimatedAmount : null;
        const amountIsEstimated = !(actualAmount > 0) && amountKrw !== null;
        const sizePct = amountKrw !== null && equity > 0 ? (amountKrw / equity) * 100 : ratio !== null ? ratio * 100 : null;

        const result = toDecisionResult({ finalSignal, prevPos, positionAfter, reasons });
        const row: DecisionRow = {
          ts,
          profile,
          direction: toDirection(finalSignal),
          result,
          reason: result === "ENTRY"
            ? toDecisionReason(reasons, "진입 신호 충족")
            : result === "EXIT"
              ? toDecisionReason(reasons, "청산 조건 충족")
              : toDecisionReason(reasons, "신규 진입 조건 미충족"),
          sizePct,
          amountKrw,
          amountIsEstimated,
        };

        prevPos = positionAfter;
        return row;
      });
    })
    .filter((d) => d.ts)
    .sort((a, b) => (new Date(a.ts).getTime() > new Date(b.ts).getTime() ? -1 : 1))
    .slice(0, 20);

  const systemLogs: SystemLogRow[] = eventActivityRaw
    .flatMap((r) => {
      const ts = String(r.ts ?? r.bar_ts ?? "");
      const status = String(r.status ?? "").toLowerCase();
      if (!ts || (status !== "executed" && status !== "skipped" && status !== "rejected")) return [];
      return [{
        ts,
        source: "EVT" as const,
        status: (status as SystemLogRow["status"]),
        reason: status === "executed" ? "event_5m_trigger" : String(r.reason ?? "unknown"),
      }];
    })
    .sort((a, b) => (new Date(a.ts).getTime() > new Date(b.ts).getTime() ? -1 : 1))
    .slice(0, 60);

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
        skipped_total: parseNum(executionDiagnosticsRaw.skipped_total as string | number),
        skipped_reasons:
          typeof executionDiagnosticsRaw.skipped_reasons === "object" && executionDiagnosticsRaw.skipped_reasons !== null
            ? (executionDiagnosticsRaw.skipped_reasons as Record<string, number>)
            : {},
        rejected_total: parseNum(executionDiagnosticsRaw.rejected_total as string | number),
        rejected_reasons:
          typeof executionDiagnosticsRaw.rejected_reasons === "object" && executionDiagnosticsRaw.rejected_reasons !== null
            ? (executionDiagnosticsRaw.rejected_reasons as Record<string, number>)
            : {},
        reason_split: {
          stale_bar: parseNum((executionDiagnosticsRaw.skipped_reasons as Record<string, number> | undefined)?.stale_bar),
          entry_filter: parseNum((executionDiagnosticsRaw.skipped_reasons as Record<string, number> | undefined)?.entry_filter),
          risk_hold: parseNum((executionDiagnosticsRaw.skipped_reasons as Record<string, number> | undefined)?.risk_hold),
          executor_locked: parseNum((executionDiagnosticsRaw.skipped_reasons as Record<string, number> | undefined)?.executor_locked),
        },
        actionable_now: parseNum((executionDiagnosticsRaw.skipped_reasons as Record<string, number> | undefined)?.stale_bar) <= 1,
        actionable_reason:
          parseNum((executionDiagnosticsRaw.skipped_reasons as Record<string, number> | undefined)?.stale_bar) <= 1
            ? "actionable"
            : "stale_bar_dominant",
        source: "execution_diagnostics",
      };

  const collectorLagSec = asNullableNumber(runtimeLag.collector_lag_sec);
  const rawWriteLagSec = asNullableNumber(runtimeLag.raw_write_lag_sec);
  const sync1mLagSec = asNullableNumber(runtimeLag.sync_1m_lag_sec);
  const sync5mLagSec = asNullableNumber(runtimeLag.sync_5m_lag_sec);
  const executorLagSec = asNullableNumber(runtimeLag.executor_activity_lag_sec);
  const policyStateRaw = String((runtimeHealth.data_freshness_slo as Record<string, unknown> | undefined)?.policy_state ?? "recovered");
  const policyState = (policyStateRaw === "watch" || policyStateRaw === "degraded") ? policyStateRaw : "recovered";
  const selfHealLast1h = countRecentSelfHeal(selfHealRows, nowMs, 60 * 60 * 1000);
  const selfHealLast24h = countRecentSelfHeal(selfHealRows, nowMs, 24 * 60 * 60 * 1000);

  const freshness = {
    collectorLagSec,
    rawWriteLagSec,
    sync1mLagSec,
    sync5mLagSec,
    executorLagSec,
    selfHealLast1h,
    selfHealLast24h,
    healthScore: calcFreshnessHealthScore({ collectorLagSec, sync1mLagSec, sync5mLagSec, selfHealLast1h, policyState }),
    policyState,
  } as const;

  return {
    snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
    symbol: "KRW-BTC",
    updatedAt: new Date().toISOString(),
    freshness,
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
      lagMin: sync1mLagSec !== null ? sync1mLagSec / 60 : null,
      staleThresholdMin: 4,
      staleFeed: sync1mLagSec !== null ? sync1mLagSec > 240 : false,
    },
    strategies,
    decisions: traderDecisions,
    systemLogs,
    executionDiagnostics,
    alerts: {
      ops: opsAlerts,
      performance: perfAlerts,
    },
  };
}
