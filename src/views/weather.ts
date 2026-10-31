import { HttpTransport } from "../transports/http";
import { KmaSatProvider } from "../providers/kmaSat";
import { KmaRadarProvider } from "../providers/kmaRadar";
import { KmaChartProvider } from "../providers/kmaChart";
import { KecoDustProvider } from "../providers/kecoDust";

import { createWeatherLayout } from "./weather/layout";
import { createWeatherSettings } from "./weather/settings";
import { getFramesWithFallback } from "./weather/fallback";

import type { View } from "../types";

const KST_OFFSET = 9 * 60 * 60_000;
const DAY = 24 * 60 * 60_000;

function mount(app: HTMLElement, tools: HTMLElement): () => void {
  const settings = createWeatherSettings(() => { void refresh(); });
  const { panels, chart, koreaSatellite, radar, pm10, pm25, alignImageHeights } = createWeatherLayout();
  const toolbar = document.createElement("div");
  toolbar.className = "weather-toolbar";
  toolbar.append(settings.toggle);
  const view = document.createElement("section");
  view.className = "weather-view";
  tools.append(toolbar);
  view.append(settings.dialog, panels);
  app.replaceChildren(view);
  if (!settings.getKey()) settings.open();
  let disposed = false;
  let loading = false;
  async function refresh(): Promise<void> {
    if (loading) return;
    loading = true;
    settings.setLoading(true);
    const http = new HttpTransport();
    const serviceKey = settings.getKey();
    const date = new Date();
    const kstDate = new Date(date.getTime() + KST_OFFSET).toISOString().slice(0, 10);
    const dayStart = new Date(kstDate + "T00:00:00+09:00").getTime();
    const utcDates = [new Date(dayStart), new Date(dayStart + DAY - 1)];
    const previousUtcDate = new Date(dayStart - DAY);
    const kstDateForQuery = new Date(dayStart + KST_OFFSET);
    const previousKstDate = new Date(dayStart - DAY + KST_OFFSET);
    const results = await Promise.all([
      chart.refresh(() => getFramesWithFallback(time =>
        new KmaChartProvider(http, serviceKey).getFrames({ code: "12", time }),
        utcDates, previousUtcDate, "UTC", date.getTime())),
      koreaSatellite.refresh(() => getFramesWithFallback(time =>
        new KmaSatProvider(http, serviceKey).getFrames({ time, area: "ko", data: "rgbdn" }),
        utcDates, previousUtcDate, "UTC", date.getTime())),
      radar.refresh(() => getFramesWithFallback(time =>
        new KmaRadarProvider(http, serviceKey).getFrames({ time }),
        [kstDateForQuery], previousKstDate, "KST", date.getTime())),
      pm10.refresh(() => getFramesWithFallback(time =>
        new KecoDustProvider(http, serviceKey).getFrames({ code: "pm10", time }),
        [kstDateForQuery], previousKstDate, "KST", date.getTime())),
      pm25.refresh(() => getFramesWithFallback(time =>
        new KecoDustProvider(http, serviceKey).getFrames({ code: "pm25", time }),
        [kstDateForQuery], previousKstDate, "KST", date.getTime())),
    ]);
    if (disposed) return;
    if (results.some(Boolean)) settings.close();
    const commits = await Promise.all(
      [chart, koreaSatellite, radar, pm10, pm25]
        .filter(panel => panel.hasFrames)
        .map(panel => panel.prepare())
    );
    if (disposed) return;
    alignImageHeights();
    commits.forEach(commit => commit());
    loading = false;
    settings.setLoading(false);
  }

  const layoutObserver = new ResizeObserver(alignImageHeights);
  layoutObserver.observe(tools);
  window.addEventListener("resize", alignImageHeights);
  alignImageHeights();

  if (settings.getKey()) void refresh();

  return () => {
    disposed = true;
    settings.close();
    layoutObserver.disconnect();
    window.removeEventListener("resize", alignImageHeights);
    toolbar.remove();
    chart.dispose();
    koreaSatellite.dispose();
    radar.dispose();
    pm10.dispose();
    pm25.dispose();
  };
}

export default {
  title: "Weather",
  icon: "weather",
  category: "Weather",
  mount,
} satisfies View;
