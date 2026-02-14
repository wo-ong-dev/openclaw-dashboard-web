"use client";

import { useEffect, useMemo, useState } from "react";
import { CandleChart } from "@/components/CandleChart";
import { AlertRow, DashboardPayload, StrategyCard } from "@/lib/types";
import { formatKstDateTime, formatRelativeFromNow, freshnessTone } from "@/lib/time";

function fmt(n: number | null | undefined, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "-";
  return n.toLocaleString("ko-KR", { maximumFractionDigits: digits });
}

const POLL_MS = 7000;
const EXTERNAL_API_BASE = process.env.NEXT_PUBLIC_DASHBOARD_API_BASE?.replace(/\/$/, "") ?? "";
const DASHBOARD_API_URL = EXTERNAL_API_BASE ? `${EXTERNAL_API_BASE}/dashboard` : "/api/dashboard";
const RISK_BANNER_DISMISS_KEY = "dashboard:risk-banner:dismissed-signature";

export default function Home() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [mobileStrategy, setMobileStrategy] = useState<"A" | "B" | "C">("A");
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

      <main className={`min-h-screen bg-[#050b14] text-slate-100 p-3 md:p-6 ${showRiskBanner ? "pt-20 md:pt-24" : "pt-4 md:pt-6"}`}>
        <div className="mx-auto max-w-[1600px] space-y-5">
          <header className="rounded-xl border border-slate-800/90 bg-[#0b1220] p-4 md:p-5 shadow-sm shadow-black/20">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-2">
                <h1 className="text-xl md:text-2xl font-semibold tracking-tight">{data?.symbol ?? "KRW-BTC"} 읽기 전용 대시보드</h1>
                <p className="text-xs md:text-sm text-slate-400">모든 시간은 KST(Asia/Seoul) 기준 · {POLL_MS / 1000}초마다 갱신</p>
                <div className="flex items-center gap-2">
                  <FreshnessBadge tone={freshness} label={formatRelativeFromNow(updatedAt, nowMs)} />
                  <span className="text-[11px] md:text-xs text-slate-400">마지막 갱신 {updated}</span>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm w-full md:w-auto">
                <Stat label="현재가" value={fmt(data?.market.lastPrice, 0)} />
                <Stat label="24h 변동률" value={`${fmt(data?.market.changePct, 2)}%`} />
                <Stat label="24h 고가" value={fmt(data?.market.high24h, 0)} />
                <Stat label="24h 저가" value={fmt(data?.market.low24h, 0)} />
                <Stat label="24h 거래량" value={fmt(data?.market.volume24h, 3)} />
              </div>
            </div>
            {error ? <InlineState kind="error" message={`데이터 갱신 오류: ${error}`} /> : null}
            {!error && isLoading ? <InlineState kind="loading" message="데이터를 불러오는 중입니다..." /> : null}
          </header>

          <StrategyCompareCard summary={strategySummary} />

          <section className="grid grid-cols-1 xl:grid-cols-4 gap-4">
            <div className="xl:col-span-3 rounded-xl border border-slate-800 bg-[#0b1220] p-4">
              <SectionTitle title="캔들 차트" subtitle="1m 캔들 · 축/툴팁 시간 KST" />
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

                  <div className="md:hidden">{mobileStrategyCard ? <StrategyStatusCard strategy={mobileStrategyCard} /> : null}</div>

                  <div className="hidden md:block space-y-3">
                    {strategies.map((s) => (
                      <StrategyStatusCard key={s.profile} strategy={s} />
                    ))}
                  </div>
                </>
              )}
            </aside>
          </section>

          <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 rounded-xl border border-slate-800 bg-[#0b1220] p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <SectionTitle title="최근 의사결정" subtitle="최신 20건 · KST" />
                <ExecutionBadge
                  executed={data?.executionDiagnostics?.executed_decisions ?? 0}
                  expected={data?.executionDiagnostics?.last60m_expected ?? 12}
                />
              </div>
              {(data?.decisions ?? []).length === 0 ? (
                <PanelState kind="empty" message="최근 의사결정 기록이 없습니다." />
              ) : (
                <div className="max-h-64 overflow-auto text-xs">
                  <table className="w-full">
                    <thead className="text-slate-400">
                      <tr>
                        <th className="text-left py-1">시간 (KST)</th>
                        <th className="text-left py-1">프로필</th>
                        <th className="text-left py-1">신호</th>
                        <th className="text-left py-1">행동</th>
                        <th className="text-left py-1">사유</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data?.decisions ?? []).map((d, i) => (
                        <tr key={`${d.ts}-${d.profile}-${i}`} className="border-t border-slate-900/90 align-top">
                          <td className="py-1 pr-2 text-slate-300">{formatKstDateTime(d.ts)}</td>
                          <td className="py-1 pr-2">{d.profile}</td>
                          <td className="py-1 pr-2">{d.signal}</td>
                          <td className="py-1 pr-2">{d.action}</td>
                          <td className="py-1 truncate max-w-[240px] text-slate-300" title={d.reason}>
                            {d.reason}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <AlertPanel title="운영 알림" items={data?.alerts.ops ?? []} nowMs={nowMs} />
              <AlertPanel title="성과 알림" items={data?.alerts.performance ?? []} nowMs={nowMs} />
            </div>
          </section>
        </div>
      </main>
    </>
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
            전략 {summary.leader.profile} · {fmt(summary.leader.recentPnl24hPct, 3)}% ({fmt(summary.leader.recentPnl24hKrw, 0)} KRW)
          </p>
          <p className="text-[11px] text-slate-400">24h 청산 {summary.leader.recentTrades24h}건</p>
        </div>
        <div className="rounded-lg bg-slate-900/40 px-3 py-2">
          <p className="text-[11px] text-slate-400">누적 성과</p>
          <p className="font-semibold text-slate-100">전략 {summary.leader.profile} · {fmt(summary.leader.realizedPnlPct, 3)}%</p>
        </div>
        <div className="rounded-lg bg-slate-900/40 px-3 py-2">
          <p className="text-[11px] text-slate-400">MDD 비교</p>
          <p className="font-semibold text-slate-100">
            최고 방어 전략 {summary.mddBest.profile} ({fmt(summary.mddBest.mddPct, 3)}%) vs 약한 전략 {summary.mddWorst.profile} ({fmt(summary.mddWorst.mddPct, 3)}%)
          </p>
          <p className="text-[11px] text-slate-400">격차 {fmt(mddGap, 3)}%p</p>
        </div>
      </div>
    </section>
  );
}

function StrategyStatusCard({ strategy }: { strategy: StrategyCard }) {
  const position = getPositionMeta(strategy.position);
  const signal = getSignalMeta(strategy.signalQuality);
  const pnlPctValue = strategy.realizedPnlPct ?? 0;
  const pnlTone = pnlPctValue > 0 ? "text-emerald-300" : pnlPctValue < 0 ? "text-rose-300" : "text-slate-200";

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
          <p className={`mt-1 text-lg md:text-base font-semibold leading-none ${pnlTone}`}>{fmt(strategy.realizedPnlKrw, 0)}</p>
        </div>
        <div className="rounded-lg bg-slate-900/40 px-3 py-2.5">
          <p className="text-[11px] uppercase tracking-wide text-slate-400">손익 (%)</p>
          <p className={`mt-1 text-lg md:text-base font-semibold leading-none ${pnlTone}`}>{fmt(strategy.realizedPnlPct, 3)}%</p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs md:text-xs">
        <StatRow label="승률" value={`${fmt(strategy.winRate, 2)}%`} />
        <StatRow label="MDD" value={`${fmt(strategy.mddPct, 3)}%`} />
        <StatRow label="거래 수" value={`${strategy.tradesClosed}`} />
        <StatRow label="최근 판단" value={formatKstDateTime(strategy.lastDecisionTs)} />
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

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-md bg-slate-900/30 px-2 py-1.5">
      <dt className="text-slate-400">{label}</dt>
      <dd className="font-medium text-slate-200">{value}</dd>
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

function ExecutionBadge({ executed, expected }: { executed: number; expected: number }) {
  const ratio = expected > 0 ? executed / expected : 0;
  const warn = ratio < 0.5;
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[11px] ${
        warn ? "bg-amber-950/60 text-amber-300 border-amber-700/60" : "bg-emerald-950/60 text-emerald-300 border-emerald-700/60"
      }`}
      title="최근 60분 이벤트 기반 실행 커버리지"
    >
      최근 60분 실행 {executed}/{expected}
    </span>
  );
}

function AlertPanel({ title, items, nowMs }: { title: string; items: AlertRow[]; nowMs: number }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-[#0b1220] p-3">
      <SectionTitle title={title} subtitle="타임스탬프/상대시간 모두 KST 기준" />
      {items.length === 0 ? (
        <PanelState kind="empty" message="새 알림이 없습니다." />
      ) : (
        <ul className="space-y-2 max-h-32 overflow-auto text-xs">
          {items.map((a, i) => (
            <li key={`${a.ts}-${i}`} className="border-l-2 border-slate-700 pl-2">
              <div className="flex items-center gap-2">
                <span className="text-slate-300">{formatKstDateTime(a.ts)}</span>
                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300" title={formatKstDateTime(a.ts)}>
                  {formatRelativeFromNow(a.ts, nowMs)}
                </span>
              </div>
              <p className="text-slate-200">
                [{a.severity}] {a.message}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
