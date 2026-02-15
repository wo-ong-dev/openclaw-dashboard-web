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

const kstTooltipFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: KST_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour12: false,
  hour: "2-digit",
  minute: "2-digit",
});

function dayKey(date: Date): string {
  return kstDayKeyFormatter.format(date);
}

function formatTooltipKst(date: Date): string {
  const parts = kstTooltipFormatter.formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value ?? "----";
  const month = parts.find((p) => p.type === "month")?.value ?? "--";
  const day = parts.find((p) => p.type === "day")?.value ?? "--";
  const hour = parts.find((p) => p.type === "hour")?.value ?? "--";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "--";
  return `${year}/${month}/${day} ${hour}:${minute} KST`;
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

    const firstTs = data[0]?.time ?? 0;
    const lastTs = data.at(-1)?.time ?? firstTs;
    const daySpan = Math.max(0, Math.floor((lastTs - firstTs) / 86400));
    const nowKstKey = dayKey(new Date());
    const showMoreDateTicks = daySpan >= 2;
    const isCompact = () => (ref.current?.clientWidth ?? 0) < 520;

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
        timeFormatter: (time: Time) => {
          const date =
            typeof time === "number"
              ? new Date(Number(time) * 1000)
              : typeof time === "string"
                ? new Date(time)
                : new Date(Date.UTC(time.year, time.month - 1, time.day));
          return formatTooltipKst(date);
        },
      },
      width: ref.current.clientWidth,
      height: 440,
      rightPriceScale: { borderColor: "#22324a" },
      timeScale: {
        borderColor: "#22324a",
        timeVisible: true,
        tickMarkFormatter: (time: UTCTimestamp, tickMarkType: TickMarkType) => {
          const date = new Date(Number(time) * 1000);
          const kstKey = dayKey(date);
          const todayTick = kstKey === nowKstKey;

          if (tickMarkType === TickMarkType.Time || todayTick) {
            return (isCompact() ? kstTimeCompactFormatter : kstTimeFormatter).format(date);
          }

          if (showMoreDateTicks || isKstMidnight(date)) {
            return kstDateFormatter.format(date);
          }

          return "";
        },
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
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
