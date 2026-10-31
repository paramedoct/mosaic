export interface Frame {
  url: string;
  time: number;
}

export function parseFrames(urls: string[], timeZone: "UTC" | "KST"): Frame[] {
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

