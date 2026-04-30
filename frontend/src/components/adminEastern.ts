const NY = "America/New_York";

const weekdayLongToMon0: Record<string, number> = {
  Monday: 0,
  Tuesday: 1,
  Wednesday: 2,
  Thursday: 3,
  Friday: 4,
  Saturday: 5,
  Sunday: 6,
};

export function getEasternYMD(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: NY,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const mo = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${mo}-${day}`;
}

function getEasternWeekdayMon0(d: Date): number {
  const w = new Intl.DateTimeFormat("en-US", {
    timeZone: NY,
    weekday: "long",
  }).format(d);
  return weekdayLongToMon0[w] ?? 0;
}

function ymdToNoonUtc(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 15, 0, 0));
}

export function findMondayYmdOfWeekContaining(ymd: string): string {
  let cur = ymdToNoonUtc(ymd);
  for (let i = 0; i < 7; i++) {
    if (getEasternWeekdayMon0(cur) === 0) return getEasternYMD(cur);
    cur = new Date(cur.getTime() - 86400000);
  }
  return ymd;
}

export function addDaysToYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d + delta, 12, 0, 0);
  return getEasternYMD(new Date(t));
}

export function getThisWeekRangeEasternYmd(now = new Date()): {
  mon: string;
  sun: string;
} {
  const todayYmd = getEasternYMD(now);
  const mon = findMondayYmdOfWeekContaining(todayYmd);
  const sun = addDaysToYmd(mon, 6);
  return { mon, sun };
}

export function isYmdInInclusiveRange(
  ymd: string,
  start: string,
  end: string,
): boolean {
  return ymd >= start && ymd <= end;
}

export function formatTimeEastern(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: NY,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}
