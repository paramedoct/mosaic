import { HttpTransport } from "../transports/http";
import { KmaSatProvider } from "../providers/kmaSat";
import { KmaRadarProvider } from "../providers/kmaRadar";
import { KmaChartProvider } from "../providers/kmaChart";
import { KecoDustProvider } from "../providers/kecoDust";

import { createWeatherLayout } from "./weather/layout";
import { createWeatherSettings } from "./weather/settings";

import type { View } from "../types";

const KST_OFFSET = 9 * 60 * 60_000;

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
    async function getUtcFrames(getFrames: (time: Date) => Promise<string[]>): Promise<string[]> {
      const days = [dayStart, dayStart + 24 * 60 * 60_000 - 1];
      const results = await Promise.allSettled(days.map(value => getFrames(new Date(value))));
      const frames = results.flatMap(result => result.status === "fulfilled" ? result.value : []);
      if (results.every(result => result.status === "rejected")) {
        throw new Error("Weather imagery unavailable");
      }
      return [...new Set(frames)];
    }
    const results = await Promise.all([
      chart.refresh(() => getUtcFrames(time =>
        new KmaChartProvider(http, serviceKey).getFrames({ code: "12", time }))),
      koreaSatellite.refresh(() => getUtcFrames(time =>
        new KmaSatProvider(http, serviceKey).getFrames({ time, area: "ko", data: "rgbdn" }))),
      radar.refresh(() => new KmaRadarProvider(http, serviceKey).getFrames({
        time: new Date(date.getTime() + KST_OFFSET),
      })),
      pm10.refresh(() => new KecoDustProvider(http, serviceKey).getFrames({
        code: "pm10", time: new Date(dayStart + KST_OFFSET),
      })),
      pm25.refresh(() => new KecoDustProvider(http, serviceKey).getFrames({
        code: "pm25", time: new Date(dayStart + KST_OFFSET),
      })),
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
