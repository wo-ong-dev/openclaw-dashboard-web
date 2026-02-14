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
  profile: "A" | "B" | "C" | "EVT";
  signal: number;
  action: "BUY" | "SELL" | "HOLD" | "EXECUTED" | "SKIPPED" | "REJECTED";
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
};

export type DashboardPayload = {
  snapshotSchemaVersion: string;
  symbol: string;
  updatedAt: string;
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
