"use client";

import { useEffect, useMemo, useState } from "react";
import { CandleChart } from "@/components/CandleChart";
import { BinancePaperPayload, DashboardPayload, StrategyCard } from "@/lib/types";
import { formatKstDateTime, formatRelativeFromNow, freshnessTone } from "@/lib/time";

function fmt(n: number | null | undefined, digits = 0) {
  if (n === null || n === undefined || Number.isNaN(n)) return "-";
  return n.toLocaleString("ko-KR", { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

const POLL_MS = 7000;
const BINANCE_PAPER_POLL_MS = 30_000;
const EXTERNAL_API_BASE = process.env.NEXT_PUBLIC_DASHBOARD_API_BASE?.replace(/\/$/, "") ?? "";
const DASHBOARD_API_URL = EXTERNAL_API_BASE ? `${EXTERNAL_API_BASE}/dashboard` : "/api/dashboard";
const BINANCE_PAPER_ETH_API_URL = "/api/binance-paper?symbol=ETHUSDT";
const BINANCE_PAPER_BTC_API_URL = "/api/binance-paper?symbol=BTCUSDT";
const RISK_BANNER_DISMISS_KEY = "dashboard:risk-banner:dismissed-signature";

type ActiveTab = "btc" | "eth";

export default function Home() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("btc");
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [mobileStrategy, setMobileStrategy] = useState<"A" | "B" | "C">("A");
  const [decisionProfileFilter, setDecisionProfileFilter] = useState<"ALL" | "A" | "B" | "C">("ALL");
  const [dismissedSignature, setDismissedSignature] = useState<string | null>(null);

  useEffect(() => {
    try {
      setDismissedSignature(sessionStorage.getItem(RISK_BANNER_DISMISS_KEY));
    } catch {
      setDismissedSignature(null);
    }
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let mounted = true;

    const fetchData = async () => {
      try {
        const res = await fetch(DASHBOARD_API_URL, { cache: "no-store" });
        const json = (await res.json()) as DashboardPayload;
        if (!res.ok) throw new Error(`failed to fetch ${DASHBOARD_API_URL}`);
        if (mounted) {
          setData(json);
          setError(null);
        }
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    fetchData();
    const id = setInterval(fetchData, POLL_MS);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  const [binancePaperEth, setBinancePaperEth] = useState<BinancePaperPayload | null>(null);
  const [binancePaperEthError, setBinancePaperEthError] = useState<string | null>(null);
  const [binancePaperBtc, setBinancePaperBtc] = useState<BinancePaperPayload | null>(null);
  const [binancePaperBtcError, setBinancePaperBtcError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const fetchEth = async () => {
      try {
        const res = await fetch(BINANCE_PAPER_ETH_API_URL, { cache: "no-store" });
        if (!res.ok) throw new Error(`binance-paper eth api error ${res.status}`);
        const json = (await res.json()) as BinancePaperPayload;
        if (mounted) { setBinancePaperEth(json); setBinancePaperEthError(null); }
      } catch (e) {
        if (mounted) setBinancePaperEthError(e instanceof Error ? e.message : "Unknown error");
      }
    };
    fetchEth();
    const id = setInterval(fetchEth, BINANCE_PAPER_POLL_MS);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  useEffect(() => {
    let mounted = true;
    const fetchBtc = async () => {
      try {
        const res = await fetch(BINANCE_PAPER_BTC_API_URL, { cache: "no-store" });
        if (!res.ok) throw new Error(`binance-paper btc api error ${res.status}`);
        const json = (await res.json()) as BinancePaperPayload;
        if (mounted) { setBinancePaperBtc(json); setBinancePaperBtcError(null); }
      } catch (e) {
        if (mounted) setBinancePaperBtcError(e instanceof Error ? e.message : "Unknown error");
      }
    };
    fetchBtc();
    const id = setInterval(fetchBtc, BINANCE_PAPER_POLL_MS);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  const updatedAt = data?.updatedAt ?? null;
  const updated = useMemo(() => formatKstDateTime(updatedAt), [updatedAt]);
  const freshness = useMemo(() => freshnessTone(updatedAt, nowMs), [updatedAt, nowMs]);
  const riskBanner = useMemo(() => deriveRiskBanner(data), [data]);
  const showRiskBanner = !!riskBanner && riskBanner.signature !== dismissedSignature;

  useEffect(() => {
    if (!riskBanner) return;
    if (dismissedSignature && dismissedSignature !== riskBanner.signature) {
      setDismissedSignature(null);
      try {
        sessionStorage.removeItem(RISK_BANNER_DISMISS_KEY);
      } catch {}
    }
  }, [riskBanner, dismissedSignature]);

  const strategies = data?.strategies ?? [];
  const mobileStrategyCard = strategies.find((s) => s.profile === mobileStrategy) ?? strategies[0] ?? null;
  const strategySummary = useMemo(() => deriveStrategyCompareSummary(strategies), [strategies]);
  const filteredDecisions = useMemo(() => {
    const all = data?.decisions ?? [];
    if (decisionProfileFilter === "ALL") return all;

    const normalizeProfile = (value: unknown): "A" | "B" | "C" | null => {
      const text = String(value ?? "").trim().toUpperCase();
      if (text === "A" || text.endsWith(".A") || text.includes("_A") || text.includes("-A")) return "A";
      if (text === "B" || text.endsWith(".B") || text.includes("_B") || text.includes("-B")) return "B";
      if (text === "C" || text.endsWith(".C") || text.includes("_C") || text.includes("-C")) return "C";
      const m = text.match(/[ABC]/);
      return m ? (m[0] as "A" | "B" | "C") : null;
    };

    return all.filter((d) => normalizeProfile(d.profile) === decisionProfileFilter);
  }, [data?.decisions, decisionProfileFilter]);
  const decisionSubtitle = `최신 ${filteredDecisions.length}건 · KST${decisionProfileFilter === "ALL" ? "" : ` · 전략 ${decisionProfileFilter}`}`;
  const candleMeta = data?.candleSource;
  const candleSubtitle = candleMeta
    ? `${candleMeta.selectedTimeframe} 캔들 · 소스 ${candleMeta.selectedSourceFile} · 마지막 캔들 ${formatKstDateTime(candleMeta.lastCandleTs)} · 축/툴팁 시간 KST`
    : "캔들 · 축/툴팁 시간 KST";

  return (
    <>
      {showRiskBanner ? (
        <TopRiskBanner
          severity={riskBanner.severity}
          title={riskBanner.title}
          details={riskBanner.details}
          onDismiss={() => {
            setDismissedSignature(riskBanner.signature);
            try {
              sessionStorage.setItem(RISK_BANNER_DISMISS_KEY, riskBanner.signature);
            } catch {}
          }}
        />
      ) : null}

      <div className={`bg-[#050b14] sticky top-0 z-40 border-b border-slate-800/90 ${showRiskBanner ? "mt-14 md:mt-16" : ""}`}>
        <div className="mx-auto max-w-[1600px] px-3 md:px-6">
          <div className="inline-flex gap-1 py-2">
            {(["btc", "eth"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                  activeTab === tab
                    ? "bg-sky-500/20 text-sky-200 border border-sky-500/40"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent"
                }`}
              >
                {tab === "btc" ? "BTC 모의투자" : "ETH 모의투자"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {activeTab === "eth" ? (
        <BinancePaperTab symbol="ETH" data={binancePaperEth} error={binancePaperEthError} nowMs={nowMs} />
      ) : null}
      {activeTab === "btc" ? (
        <BinancePaperTab symbol="BTC" data={binancePaperBtc} error={binancePaperBtcError} nowMs={nowMs} />
      ) : null}

      <main className="hidden">
        <div className="mx-auto max-w-[1600px] space-y-5">
          <header className="rounded-xl border border-slate-800/90 bg-[#0b1220] p-4 md:p-5 shadow-sm shadow-black/20">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-2">
                <h1 className="text-xl md:text-2xl font-semibold tracking-tight">BTC 모의투자 대시보드_By Wo_ong</h1>
                <p className="text-xs md:text-sm text-slate-400">모든 시간은 KST(Asia/Seoul) 기준 · {POLL_MS / 1000}초마다 갱신</p>
                <div className="flex items-center gap-2">
                  <FreshnessBadge tone={freshness} label={formatRelativeFromNow(updatedAt, nowMs)} />
                  <span className="text-[11px] md:text-xs text-slate-400">마지막 갱신 {updated}</span>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm w-full md:w-auto">
                <Stat label="현재가" value={fmt(data?.market.lastPrice)} />
                <Stat label="24h 변동률" value={`${fmt(data?.market.changePct)}%`} />
                <Stat label="24h 고가" value={fmt(data?.market.high24h)} />
                <Stat label="24h 저가" value={fmt(data?.market.low24h)} />
                <Stat label="24h 거래량 (시장, BTC)" value={fmt(data?.market.volume24h)} />
              </div>
            </div>
            {error ? <InlineState kind="error" message={`데이터 갱신 오류: ${error}`} /> : null}
            {!error && isLoading ? <InlineState kind="loading" message="데이터를 불러오는 중입니다..." /> : null}
          </header>

          <StrategyCompareCard summary={strategySummary} />

          <FreshnessPanel data={data} />

          <section className="grid grid-cols-1 xl:grid-cols-4 gap-4">
            <div className="xl:col-span-3 rounded-xl border border-slate-800 bg-[#0b1220] p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <SectionTitle title="캔들 차트" subtitle={candleSubtitle} />
                {candleMeta ? (
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] ${
                    candleMeta.fallbackFrom ? "bg-amber-950/60 text-amber-300 border-amber-700/60" : "bg-sky-950/50 text-sky-300 border-sky-700/60"
                  }`}>
                    소스 {candleMeta.selectedTimeframe}
                    {candleMeta.fallbackFrom ? " (auto-fallback)" : ""}
                  </span>
                ) : null}
              </div>
              {candleMeta?.warning ? <InlineState kind="loading" message={candleMeta.warning} /> : null}
              {data?.candles?.length ? <CandleChart data={data.candles} /> : <PanelState kind="empty" message="표시할 캔들 데이터가 없습니다." />}
            </div>

            <aside className="space-y-3">
              <SectionTitle title="전략 상태" subtitle="A/B/C 프로필 성능 요약" />
              {strategies.length === 0 ? (
                <PanelState kind="empty" message="전략 상태 데이터가 없습니다." />
              ) : (
                <>
                  <div className="md:hidden overflow-x-auto pb-1">
                    <div className="inline-flex min-w-full rounded-xl border border-slate-700/70 bg-slate-900/50 p-1">
                      {(["A", "B", "C"] as const).map((profile) => {
                        const exists = strategies.some((s) => s.profile === profile);
                        return (
                          <button
                            key={profile}
                            type="button"
                            disabled={!exists}
                            onClick={() => setMobileStrategy(profile)}
                            className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition ${
                              mobileStrategy === profile
                                ? "bg-sky-500/20 text-sky-200"
                                : "text-slate-300 hover:bg-slate-800/70"
                            } ${!exists ? "opacity-40" : ""}`}
                          >
                            전략 {profile}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="md:hidden">{mobileStrategyCard ? <StrategyStatusCard strategy={mobileStrategyCard} currentPrice={data?.market.lastPrice ?? null} /> : null}</div>

                  <div className="hidden md:block space-y-3">
                    {strategies.map((s) => (
                      <StrategyStatusCard key={s.profile} strategy={s} currentPrice={data?.market.lastPrice ?? null} />
                    ))}
                  </div>
                </>
              )}
            </aside>
          </section>

          <section className="grid grid-cols-1 gap-4">
            <div className="rounded-xl border border-slate-800 bg-[#0b1220] p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <SectionTitle title="최근 의사결정" subtitle={decisionSubtitle} />
                <div className="flex items-center gap-2">
                  <div className="inline-flex rounded-lg border border-slate-700/70 bg-slate-900/50 p-1 text-[11px]">
                    {(["ALL", "A", "B", "C"] as const).map((profile) => (
                      <button
                        key={profile}
                        type="button"
                        onClick={() => setDecisionProfileFilter(profile)}
                        className={`rounded px-2 py-1 font-semibold transition ${
                          decisionProfileFilter === profile ? "bg-sky-500/20 text-sky-200" : "text-slate-300 hover:bg-slate-800/70"
                        }`}
                      >
                        {profile === "ALL" ? "전체" : `전략 ${profile}`}
                      </button>
                    ))}
                  </div>
                  <ExecutionBadge
                    executed={data?.executionDiagnostics?.executed_decisions ?? 0}
                    expected={data?.executionDiagnostics?.last60m_expected ?? 12}
                    skipped={data?.executionDiagnostics?.skipped_total ?? 0}
                    rejected={data?.executionDiagnostics?.rejected_total ?? 0}
                  />
                </div>
              </div>
              {filteredDecisions.length === 0 ? (
                <PanelState kind="empty" message="선택한 전략의 최근 의사결정 기록이 없습니다." />
              ) : (
                <div className="max-h-64 overflow-auto text-xs">
                  <table className="w-full">
                    <thead className="text-slate-400">
                      <tr>
                        <th className="text-left py-1">시간 (KST)</th>
                        <th className="text-left py-1">전략</th>
                        <th className="text-left py-1">방향</th>
                        <th className="text-left py-1">결정 결과</th>
                        <th className="text-left py-1">핵심 사유</th>
                        <th className="text-left py-1">투자 비중</th>
                        <th className="text-left py-1">투입금액</th>
                        <th className="text-left py-1">청산손익</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredDecisions.map((d, i) => (
                        <tr key={`${d.ts}-${d.profile}-${i}`} className="border-t border-slate-900/90 align-top">
                          <td className="py-1 pr-2 text-slate-300">{formatKstDateTime(d.ts)}</td>
                          <td className="py-1 pr-2 text-slate-200">전략 {d.profile}</td>
                          <td className="py-1 pr-2">{directionLabel(d.direction)}</td>
                          <td className="py-1 pr-2">{resultLabel(d.result)}</td>
                          <td className="py-1 truncate max-w-[220px] text-slate-300" title={d.reason}>{humanizeDecisionReason(d.reason)}</td>
                          <td className="py-1 pr-2">{d.sizePct === null ? "-" : `${fmt(d.sizePct)}%`}</td>
                          <td className="py-1 pr-2 text-slate-300">{d.amountKrw === null ? "-" : `${fmt(d.amountKrw)} KRW${d.amountIsEstimated ? " (추정)" : ""}`}</td>
                          <td className={`py-1 pr-2 ${d.closePnlKrw === null ? "text-slate-500" : d.closePnlKrw > 0 ? "text-emerald-300" : d.closePnlKrw < 0 ? "text-rose-300" : "text-slate-300"}`}>
                            {d.closePnlKrw === null ? "-" : `${fmt(d.closePnlKrw)} KRW`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            <div className="mt-3 rounded-xl border border-slate-800/80 bg-slate-950/40 p-3">
              <details>
                <summary className="cursor-pointer text-xs text-slate-300">시스템 로그 (내부 EVT/인프라 이벤트)</summary>
                <div className="mt-2 max-h-40 overflow-auto text-[11px]">
                  {(data?.systemLogs ?? []).length === 0 ? (
                    <p className="text-slate-500">시스템 로그가 없습니다.</p>
                  ) : (
                    <table className="w-full">
                      <thead className="text-slate-500">
                        <tr>
                          <th className="text-left py-1">시간 (KST)</th>
                          <th className="text-left py-1">소스</th>
                          <th className="text-left py-1">상태</th>
                          <th className="text-left py-1">사유</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(data?.systemLogs ?? []).map((log, idx) => (
                          <tr key={`${log.ts}-${idx}`} className="border-t border-slate-900/90">
                            <td className="py-1 pr-2 text-slate-300">{formatKstDateTime(log.ts)}</td>
                            <td className="py-1 pr-2">{log.source}</td>
                            <td className="py-1 pr-2">{log.status}</td>
                            <td className="py-1 pr-2 text-slate-400">{log.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </details>
            </div>
            </div>

          </section>
        </div>
      </main>
    </>
  );
}

function FreshnessPanel({ data }: { data: DashboardPayload | null }) {
  const freshness = data?.freshness;
  if (!freshness) return null;

  const stateTone =
    freshness.policyState === "degraded"
      ? "text-rose-300 border-rose-700/60 bg-rose-950/30"
      : freshness.policyState === "watch"
        ? "text-amber-300 border-amber-700/60 bg-amber-950/30"
        : "text-emerald-300 border-emerald-700/60 bg-emerald-950/30";

  const lag = (sec: number | null) => (sec === null ? "-" : `${fmt(sec)}s`);

  return (
    <section className="rounded-xl border border-slate-800 bg-[#0b1220] p-4">
      <div className="mb-3 flex items-center justify-between">
        <SectionTitle title="데이터 신선도" subtitle="collector → raw → sync → executor 실시간 상태" />
        <span className={`rounded-full border px-2 py-0.5 text-[11px] ${stateTone}`}>
          health {freshness.healthScore}/100 · {freshness.policyState}
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
        <Stat label="collector" value={lag(freshness.collectorLagSec)} />
        <Stat label="raw write" value={lag(freshness.rawWriteLagSec)} />
        <Stat label="sync 1m" value={lag(freshness.sync1mLagSec)} />
        <Stat label="sync 5m" value={lag(freshness.sync5mLagSec)} />
        <Stat label="executor" value={lag(freshness.executorLagSec)} />
      </div>
      <p className="mt-2 text-xs text-slate-400">
        self-heal 1h {freshness.selfHealLast1h}회 · 24h {freshness.selfHealLast24h}회
      </p>
    </section>
  );
}

type StrategyCompareSummary = {
  leader: StrategyCard;
  mddBest: StrategyCard;
  mddWorst: StrategyCard;
};

function deriveStrategyCompareSummary(strategies: StrategyCard[]): StrategyCompareSummary | null {
  if (strategies.length === 0) return null;

  const leader = [...strategies].sort((a, b) => b.recentPnl24hPct - a.recentPnl24hPct || b.realizedPnlPct - a.realizedPnlPct)[0];
  const withMdd = strategies.filter((s) => s.mddPct !== null);
  const mddSorted = [...withMdd].sort((a, b) => (b.mddPct ?? -Infinity) - (a.mddPct ?? -Infinity));
  const mddBest = mddSorted[0] ?? leader;
  const mddWorst = mddSorted.at(-1) ?? leader;

  return { leader, mddBest, mddWorst };
}

function StrategyCompareCard({ summary }: { summary: StrategyCompareSummary | null }) {
  if (!summary) {
    return <PanelState kind="empty" message="전략 비교 요약을 표시할 데이터가 없습니다." />;
  }

  const leaderTone = summary.leader.recentPnl24hPct > 0 ? "text-emerald-300" : summary.leader.recentPnl24hPct < 0 ? "text-rose-300" : "text-slate-200";
  const mddGap = (summary.mddBest.mddPct ?? 0) - (summary.mddWorst.mddPct ?? 0);

  return (
    <section className="rounded-xl border border-slate-800 bg-[#0b1220] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold tracking-wide text-slate-100">전략 한 줄 비교</h2>
          <p className="mt-0.5 text-xs text-slate-400">최근 24시간 체결 손익(가능한 범위) + 누적 성과 + MDD 빠른 비교</p>
        </div>
        <span className="rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-200">리더: 전략 {summary.leader.profile}</span>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 text-sm md:grid-cols-3">
        <div className="rounded-lg bg-slate-900/40 px-3 py-2">
          <p className="text-[11px] text-slate-400">최근 24h 스냅샷</p>
          <p className={`font-semibold ${leaderTone}`}>
            전략 {summary.leader.profile} · {fmt(summary.leader.recentPnl24hPct)}% ({fmt(summary.leader.recentPnl24hKrw)} KRW)
          </p>
          <p className="text-[11px] text-slate-400">24h 청산 {summary.leader.recentTrades24h}건</p>
        </div>
        <div className="rounded-lg bg-slate-900/40 px-3 py-2">
          <p className="text-[11px] text-slate-400">누적 성과</p>
          <p className="font-semibold text-slate-100">전략 {summary.leader.profile} · {fmt(summary.leader.realizedPnlPct)}%</p>
        </div>
        <div className="rounded-lg bg-slate-900/40 px-3 py-2">
          <p className="text-[11px] text-slate-400">MDD 비교</p>
          <p className="font-semibold text-slate-100">
            최고 방어 전략 {summary.mddBest.profile} ({fmt(summary.mddBest.mddPct)}%) vs 약한 전략 {summary.mddWorst.profile} ({fmt(summary.mddWorst.mddPct)}%)
          </p>
          <p className="text-[11px] text-slate-400">격차 {fmt(mddGap)}%p</p>
        </div>
      </div>
    </section>
  );
}

function StrategyStatusCard({ strategy, currentPrice }: { strategy: StrategyCard; currentPrice: number | null }) {
  const position = getPositionMeta(strategy.position);
  const signal = getSignalMeta(strategy.signalQuality);
  const pnlPctValue = strategy.realizedPnlPct ?? 0;
  const pnlTone = pnlPctValue > 0 ? "text-emerald-300" : pnlPctValue < 0 ? "text-rose-300" : "text-slate-200";
  const hasOpenPosition = strategy.position !== 0 && strategy.qty > 0 && (currentPrice ?? 0) > 0;
  const positionAmountKrw = hasOpenPosition ? Math.abs(strategy.qty * (currentPrice ?? 0)) : null;
  const unrealizedPnlKrw = hasOpenPosition
    ? (strategy.position > 0 ? 1 : -1) * ((currentPrice ?? 0) - strategy.entry) * strategy.qty
    : null;
  const totalPnlKrw = strategy.realizedPnlKrw + (unrealizedPnlKrw ?? 0);
  const unrealizedTone = (unrealizedPnlKrw ?? 0) > 0 ? "text-emerald-300" : (unrealizedPnlKrw ?? 0) < 0 ? "text-rose-300" : "text-slate-200";
  const totalTone = totalPnlKrw > 0 ? "text-emerald-300" : totalPnlKrw < 0 ? "text-rose-300" : "text-slate-200";

  return (
    <article className="rounded-2xl border border-slate-700/70 bg-gradient-to-b from-[#111d31] to-[#0a1425] p-4 shadow-[0_8px_30px_rgba(0,0,0,0.25)]">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-base md:text-sm font-semibold text-slate-100">전략 {strategy.profile}</h3>
          <span className="rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium tracking-wide text-sky-300">
            프로필 {strategy.profile}
          </span>
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${position.className}`}>{position.label}</span>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 md:gap-3">
        <div className="rounded-lg bg-slate-900/40 px-3 py-2.5">
          <p className="text-[11px] uppercase tracking-wide text-slate-400">손익 (KRW)</p>
          <p className={`mt-1 text-lg md:text-base font-semibold leading-none ${pnlTone}`}>{fmt(strategy.realizedPnlKrw)}</p>
        </div>
        <div className="rounded-lg bg-slate-900/40 px-3 py-2.5">
          <p className="text-[11px] uppercase tracking-wide text-slate-400">손익 (%)</p>
          <p className={`mt-1 text-lg md:text-base font-semibold leading-none ${pnlTone}`}>{fmt(strategy.realizedPnlPct, 2)}%</p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs md:text-xs">
        <StatRow label="승률" value={`${fmt(strategy.winRate)}%`} />
        <StatRow label="MDD" value={`${fmt(strategy.mddPct)}%`} />
        <StatRow label="거래 수" value={`${strategy.tradesClosed}`} />
        <StatRow label="최근 판단" value={formatKstDateTime(strategy.lastDecisionTs)} />
        <StatRow label="현재 포지션 금액" value={positionAmountKrw === null ? "-" : `${fmt(positionAmountKrw)} KRW`} />
        <StatRow label="현재 포지션 손익" value={unrealizedPnlKrw === null ? "-" : `${fmt(unrealizedPnlKrw)} KRW`} valueClassName={unrealizedTone} />
        <StatRow label="합산 손익" value={`${fmt(totalPnlKrw)} KRW`} valueClassName={totalTone} />
      </dl>

      <div className="mt-3 border-t border-slate-700/60 pt-2">
        <p className="mb-1 text-[10px] uppercase tracking-wide text-slate-400">신호 품질</p>
        <div className="flex items-center gap-1.5">
          {([
            { key: "strong", label: "강함" },
            { key: "weak-filtered", label: "약함" },
            { key: "final", label: "최종" },
          ] as const).map((chip) => {
            const active = signal.activeKey === chip.key;
            return (
              <span
                key={chip.key}
                className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                  active ? signal.className : "border-slate-700 bg-slate-900/40 text-slate-400"
                }`}
              >
                {chip.label}
              </span>
            );
          })}
        </div>
      </div>
    </article>
  );
}

function TopRiskBanner({
  severity,
  title,
  details,
  onDismiss,
}: {
  severity: "warning" | "critical";
  title: string;
  details: string[];
  onDismiss: () => void;
}) {
  const tone =
    severity === "critical"
      ? "border-rose-500/70 bg-rose-950/95 text-rose-100"
      : "border-amber-500/70 bg-amber-950/95 text-amber-100";

  return (
    <div className={`fixed inset-x-0 top-0 z-50 border-b backdrop-blur ${tone}`}>
      <div className="mx-auto flex max-w-[1600px] items-start justify-between gap-3 px-3 py-2.5 md:px-6">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{severity === "critical" ? "[CRITICAL]" : "[WARNING]"} {title}</p>
          <p className="mt-0.5 text-xs opacity-90 break-words">{details.join(" · ")}</p>
        </div>
        <button
          type="button"
          className="shrink-0 rounded border border-white/30 px-2 py-1 text-xs font-medium hover:bg-white/10"
          onClick={onDismiss}
        >
          닫기
        </button>
      </div>
    </div>
  );
}

function deriveRiskBanner(data: DashboardPayload | null): {
  severity: "warning" | "critical";
  title: string;
  details: string[];
  signature: string;
} | null {
  if (!data) return null;

  const alerts = [...(data.alerts.ops ?? []), ...(data.alerts.performance ?? [])];
  const diagnosticsAny = ((data.executionDiagnostics ?? {}) as DashboardPayload["executionDiagnostics"] & {
    risk_hold?: boolean;
    ws_stalled?: boolean;
    event_stalled?: boolean;
    runtime_down?: boolean;
    flags?: Record<string, boolean | number | string>;
  });

  const warningDetails = new Set<string>();
  const criticalDetails = new Set<string>();

  for (const a of alerts) {
    const severity = String(a.severity ?? "").toLowerCase();
    const type = String(a.type ?? "").toLowerCase();
    const message = String(a.message ?? "");
    const joined = `${type} ${message}`.toLowerCase();

    if (severity.includes("critical") || severity.includes("error") || joined.includes("runtime down") || joined.includes("runtime_down")) {
      criticalDetails.add(message || type || "runtime critical");
      continue;
    }

    if (
      severity.includes("warn") ||
      joined.includes("risk_hold") ||
      joined.includes("ws_stalled") ||
      joined.includes("event_stalled")
    ) {
      warningDetails.add(message || type || "runtime warning");
    }
  }

  const skippedReasons = diagnosticsAny.skipped_reasons ?? {};
  const hasRiskHold = Number(skippedReasons.risk_hold ?? 0) > 0 || diagnosticsAny.risk_hold === true;
  const hasWsStalled = Number((skippedReasons as Record<string, number>).ws_stalled ?? 0) > 0 || diagnosticsAny.ws_stalled === true;
  const hasEventStalled = Number((skippedReasons as Record<string, number>).event_stalled ?? 0) > 0 || diagnosticsAny.event_stalled === true;
  const hasRuntimeDown =
    Number((skippedReasons as Record<string, number>).runtime_down ?? 0) > 0 ||
    Number((skippedReasons as Record<string, number>)["runtime down"] ?? 0) > 0 ||
    diagnosticsAny.runtime_down === true;

  const flags = diagnosticsAny.flags ?? {};
  if (flags.runtime_down === true) criticalDetails.add("runtime_down 플래그 감지");
  if (flags.ws_stalled === true) criticalDetails.add("ws_stalled 플래그 감지");
  if (flags.event_stalled === true) criticalDetails.add("event_stalled 플래그 감지");
  if (flags.risk_hold === true) warningDetails.add("risk_hold 플래그 감지");

  if (hasRuntimeDown) criticalDetails.add("runtime_down 상태");
  if (hasWsStalled) criticalDetails.add("ws_stalled 상태");
  if (hasEventStalled) criticalDetails.add("event_stalled 상태");
  if (hasRiskHold) warningDetails.add("risk_hold 상태");

  if (criticalDetails.size === 0 && warningDetails.size === 0) return null;

  const severity = criticalDetails.size > 0 ? "critical" : "warning";
  const details = severity === "critical" ? [...criticalDetails] : [...warningDetails];
  const signature = [severity, ...details].join("|");

  return {
    severity,
    title: severity === "critical" ? "운영 위험 상태 감지" : "주의가 필요한 상태 감지",
    details,
    signature,
  };
}

function StatRow({ label, value, valueClassName }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div className="flex items-center justify-between rounded-md bg-slate-900/30 px-2 py-1.5">
      <dt className="text-slate-400">{label}</dt>
      <dd className={`font-medium ${valueClassName ?? "text-slate-200"}`}>{value}</dd>
    </div>
  );
}

function getPositionMeta(position: number) {
  if (position > 0) return { label: "롱", className: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300" };
  if (position < 0) return { label: "숏", className: "border-rose-500/40 bg-rose-500/15 text-rose-300" };
  return { label: "없음", className: "border-slate-500/40 bg-slate-500/10 text-slate-300" };
}

function getSignalMeta(signal: StrategyCard["signalQuality"]) {
  switch (signal) {
    case "strong":
      return { activeKey: "strong", className: "border-sky-500/50 bg-sky-500/15 text-sky-300" } as const;
    case "weak-filtered":
      return { activeKey: "weak-filtered", className: "border-amber-500/50 bg-amber-500/15 text-amber-300" } as const;
    case "final":
      return { activeKey: "final", className: "border-violet-500/50 bg-violet-500/15 text-violet-300" } as const;
    default:
      return { activeKey: "", className: "border-slate-700 bg-slate-900/40 text-slate-400" } as const;
  }
}

function directionLabel(direction: DashboardPayload["decisions"][number]["direction"]) {
  if (direction === "LONG") return "롱";
  if (direction === "SHORT") return "숏";
  return "없음";
}

function resultLabel(result: DashboardPayload["decisions"][number]["result"]) {
  if (result === "ENTRY") return "진입";
  if (result === "NO_ENTRY") return "미진입";
  if (result === "EXIT") return "청산";
  return "스킵";
}

function humanizeDecisionReason(reason: string) {
  const raw = (reason ?? "").trim();
  if (!raw) return "사유 없음";

  const normalized = raw.toLowerCase();
  const rules: Array<[RegExp, string]> = [
    [/old[_\s-]?or[_\s-]?already[_\s-]?processed|already[_\s-]?processed/, "중복 봉 처리 방지"],
    [/event[_\s-]?5m[_\s-]?trigger|trigger/, "신규 진입 조건 미충족"],
    [/risk[_\s-]?hold|risk off/, "리스크 가드로 진입 보류"],
    [/ws[_\s-]?stalled|event[_\s-]?stalled|runtime[_\s-]?down/, "시스템 지연/중단으로 대기"],
    [/weak[_\s-]?signal|low[_\s-]?confidence|filter/, "신규 진입 조건 미충족"],
    [/no[_\s-]?signal|neutral|flat/, "뚜렷한 신호가 없어 대기"],
    [/already[_\s-]?in[_\s-]?position|position[_\s-]?exists/, "기존 포지션 유지"],
    [/take[_\s-]?profit|tp/, "목표 수익 도달로 정리"],
    [/stop[_\s-]?loss|sl/, "손실 제한 규칙으로 정리"],
    [/volatility|whipsaw/, "변동성이 커서 보수적으로 대기"],
  ];

  for (const [pattern, label] of rules) {
    if (pattern.test(normalized)) return label;
  }

  return raw.length > 24 ? `${raw.slice(0, 24)}…` : raw;
}

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-sm font-semibold tracking-wide text-slate-100">{title}</h2>
      {subtitle ? <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p> : null}
    </div>
  );
}

function InlineState({ kind, message }: { kind: "error" | "loading"; message: string }) {
  const tone = kind === "error" ? "border-red-700/60 text-red-300 bg-red-950/30" : "border-slate-700 text-slate-300 bg-slate-900/50";
  return <p className={`mt-3 rounded border px-3 py-2 text-xs ${tone}`}>{message}</p>;
}

function PanelState({ kind, message }: { kind: "empty" | "error"; message: string }) {
  const tone = kind === "error" ? "border-red-700/60 text-red-300" : "border-slate-700 text-slate-400";
  return <div className={`rounded border border-dashed p-4 text-sm ${tone}`}>{message}</div>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-slate-800 bg-[#0f172a] px-3 py-2">
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className="text-base md:text-sm font-semibold text-slate-100 tracking-tight">{value}</p>
    </div>
  );
}

function FreshnessBadge({ tone, label }: { tone: "fresh" | "stale" | "old"; label: string }) {
  const styles =
    tone === "fresh"
      ? "bg-emerald-950/60 text-emerald-300 border-emerald-700/60"
      : tone === "stale"
        ? "bg-amber-950/50 text-amber-300 border-amber-700/60"
        : "bg-rose-950/50 text-rose-300 border-rose-700/60";

  return <span className={`rounded-full border px-2 py-0.5 text-[11px] ${styles}`}>신선도: {label}</span>;
}

function ExecutionBadge({ executed, expected, skipped, rejected }: { executed: number; expected: number; skipped: number; rejected: number }) {
  const ratio = expected > 0 ? executed / expected : 0;
  const warn = ratio < 0.5 || rejected > 0;
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[11px] ${
        warn ? "bg-amber-950/60 text-amber-300 border-amber-700/60" : "bg-emerald-950/60 text-emerald-300 border-emerald-700/60"
      }`}
      title="최근 60분 실행/스킵/거절 진단"
    >
      60분 실행 {executed}/{expected} · 스킵 {skipped} · 거절 {rejected}
    </span>
  );
}

// ─── Binance Paper Trading Tab (ETH / BTC) ───────────────────────────────────

function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "-";
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function ProcessDot({ active }: { active: boolean }) {
  return (
    <span className={`inline-block h-2.5 w-2.5 rounded-full ${active ? "bg-emerald-400" : "bg-rose-500"}`} />
  );
}

function BinancePaperTab({
  symbol,
  data,
  error,
  nowMs,
}: {
  symbol: "ETH" | "BTC";
  data: BinancePaperPayload | null;
  error: string | null;
  nowMs: number;
}) {
  const updatedAt = data?.updated_at ?? null;
  const updatedLabel = updatedAt ? formatKstDateTime(updatedAt) : "-";
  const relLabel = updatedAt ? formatRelativeFromNow(updatedAt, nowMs) : null;

  return (
    <main className="min-h-screen bg-[#050b14] text-slate-100 p-3 md:p-6 pt-4 md:pt-6">
      <div className="mx-auto max-w-[1600px] space-y-5">
        {/* Header */}
        <header className="rounded-xl border border-slate-800/90 bg-[#0b1220] p-4 md:p-5 shadow-sm shadow-black/20">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Binance {symbol}/USDT 4h 페이퍼 트레이딩</h1>
              <p className="text-xs md:text-sm text-slate-400">모든 시간은 KST 기준 · {BINANCE_PAPER_POLL_MS / 1000}초마다 갱신</p>
              {relLabel ? (
                <p className="text-[11px] text-slate-400">마지막 갱신 {updatedLabel} · {relLabel}</p>
              ) : null}
            </div>
            {data?.current_price != null ? (
              <div className="rounded border border-slate-800 bg-[#0f172a] px-4 py-3 min-w-[140px]">
                <p className="text-[11px] text-slate-400">{symbol}/USDT 현재가</p>
                <p className="text-xl font-semibold text-sky-200 tracking-tight">${fmtNum(data.current_price, 2)}</p>
              </div>
            ) : null}
          </div>
          {error ? (
            <p className="mt-3 rounded border border-red-700/60 bg-red-950/30 px-3 py-2 text-xs text-red-300">
              데이터 갱신 오류: {error}
            </p>
          ) : null}
          {!data && !error ? (
            <p className="mt-3 rounded border border-slate-700 bg-slate-900/50 px-3 py-2 text-xs text-slate-300">
              데이터를 불러오는 중입니다...
            </p>
          ) : null}
        </header>

        {/* Process Status */}
        <section className="rounded-xl border border-slate-800 bg-[#0b1220] p-4">
          <div className="mb-3">
            <h2 className="text-sm font-semibold tracking-wide text-slate-100">프로세스 상태</h2>
            <p className="mt-0.5 text-xs text-slate-400">Binance {symbol} 페이퍼 트레이딩 구성 프로세스 실행 여부</p>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            {(
              [
                { key: "ws_collector" as "ws_collector", label: "WS Collector" },
                { key: "bar_close_runner" as "bar_close_runner", label: "Bar Close Runner" },
                { key: "event_executor" as "event_executor", label: "Event Executor" },
              ]
            ).map(({ key, label }) => {
              const active = data?.processes[key] ?? false;
              return (
                <div
                  key={key}
                  className="flex items-center gap-2 rounded-lg border border-slate-700/70 bg-slate-900/50 px-3 py-2"
                >
                  <ProcessDot active={active} />
                  <span className="text-slate-200 font-medium">{label}</span>
                  <span className={`text-xs ${active ? "text-emerald-400" : "text-rose-400"}`}>
                    {active ? "실행 중" : "중단"}
                  </span>
                </div>
              );
            })}
            {data?.ws_lag_sec != null ? (
              <div className="flex items-center gap-2 rounded-lg border border-slate-700/70 bg-slate-900/50 px-3 py-2">
                <span className="text-slate-400 text-xs">WS Lag</span>
                <span className="text-slate-200 font-medium text-sm">{fmtNum(data.ws_lag_sec, 2)}s</span>
              </div>
            ) : null}
          </div>
        </section>

        {/* Stats */}
        {data?.stats ? (
          <section className="rounded-xl border border-slate-800 bg-[#0b1220] p-4">
            <div className="mb-3">
              <h2 className="text-sm font-semibold tracking-wide text-slate-100">핵심 성과 지표</h2>
              <p className="mt-0.5 text-xs text-slate-400">{symbol} 4h 페이퍼 트레이딩 누적 성과</p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="rounded-lg border border-slate-800 bg-[#0f172a] px-3 py-2.5">
                <p className="text-[11px] text-slate-400">총 거래수</p>
                <p className="text-lg font-semibold text-slate-100 mt-1">{data.stats.trades}</p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-[#0f172a] px-3 py-2.5">
                <p className="text-[11px] text-slate-400">PF (Profit Factor)</p>
                <p
                  className={`text-lg font-semibold mt-1 ${
                    data.stats.pf === null
                      ? "text-slate-400"
                      : data.stats.pf >= 1.5
                        ? "text-emerald-300"
                        : data.stats.pf >= 1.0
                          ? "text-amber-300"
                          : "text-rose-300"
                  }`}
                >
                  {data.stats.pf === null ? "-" : fmtNum(data.stats.pf, 2)}
                </p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-[#0f172a] px-3 py-2.5">
                <p className="text-[11px] text-slate-400">승률</p>
                <p
                  className={`text-lg font-semibold mt-1 ${
                    data.stats.win_rate_pct === null
                      ? "text-slate-400"
                      : data.stats.win_rate_pct >= 50
                        ? "text-emerald-300"
                        : "text-rose-300"
                  }`}
                >
                  {data.stats.win_rate_pct === null ? "-" : `${fmtNum(data.stats.win_rate_pct, 1)}%`}
                </p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-[#0f172a] px-3 py-2.5">
                <p className="text-[11px] text-slate-400">기대값 (bps)</p>
                <p
                  className={`text-lg font-semibold mt-1 ${
                    data.stats.expectancy_bps === null
                      ? "text-slate-400"
                      : data.stats.expectancy_bps > 0
                        ? "text-emerald-300"
                        : "text-rose-300"
                  }`}
                >
                  {data.stats.expectancy_bps === null ? "-" : fmtNum(data.stats.expectancy_bps, 1)}
                </p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-[#0f172a] px-3 py-2.5">
                <p className="text-[11px] text-slate-400">MDD</p>
                <p
                  className={`text-lg font-semibold mt-1 ${
                    data.stats.max_drawdown_pct === null
                      ? "text-slate-400"
                      : data.stats.max_drawdown_pct <= -10
                        ? "text-rose-300"
                        : data.stats.max_drawdown_pct <= -5
                          ? "text-amber-300"
                          : "text-emerald-300"
                  }`}
                >
                  {data.stats.max_drawdown_pct === null ? "-" : `${fmtNum(data.stats.max_drawdown_pct, 2)}%`}
                </p>
              </div>
            </div>
            {data.stats.equity > 0 ? (
              <p className="mt-2 text-xs text-slate-400">
                평가 자산: <span className="text-slate-200 font-medium">${fmtNum(data.stats.equity, 2)}</span>
              </p>
            ) : null}
          </section>
        ) : null}

        {/* Open Positions + Recent Trades */}
        <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {/* Open Positions */}
          <div className="rounded-xl border border-slate-800 bg-[#0b1220] p-4">
            <div className="mb-3">
              <h2 className="text-sm font-semibold tracking-wide text-slate-100">오픈 포지션</h2>
              <p className="mt-0.5 text-xs text-slate-400">현재 보유 포지션 목록</p>
            </div>
            {!data || data.open_positions.length === 0 ? (
              <div className="rounded border border-dashed border-slate-700 p-4 text-sm text-slate-400">
                대기중 (오픈 포지션 없음)
              </div>
            ) : (
              <div className="overflow-x-auto text-xs">
                <table className="w-full">
                  <thead className="text-slate-400">
                    <tr>
                      <th className="text-left py-1 pr-2">ID</th>
                      <th className="text-left py-1 pr-2">방향</th>
                      <th className="text-right py-1 pr-2">진입가</th>
                      <th className="text-right py-1 pr-2">명목금액</th>
                      <th className="text-left py-1">진입 시각</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.open_positions.map((pos, i) => {
                      const sideTone =
                        pos.side.toUpperCase() === "LONG"
                          ? "text-emerald-300"
                          : pos.side.toUpperCase() === "SHORT"
                            ? "text-rose-300"
                            : "text-slate-300";
                      return (
                        <tr key={`${pos.trade_id}-${i}`} className="border-t border-slate-900/90 align-top">
                          <td className="py-1 pr-2 text-slate-400 font-mono">{pos.trade_id || "-"}</td>
                          <td className={`py-1 pr-2 font-semibold ${sideTone}`}>{pos.side || "-"}</td>
                          <td className="py-1 pr-2 text-right text-slate-200">${fmtNum(pos.entry_price, 2)}</td>
                          <td className="py-1 pr-2 text-right text-slate-200">${fmtNum(pos.notional, 2)}</td>
                          <td className="py-1 text-slate-400">{formatKstDateTime(pos.entry_bar_ts)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Recent Trades */}
          <div className="rounded-xl border border-slate-800 bg-[#0b1220] p-4">
            <div className="mb-3">
              <h2 className="text-sm font-semibold tracking-wide text-slate-100">최근 거래</h2>
              <p className="mt-0.5 text-xs text-slate-400">최근 10건 (최신순)</p>
            </div>
            {!data || data.recent_trades.length === 0 ? (
              <div className="rounded border border-dashed border-slate-700 p-4 text-sm text-slate-400">
                거래 기록이 없습니다.
              </div>
            ) : (
              <div className="overflow-x-auto text-xs">
                <table className="w-full">
                  <thead className="text-slate-400">
                    <tr>
                      <th className="text-left py-1 pr-2">방향</th>
                      <th className="text-right py-1 pr-2">진입가</th>
                      <th className="text-right py-1 pr-2">청산가</th>
                      <th className="text-right py-1 pr-2">수익(bps)</th>
                      <th className="text-right py-1 pr-2">PnL</th>
                      <th className="text-left py-1 pr-2">상태</th>
                      <th className="text-left py-1">진입 시각</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent_trades.map((trade, i) => {
                      const sideTone =
                        trade.side.toUpperCase() === "LONG"
                          ? "text-emerald-300"
                          : trade.side.toUpperCase() === "SHORT"
                            ? "text-rose-300"
                            : "text-slate-300";
                      const bpsTone =
                        trade.net_ret_bps === null
                          ? "text-slate-400"
                          : trade.net_ret_bps > 0
                            ? "text-emerald-300"
                            : trade.net_ret_bps < 0
                              ? "text-rose-300"
                              : "text-slate-300";
                      const pnlTone =
                        trade.pnl === null
                          ? "text-slate-400"
                          : trade.pnl > 0
                            ? "text-emerald-300"
                            : trade.pnl < 0
                              ? "text-rose-300"
                              : "text-slate-300";
                      return (
                        <tr key={`${trade.trade_id}-${i}`} className="border-t border-slate-900/90 align-top">
                          <td className={`py-1 pr-2 font-semibold ${sideTone}`}>{trade.side || "-"}</td>
                          <td className="py-1 pr-2 text-right text-slate-200">${fmtNum(trade.entry_price, 2)}</td>
                          <td className="py-1 pr-2 text-right text-slate-300">
                            {trade.exit_price != null ? `$${fmtNum(trade.exit_price, 2)}` : "-"}
                          </td>
                          <td className={`py-1 pr-2 text-right font-medium ${bpsTone}`}>
                            {trade.net_ret_bps != null ? fmtNum(trade.net_ret_bps, 1) : "-"}
                          </td>
                          <td className={`py-1 pr-2 text-right font-medium ${pnlTone}`}>
                            {trade.pnl != null ? `$${fmtNum(trade.pnl, 2)}` : "-"}
                          </td>
                          <td className="py-1 pr-2 text-slate-400">{trade.status || "-"}</td>
                          <td className="py-1 text-slate-400">{formatKstDateTime(trade.entry_bar_ts)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        {/* Candle Chart */}
        <section className="rounded-xl border border-slate-800 bg-[#0b1220] p-4">
          <div className="mb-3">
            <h2 className="text-sm font-semibold tracking-wide text-slate-100">캔들 차트</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              {symbol}/USDT 1h 캔들 · 최근 200봉 · 축/툴팁 시간 KST
            </p>
          </div>
          {data?.candles && data.candles.length > 0 ? (
            <CandleChart data={data.candles} />
          ) : (
            <div className="flex items-center justify-center h-40 rounded border border-dashed border-slate-700 text-sm text-slate-500">
              캔들 데이터를 불러오는 중입니다...
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

