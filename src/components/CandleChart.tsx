"use client";

import { useEffect, useRef } from "react";
import { CandlestickSeries, ColorType, HistogramSeries, TickMarkType, Time, UTCTimestamp, createChart } from "lightweight-charts";
import { CandlePoint } from "@/lib/types";
import { KST_TIMEZONE } from "@/lib/time";

type Props = {
  data: CandlePoint[];
};

const kstDayKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: KST_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const kstDateFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: KST_TIMEZONE,
  month: "2-digit",
  day: "2-digit",
});

const kstTimeFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: KST_TIMEZONE,
  hour12: false,
  hour: "2-digit",
  minute: "2-digit",
});

const kstTimeCompactFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: KST_TIMEZONE,
  hour12: false,
  hour: "numeric",
  minute: "2-digit",
});

const kstHourMinuteFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: KST_TIMEZONE,
  hour12: false,
  hour: "2-digit",
  minute: "2-digit",
});

const kstTooltipDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: KST_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function dayKey(date: Date): string {
  return kstDayKeyFormatter.format(date);
}

function formatTooltipKst(date: Date): string {
  const timeLabel = kstTimeFormatter.format(date);
  const dateLabel = kstTooltipDateFormatter.format(date).replaceAll("-", "/");
  return `${timeLabel} · ${dateLabel} KST`;
}

function toDateFromChartTime(time: Time): Date {
  if (typeof time === "number") return new Date(Number(time) * 1000);
  if (typeof time === "string") return new Date(time);
  return new Date(Date.UTC(time.year, time.month - 1, time.day));
}

function isKstMidnight(date: Date): boolean {
  const parts = kstHourMinuteFormatter.formatToParts(date);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  return hour === "00" && minute === "00";
}

export function CandleChart({ data }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;

    const nowKstKey = dayKey(new Date());
    const isCompact = () => (ref.current?.clientWidth ?? 0) < 520;
    const dayBoundaryTs = new Set<number>();
    for (let i = 1; i < data.length; i += 1) {
      const prev = data[i - 1];
      const curr = data[i];
      if (!prev || !curr) continue;
      const prevKey = dayKey(new Date(prev.time * 1000));
      const currKey = dayKey(new Date(curr.time * 1000));
      if (prevKey !== currKey) dayBoundaryTs.add(curr.time);
    }

    const chart = createChart(ref.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#0b1220" },
        textColor: "#a8b8d1",
      },
      grid: {
        vertLines: { color: "#1c2940" },
        horzLines: { color: "#1c2940" },
      },
      localization: {
        locale: "ko-KR",
        timeFormatter: (time: Time) => formatTooltipKst(toDateFromChartTime(time)),
        priceFormatter: (price: number) => Math.round(price).toLocaleString("ko-KR"),
      },
      width: ref.current.clientWidth,
      height: 440,
      rightPriceScale: { borderColor: "#22324a" },
      handleScale: {
        axisPressedMouseMove: {
          price: false,
          time: true,
        },
      },
      timeScale: {
        borderColor: "#22324a",
        timeVisible: true,
        tickMarkFormatter: (time: UTCTimestamp, tickMarkType: TickMarkType) => {
          const ts = Number(time);
          const date = new Date(ts * 1000);
          const kstKey = dayKey(date);
          const todayTick = kstKey === nowKstKey;

          if (dayBoundaryTs.has(ts) || (tickMarkType !== TickMarkType.Time && isKstMidnight(date))) {
            return kstDateFormatter.format(date);
          }

          // 오늘 구간은 항상 시:분 우선 노출 (모바일은 compact)
          if (todayTick || tickMarkType === TickMarkType.Time) {
            return (isCompact() ? kstTimeCompactFormatter : kstTimeFormatter).format(date);
          }

          // 과거 구간도 날짜 라벨 남발 없이 시:분 우선
          return (isCompact() ? kstTimeCompactFormatter : kstTimeFormatter).format(date);
        },
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
      priceFormat: { type: "price", precision: 0, minMove: 1 },
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "",
      color: "#334155",
    });

    candleSeries.setData(
      data.map(({ time, open, high, low, close }) => ({ time: time as UTCTimestamp, open, high, low, close })),
    );
    volumeSeries.setData(
      data.map(({ time, volume, open, close }) => ({
        time: time as UTCTimestamp,
        value: volume,
        color: close >= open ? "rgba(34,197,94,0.4)" : "rgba(239,68,68,0.4)",
      })),
    );

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      if (ref.current) chart.applyOptions({ width: ref.current.clientWidth });
    });
    ro.observe(ref.current);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [data]);

  return <div ref={ref} className="w-full" />;
}
