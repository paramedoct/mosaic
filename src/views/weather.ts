import { HttpTransport } from "../transports/http";
import { KmaSatProvider } from "../providers/kmaSat";
import { KmaRadarProvider } from "../providers/kmaRadar";
import { KmaChartProvider } from "../providers/kmaChart";
import { KecoDustProvider } from "../providers/kecoDust";

import { icon, setAction } from "../icons";

import type { View } from "../types";

interface Frame {
  url: string;
  time: number;
}

const KST_OFFSET = 9 * 60 * 60_000;
function parseFrames(urls: string[], timeZone: "UTC" | "KST"): Frame[] {
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

function createPanel(title: string, alt: string, timeZone: "UTC" | "KST", imageKind?: "dust" | "chart") {
  const element = document.createElement("section");
  element.className = "weather-panel";
  element.setAttribute("aria-label", title);
  const image = document.createElement("img");
  image.className = "weather-image";
  image.alt = alt;
  const empty = document.createElement("div");
  empty.className = "weather-empty";
  empty.setAttribute("aria-label", "No imagery loaded");
  empty.append(icon("satellite"));
  const stage = document.createElement("div");
  stage.className = "weather-stage";
  if (imageKind === "dust") stage.classList.add("weather-dust-stage");
  stage.append(empty, image);
  let timestampImage: HTMLImageElement | undefined;
  if (imageKind === "chart") {
    const canvas = document.createElement("div");
    canvas.className = "weather-chart-canvas";
    const timestamp = document.createElement("div");
    timestamp.className = "weather-chart-timestamp";
    timestamp.setAttribute("aria-hidden", "true");
    timestampImage = document.createElement("img");
    timestampImage.alt = "";
    timestamp.append(timestampImage);
    canvas.append(image, timestamp);
    stage.append(canvas);
  }
  const status = document.createElement("span");
  status.setAttribute("role", "status");
  status.className = "weather-panel-status";
  status.textContent = "No imagery loaded";
  element.append(stage, status);
  let frames: Frame[] = [];
  let requestId = 0;
  let disposed = false;
  let aspectRatio: number | undefined;
  let sourceImageWidth: number | undefined;

  return {
    element,
    get aspectRatio(): number | undefined { return aspectRatio; },
    get imageWidth(): number | undefined { return sourceImageWidth; },
    get hasFrames(): boolean { return frames.length > 0; },
    async prepare(): Promise<() => void> {
      const request = ++requestId;
      function commitEmpty(message: string): () => void {
        return () => {
          if (disposed || request !== requestId) return;
          image.removeAttribute("src");
          empty.hidden = false;
          status.textContent = message;
        };
      }
      const candidates = frames.filter(frame => frame.time <= Date.now()).reverse();
      if (candidates.length === 0) {
        return commitEmpty("No imagery available");
      }
      for (const selected of candidates) {
        const frame = new Image();
        frame.src = selected.url;
        try {
          await frame.decode();
        } catch {
          if (disposed || request !== requestId) return () => {};
          continue;
        }
        if (disposed || request !== requestId) return () => {};
        // AirKorea's 820-square canvas includes margins around the 674-by-795 chart.
        const crop = imageKind === "dust" && frame.naturalWidth === 820 && frame.naturalHeight === 820;
        const chartMask = imageKind === "chart" && frame.naturalWidth === 1073 && frame.naturalHeight === 802;
        // Keep a four-pixel side margin and the relocated timestamp; omit the repeated footer.
        const width = crop ? 674 : chartMask ? 1034 : frame.naturalWidth;
        const height = crop ? 795 : chartMask ? 741 : frame.naturalHeight;
        aspectRatio = width / height;
        sourceImageWidth = frame.naturalWidth;
        return () => {
          if (disposed || request !== requestId) return;
          stage.style.aspectRatio = `${width} / ${height}`;
          stage.classList.toggle("weather-dust-cropped", crop);
          stage.classList.toggle("weather-chart-masked", chartMask);
          image.width = frame.naturalWidth;
          image.height = frame.naturalHeight;
          image.src = frame.src;
          if (timestampImage && chartMask) timestampImage.src = frame.src;
          empty.hidden = true;
          status.textContent = "";
        };
      }
      return commitEmpty("Load failed");
    },
    async refresh(getFrames: () => Promise<string[]>): Promise<boolean> {
      ++requestId;
      frames = [];
      status.textContent = "";
      try {
        const urls = await getFrames();
        if (disposed) return false;
        frames = parseFrames(urls, timeZone);
        if (frames.length === 0) {
          image.removeAttribute("src");
          empty.hidden = false;
        }
        status.textContent = frames.length ? "" : "No dated imagery available";
        return frames.length > 0;
      } catch {
        if (!disposed) {
          image.removeAttribute("src");
          empty.hidden = false;
          status.textContent = "Load failed";
        }
        return false;
      }
    },
    dispose(): void { disposed = true; ++requestId; },
  };
}

function mount(app: HTMLElement, tools: HTMLElement): () => void {
  const key = document.createElement("input");
  key.type = "password";
  key.placeholder = "API Key";
  key.setAttribute("aria-label", "API Key");
  key.autocomplete = "off";
  key.spellcheck = false;

  const storageKey = "mosaic.weather.serviceKey";
  const remember = document.createElement("input");
  remember.type = "checkbox";
  const rememberLabel = document.createElement("label");
  remember.setAttribute("aria-label", "Remember key");
  rememberLabel.title = "Remember key";
  rememberLabel.append(remember, "Remember");

  const forget = document.createElement("button");
  setAction(forget, "trash", "Forget key");

  const status = document.createElement("span");
  status.setAttribute("role", "status");

  try {
    const savedKey = localStorage.getItem(storageKey);
    key.value = savedKey ?? "";
    remember.checked = savedKey !== null;
  } catch {
    status.textContent = "Storage unavailable";
  }

  function saveKey(): void {
    try {
      if (remember.checked) {
        localStorage.setItem(storageKey, key.value.trim());
      } else {
        localStorage.removeItem(storageKey);
      }
    } catch {
      status.textContent = "Save failed";
    }
  }

  remember.onchange = saveKey;
  key.onchange = () => {
    if (remember.checked) saveKey();
  };
  forget.onclick = () => {
    key.value = "";
    remember.checked = false;
    saveKey();
    setSettingsOpen(true);
    key.focus();
  };

  const dialog = document.createElement("dialog");
  dialog.className = "weather-settings-dialog";
  dialog.id = "weather-key-settings";
  dialog.setAttribute("aria-labelledby", "weather-key-settings-title");
  const heading = document.createElement("h2");
  heading.id = "weather-key-settings-title";
  heading.textContent = "API key settings";
  const close = document.createElement("button");
  close.type = "button";
  setAction(close, "close", "Close settings");
  close.onclick = () => setSettingsOpen(false);
  const dialogHeader = document.createElement("div");
  dialogHeader.className = "weather-settings-header";
  dialogHeader.append(heading, close);
  const controls = document.createElement("form");
  controls.className = "weather-controls";
  forget.type = "button";
  const load = document.createElement("button");
  load.type = "submit";
  load.className = "primary-button";
  load.textContent = "Load imagery";
  controls.onsubmit = event => {
    event.preventDefault();
    if (remember.checked) saveKey();
    void refresh();
  };
  const keyActions = document.createElement("div");
  keyActions.className = "weather-key-actions";
  keyActions.append(rememberLabel, forget);
  controls.append(key, keyActions, status, load);
  dialog.append(dialogHeader, controls);
  const settingsToggle = document.createElement("button");
  settingsToggle.className = "weather-settings-toggle";
  setAction(settingsToggle, "lock", "API key settings");
  settingsToggle.setAttribute("aria-controls", dialog.id);
  settingsToggle.setAttribute("aria-haspopup", "dialog");
  settingsToggle.setAttribute("aria-expanded", "false");
  function setSettingsOpen(open: boolean): void {
    if (open && !dialog.open) {
      dialog.showModal();
      key.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
    settingsToggle.setAttribute("aria-expanded", String(open));
  }
  dialog.onclose = () => settingsToggle.setAttribute("aria-expanded", "false");
  dialog.onclick = event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom) {
      setSettingsOpen(false);
    }
  };
  settingsToggle.onclick = () => setSettingsOpen(!dialog.open);

  const chart = createPanel("Surface chart", "KMA surface weather chart (UTC, every 3 hours)", "UTC", "chart");
  const koreaSatellite = createPanel("Korea satellite", "KMA Korea satellite imagery", "UTC");
  koreaSatellite.element.classList.add("weather-satellite-panel");
  const radar = createPanel("Korea radar", "KMA radar imagery", "KST");
  radar.element.classList.add("weather-radar-panel");
  const pm10 = createPanel("PM10", "AirKorea PM10 forecast animation", "KST", "dust");
  const pm25 = createPanel("PM2.5", "AirKorea PM2.5 forecast animation", "KST", "dust");
  const dustRow = document.createElement("div");
  dustRow.className = "weather-dust-row";
  dustRow.append(pm10.element, pm25.element);
  const weatherColumn = document.createElement("div");
  weatherColumn.className = "weather-column";
  weatherColumn.append(chart.element, dustRow);
  const observationColumn = document.createElement("div");
  observationColumn.className = "weather-column weather-observation-column";
  observationColumn.append(koreaSatellite.element, radar.element);
  const panels = document.createElement("div");
  panels.className = "weather-panels";
  panels.append(weatherColumn, observationColumn);
  function alignImageHeights(): void {
    const radarRatio = radar.aspectRatio ?? 1;
    const satelliteRatio = koreaSatellite.aspectRatio ?? 1;
    const pm10Ratio = pm10.aspectRatio ?? 674 / 795;
    const pm25Ratio = pm25.aspectRatio ?? 674 / 795;
    dustRow.style.setProperty("--weather-dust-columns",
      `minmax(0, ${pm10Ratio}fr) minmax(0, ${pm25Ratio}fr)`);
    const chartRatio = chart.aspectRatio ?? 1034 / 741;
    const weatherRatio = 1 / (1 / chartRatio + 1 / (pm10Ratio + pm25Ratio));
    // Express margins in source-image pixels so they scale with the radar image.
    const sourceWidth = radar.imageWidth ?? 900;
    const sideRatio = 4 / sourceWidth;
    const bottomRatio = 6 / sourceWidth;
    const observationRatio = 1 / ((1 + sideRatio) / satelliteRatio + 1 / radarRatio + bottomRatio);
    const totalRatio = weatherRatio + observationRatio * (1 + 2 * sideRatio);
    const availableHeight = Math.max(0, window.innerHeight - panels.getBoundingClientRect().top - 8);
    const maxWidth = availableHeight * totalRatio;
    const availableWidth = panels.parentElement?.clientWidth ?? panels.clientWidth;
    const radarWidth = Math.min(availableWidth, maxWidth) * observationRatio / totalRatio;
    panels.style.setProperty("--weather-side-margin", `${radarWidth * sideRatio}px`);
    panels.style.setProperty("--weather-bottom-margin", `${radarWidth * bottomRatio}px`);
    panels.style.setProperty("--weather-grid-columns",
      `minmax(0, ${weatherRatio}fr) minmax(0, ${observationRatio}fr)`);
    panels.style.maxWidth = `${maxWidth}px`;
  }
  const toolbar = document.createElement("div");
  toolbar.className = "weather-toolbar";
  toolbar.append(settingsToggle);
  const view = document.createElement("section");
  view.className = "weather-view";
  tools.append(toolbar);
  view.append(dialog, panels);
  app.replaceChildren(view);
  setSettingsOpen(!key.value.trim());
  let disposed = false;
  let loading = false;
  async function refresh(): Promise<void> {
    if (loading) return;
    loading = true;
    load.disabled = true;
    const http = new HttpTransport();
    const serviceKey = key.value.trim();
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
    if (results.some(Boolean)) setSettingsOpen(false);
    const commits = await Promise.all(
      [chart, koreaSatellite, radar, pm10, pm25]
        .filter(panel => panel.hasFrames)
        .map(panel => panel.prepare())
    );
    if (disposed) return;
    alignImageHeights();
    commits.forEach(commit => commit());
    loading = false;
    load.disabled = false;
  }

  const layoutObserver = new ResizeObserver(alignImageHeights);
  layoutObserver.observe(tools);
  window.addEventListener("resize", alignImageHeights);
  alignImageHeights();

  if (key.value.trim()) void refresh();

  return () => {
    disposed = true;
    dialog.close();
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
