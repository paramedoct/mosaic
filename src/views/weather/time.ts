export type TimeZone = "UTC" | "KST";

const KST_OFFSET = 9 * 60 * 60_000;
const DAY = 24 * 60 * 60_000;

export function getQueryDates(now: Date, timeZone: TimeZone): { currentDates: Date[]; previousDate: Date } {
  const kstDate = new Date(now.getTime() + KST_OFFSET).toISOString().slice(0, 10);
  const dayStart = Date.parse(`${kstDate}T00:00:00+09:00`);
  const currentDates = timeZone === "UTC"
    ? [new Date(dayStart), new Date(dayStart + DAY - 1)]
    : [new Date(dayStart + KST_OFFSET)];
  return {
    currentDates,
    previousDate: new Date(dayStart - DAY + (timeZone === "KST" ? KST_OFFSET : 0)),
  };
}

export interface Frame {
  url: string;
  time: number;
}

export function parseFrames(urls: string[], timeZone: TimeZone): Frame[] {
  return urls.flatMap(url => {
    const pathname = new URL(url).pathname;
    const forecast = pathname.match(/^\/dustImage\/(\d{4})\/(\d{2})\/(\d{2})\/(\d{2})\//);
    if (forecast) {
      const [, year, month, day, hour] = forecast;
      const time = Date.parse(`${year}-${month}-${day}T${hour}:00:00+09:00`);
      return Number.isFinite(time) ? [{ url, time }] : [];
    }
    const match = pathname.match(/(?<!\d)(20\d{8}(?:\d{2})?)(?:\d{2})?(?!\d)/);
    if (!match) return [];
    const value = match[1];
    const zone = timeZone === "KST" ? "+09:00" : "Z";
    const time = Date.parse(
      `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` +
      `T${value.slice(8, 10)}:${value.slice(10, 12) || "00"}:00${zone}`
    );
    if (!Number.isFinite(time)) return [];
    return [{ url, time }];
  }).sort((a, b) => a.time - b.time);
}

