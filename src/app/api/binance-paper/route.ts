import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { BinancePaperPayload, CandlePoint } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ROOT = path.resolve(process.cwd(), "..");

function getFiles(symbol: "ETHUSDT" | "BTCUSDT") {
  const sym = symbol.toLowerCase();
  const symSuffix = symbol === "ETHUSDT" ? "" : `_${sym}`;
  return {
    status: path.join(ROOT, `outputs/binance_paper_status${symSuffix}.json`),
    stats: path.join(ROOT, `outputs/paper/paper_stats_${sym}_4h.json`),
    positions: path.join(ROOT, `data/paper/${sym}_4h_positions.json`),
    trades: path.join(ROOT, `outputs/paper/paper_trades_${sym}_4h.jsonl`),
    price: path.join(ROOT, `data/ws/latest_binance_${sym}_1h.json`),
    candles: path.join(ROOT, `data/live/binance_${sym}_1h.csv`),
  };
}

async function readTextSafe(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return "";
  }
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

async function readJsonlSafe(filePath: string, limit = 20): Promise<Record<string, unknown>[]> {
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
    })
    .filter((row) => Object.keys(row).length > 0);
}

async function readCandlesCsv(filePath: string, limit = 200): Promise<CandlePoint[]> {
  const text = await readTextSafe(filePath);
  if (!text) return [];
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  // Skip header row
  const dataLines = lines.slice(1).slice(-limit);
  const points: CandlePoint[] = [];
  for (const line of dataLines) {
    const [ts, open, high, low, close, volume] = line.split(",");
    if (!ts) continue;
    const time = Math.floor(new Date(ts.trim()).getTime() / 1000);
    if (!isFinite(time) || time <= 0) continue;
    points.push({
      time,
      open: parseFloat(open) || 0,
      high: parseFloat(high) || 0,
      low: parseFloat(low) || 0,
      close: parseFloat(close) || 0,
      volume: parseFloat(volume) || 0,
    });
  }
  return points;
}

function asNullableNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? n : typeof v === "number" ? 0 : null;
}

function asNumber(v: unknown): number {
  return asNullableNumber(v) ?? 0;
}

const EXTERNAL_API_BASE = process.env.NEXT_PUBLIC_DASHBOARD_API_BASE?.replace(/\/$/, "") ?? "";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const rawSymbol = (searchParams.get("symbol") ?? "ETHUSDT").toUpperCase();
    const symbol: "ETHUSDT" | "BTCUSDT" = rawSymbol === "BTCUSDT" ? "BTCUSDT" : "ETHUSDT";

    // ── 외부 API 모드 (Vercel 배포 시) ─────────────────────────────────────
    if (EXTERNAL_API_BASE) {
      const upstream = `${EXTERNAL_API_BASE}/binance-paper?symbol=${symbol}`;
      const res = await fetch(upstream, { cache: "no-store" });
      const json = await res.json();
      return NextResponse.json(json, {
        status: res.status,
        headers: { "Cache-Control": "no-store" },
      });
    }

    // ── 로컬 파일 직접 읽기 (localhost 개발 시) ────────────────────────────
    const FILES = getFiles(symbol);

    const [statusRaw, statsRaw, positionsRaw, tradesRaw, priceRaw, candles] = await Promise.all([
      readJsonSafe<Record<string, unknown>>(FILES.status, {}),
      readJsonSafe<Record<string, unknown>>(FILES.stats, {}),
      readJsonSafe<unknown[]>(FILES.positions, []),
      readJsonlSafe(FILES.trades, 20),
      readJsonSafe<Record<string, unknown>>(FILES.price, {}),
      readCandlesCsv(FILES.candles, 200),
    ]);

    // Processes
    const running = (statusRaw.running ?? {}) as Record<string, unknown>;
    const processes = {
      ws_collector: running.ws_collector === true,
      bar_close_runner: running.bar_close_runner === true,
      event_executor: running.event_executor === true,
    };

    // WS lag
    const lag = (statusRaw.lag ?? {}) as Record<string, unknown>;
    const ws_lag_sec = asNullableNumber(lag.collector_lag_sec);

    // Current price
    let current_price: number | null = null;
    try {
      const kline = (priceRaw.k ?? priceRaw) as Record<string, unknown>;
      const closeStr = kline.c ?? kline.close;
      const n = asNullableNumber(closeStr);
      if (n !== null && n > 0) current_price = n;
    } catch {
      current_price = null;
    }

    // Stats
    let stats: BinancePaperPayload["stats"] = null;
    if (Object.keys(statsRaw).length > 0) {
      stats = {
        trades: asNumber(statsRaw.trades ?? statsRaw.total_trades ?? statsRaw.n_trades),
        pf: asNullableNumber(statsRaw.profit_factor ?? statsRaw.pf),
        win_rate_pct: asNullableNumber(statsRaw.win_rate_pct ?? statsRaw.win_rate),
        expectancy_bps: asNullableNumber(statsRaw.expectancy_bps ?? statsRaw.expectancy),
        max_drawdown_pct: asNullableNumber(statsRaw.max_drawdown_pct ?? statsRaw.mdd_pct ?? statsRaw.mdd),
        equity: asNumber(statsRaw.equity ?? statsRaw.final_equity ?? 0),
      };
    }

    // Open positions
    const open_positions: BinancePaperPayload["open_positions"] = [];
    if (Array.isArray(positionsRaw)) {
      for (const pos of positionsRaw) {
        if (!pos || typeof pos !== "object") continue;
        const p = pos as Record<string, unknown>;
        open_positions.push({
          trade_id: String(p.trade_id ?? p.id ?? ""),
          side: String(p.side ?? p.direction ?? ""),
          entry_price: asNumber(p.entry_price ?? p.entry),
          entry_bar_ts: String(p.entry_bar_ts ?? p.entry_ts ?? p.ts ?? ""),
          exit_bar_ts: p.exit_bar_ts != null ? String(p.exit_bar_ts) : null,
          notional: asNumber(p.notional ?? p.amount ?? 0),
        });
      }
    }

    // Recent trades (last 10, newest first)
    const recent_trades: BinancePaperPayload["recent_trades"] = tradesRaw
      .slice(-10)
      .reverse()
      .map((row) => ({
        trade_id: String(row.trade_id ?? row.id ?? ""),
        side: String(row.side ?? row.direction ?? ""),
        entry_price: asNumber(row.entry_price ?? row.entry),
        exit_price: asNullableNumber(row.exit_price ?? row.exit),
        net_ret_bps: asNullableNumber(row.net_ret_bps ?? row.ret_bps ?? row.return_bps),
        pnl: asNullableNumber(row.pnl ?? row.profit),
        status: String(row.status ?? ""),
        entry_bar_ts: String(row.entry_bar_ts ?? row.entry_ts ?? row.ts ?? ""),
      }));

    const payload: BinancePaperPayload = {
      processes,
      ws_lag_sec,
      current_price,
      stats,
      open_positions,
      recent_trades,
      candles,
      updated_at: new Date().toISOString(),
    };

    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "failed_to_load_binance_paper_data",
        message: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 500 },
    );
  }
}
