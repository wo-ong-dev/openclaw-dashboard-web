export type CandlePoint = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type StrategyCard = {
  profile: "A" | "B" | "C";
  position: number;
  qty: number;
  entry: number;
  cash: number;
  realizedPnlKrw: number;
  realizedPnlPct: number;
  recentPnl24hKrw: number;
  recentPnl24hPct: number;
  recentTrades24h: number;
  winRate: number | null;
  mddPct: number | null;
  tradesClosed: number;
  signalQuality: "strong" | "weak-filtered" | "final" | "unknown";
  lastDecisionTs: string | null;
};

export type DecisionRow = {
  ts: string;
  profile: "A" | "B" | "C";
  direction: "LONG" | "SHORT" | "NONE";
  result: "ENTRY" | "NO_ENTRY" | "EXIT" | "SKIP";
  reason: string;
  sizePct: number | null;
  amountKrw: number | null;
  amountIsEstimated: boolean;
};

export type SystemLogRow = {
  ts: string;
  source: "EVT";
  status: "executed" | "skipped" | "rejected" | "info";
  reason: string;
};

export type AlertRow = {
  ts: string;
  severity: string;
  type: string;
  message: string;
};

export type CandleSourceMeta = {
  selectedTimeframe: "1m" | "5m";
  selectedSourceFile: string;
  fallbackFrom: "1m" | null;
  warning: string | null;
  lastCandleTs: string | null;
  decisionLatestTs: string | null;
  lagMin: number | null;
  staleThresholdMin: number;
  staleFeed: boolean;
};

export type FreshnessMeta = {
  collectorLagSec: number | null;
  rawWriteLagSec: number | null;
  sync1mLagSec: number | null;
  sync5mLagSec: number | null;
  executorLagSec: number | null;
  selfHealLast1h: number;
  selfHealLast24h: number;
  healthScore: number;
  policyState: "recovered" | "watch" | "degraded";
};

export type DashboardPayload = {
  snapshotSchemaVersion: string;
  symbol: string;
  updatedAt: string;
  freshness: FreshnessMeta;
  market: {
    lastPrice: number | null;
    changePct: number | null;
    high24h: number | null;
    low24h: number | null;
    volume24h: number | null;
  };
  candleSource: CandleSourceMeta;
  candles: CandlePoint[];
  strategies: StrategyCard[];
  decisions: DecisionRow[];
  systemLogs: SystemLogRow[];
  executionDiagnostics: {
    last60m_expected: number;
    observed_events: number;
    executed_decisions: number;
    skipped_total: number;
    skipped_reasons: Record<string, number>;
    rejected_total: number;
    rejected_reasons: Record<string, number>;
    source: "event_activity" | "execution_diagnostics" | "fallback";
  };
  alerts: {
    ops: AlertRow[];
    performance: AlertRow[];
  };
};
