"use client";

import { useEffect, useRef } from "react";
import { CandlestickSeries, ColorType, HistogramSeries, TickMarkType, Time, UTCTimestamp, createChart } from "lightweight-charts";
import { CandlePoint } from "@/lib/types";
import { formatKstDateTime } from "@/lib/time";

type Props = {
  data: CandlePoint[];
};

export function CandleChart({ data }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;

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
          if (typeof time === "number") return formatKstDateTime(Number(time) * 1000);
          if (typeof time === "string") return formatKstDateTime(time);
          return `${String(time.year).padStart(4, "0")}-${String(time.month).padStart(2, "0")}-${String(time.day).padStart(2, "0")} 00:00:00`;
        },
      },
      width: ref.current.clientWidth,
      height: 440,
      rightPriceScale: { borderColor: "#22324a" },
      timeScale: {
        borderColor: "#22324a",
        timeVisible: true,
        tickMarkFormatter: (time: UTCTimestamp, tickMarkType: TickMarkType) => {
          const dateMs = Number(time) * 1000;
          if (tickMarkType === TickMarkType.Time) {
            return new Date(dateMs).toLocaleTimeString("ko-KR", {
              timeZone: "Asia/Seoul",
              hour12: false,
              hour: "2-digit",
              minute: "2-digit",
            });
          }
          return new Date(dateMs).toLocaleDateString("ko-KR", {
            timeZone: "Asia/Seoul",
            month: "2-digit",
            day: "2-digit",
          });
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
