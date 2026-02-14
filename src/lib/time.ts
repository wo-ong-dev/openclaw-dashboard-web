const KST_TIMEZONE = "Asia/Seoul";

function toDate(input: string | number | Date | null | undefined): Date | null {
  if (input === null || input === undefined || input === "") return null;
  const date = input instanceof Date ? input : new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatKstDateTime(input: string | number | Date | null | undefined, includeSeconds = true): string {
  const date = toDate(input);
  if (!date) return "-";
  return date.toLocaleString("ko-KR", {
    timeZone: KST_TIMEZONE,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: includeSeconds ? "2-digit" : undefined,
  });
}

export function formatKstTime(input: string | number | Date | null | undefined): string {
  const date = toDate(input);
  if (!date) return "-";
  return date.toLocaleTimeString("ko-KR", {
    timeZone: KST_TIMEZONE,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatRelativeFromNow(input: string | number | Date | null | undefined, nowMs = Date.now()): string {
  const date = toDate(input);
  if (!date) return "시간 정보 없음";
  const diffSec = Math.round((date.getTime() - nowMs) / 1000);
  const absSec = Math.abs(diffSec);

  const rtf = new Intl.RelativeTimeFormat("ko-KR", { numeric: "auto" });
  if (absSec < 60) return rtf.format(diffSec, "second");
  if (absSec < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (absSec < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
  return rtf.format(Math.round(diffSec / 86400), "day");
}

export function freshnessTone(updatedAt: string | number | Date | null | undefined, nowMs = Date.now()): "fresh" | "stale" | "old" {
  const date = toDate(updatedAt);
  if (!date) return "old";
  const ageSec = Math.max(0, Math.floor((nowMs - date.getTime()) / 1000));
  if (ageSec <= 15) return "fresh";
  if (ageSec <= 60) return "stale";
  return "old";
}

export { KST_TIMEZONE };
