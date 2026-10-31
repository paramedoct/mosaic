import { HttpTransport } from "../transports/http";
import { KmaSatProvider } from "../providers/kmaSat";
import { KmaRadarProvider } from "../providers/kmaRadar";
import { KmaChartProvider } from "../providers/kmaChart";
import { KecoDustProvider } from "../providers/kecoDust";

import { createWeatherLayout } from "./weather/layout";
import { createWeatherSettings } from "./weather/settings";
import { getFramesWithFallback } from "./weather/fallback";

import type { View } from "../types";

function mount(app: HTMLElement, tools: HTMLElement): () => void {
  const settings = createWeatherSettings(() => { void refresh(); });
  const { panels, chart, koreaSatellite, radar, pm10, pm25, allPanels, alignImageHeights } = createWeatherLayout();
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
    const sources = [
      { panel: chart, timeZone: "UTC", getFrames: (time: Date) =>
        new KmaChartProvider(http, serviceKey).getFrames({ code: "12", time }) },
      { panel: koreaSatellite, timeZone: "UTC", getFrames: (time: Date) =>
        new KmaSatProvider(http, serviceKey).getFrames({ time, area: "ko", data: "rgbdn" }) },
      { panel: radar, timeZone: "KST", getFrames: (time: Date) =>
        new KmaRadarProvider(http, serviceKey).getFrames({ time }) },
      { panel: pm10, timeZone: "KST", getFrames: (time: Date) =>
        new KecoDustProvider(http, serviceKey).getFrames({ code: "pm10", time }) },
      { panel: pm25, timeZone: "KST", getFrames: (time: Date) =>
        new KecoDustProvider(http, serviceKey).getFrames({ code: "pm25", time }) },
    ] as const;
    const results = await Promise.all(sources.map(({ panel, timeZone, getFrames }) =>
      panel.refresh(() => getFramesWithFallback(getFrames, timeZone, date.getTime()))
    ));
    if (disposed) return;
    if (results.some(Boolean)) settings.close();
    const commits = await Promise.all(
      allPanels.filter(panel => panel.hasFrames)
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
    allPanels.forEach(panel => panel.dispose());
  };
}

export default {
  title: "Weather",
  icon: "weather",
  category: "Weather",
  mount,
} satisfies View;
