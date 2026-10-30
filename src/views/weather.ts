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
const TIME_STEP = 10 * 60_000;

function floorTime(time: number): number {
  return Math.floor(time / TIME_STEP) * TIME_STEP;
}

function formatKst(time: number): string {
  return new Date(time + KST_OFFSET).toISOString().slice(0, 16);
}

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

function createPanel(title: string, alt: string, timeZone: "UTC" | "KST", dust = false) {
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
  if (dust) stage.classList.add("weather-dust-stage");
  stage.append(empty, image);
  const status = document.createElement("span");
  status.setAttribute("role", "status");
  status.className = "weather-panel-status";
  status.textContent = "No imagery loaded";
  element.append(stage, status);
  let frames: Frame[] = [];
  let requestId = 0;
  let disposed = false;
  let aspectRatio: number | undefined;

  return {
    element,
    get aspectRatio(): number | undefined { return aspectRatio; },
    get times(): number[] { return frames.map(frame => frame.time); },
    async prepare(time: number): Promise<() => void> {
      const request = ++requestId;
      function commitEmpty(message: string): () => void {
        return () => {
          if (disposed || request !== requestId) return;
          image.removeAttribute("src");
          empty.hidden = false;
          status.textContent = message;
        };
      }
      const candidates = frames.filter(frame => frame.time <= time).reverse();
      if (candidates.length === 0) {
        return commitEmpty("No imagery at this time");
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
        const crop = dust && frame.naturalWidth === 820 && frame.naturalHeight === 820;
        const width = crop ? 674 : frame.naturalWidth;
        const height = crop ? 795 : frame.naturalHeight;
        aspectRatio = width / height;
        return () => {
          if (disposed || request !== requestId) return;
          stage.style.aspectRatio = `${width} / ${height}`;
          stage.classList.toggle("weather-dust-cropped", crop);
          image.width = frame.naturalWidth;
          image.height = frame.naturalHeight;
          image.src = frame.src;
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

  key.onkeydown = (event) => {
    if (event.key === "Enter") void refresh();
  };

  const controls = document.createElement("div");
  controls.className = "weather-controls";
  controls.append(key, rememberLabel, forget);
  const settings = document.createElement("div");
  settings.className = "weather-settings";
  const settingsToggle = document.createElement("button");
  setAction(settingsToggle, "key", "API key");
  controls.id = "weather-key-settings";
  settingsToggle.setAttribute("aria-controls", controls.id);
  function setSettingsOpen(open: boolean): void {
    controls.hidden = !open;
    settingsToggle.setAttribute("aria-expanded", String(open));
  }
  settingsToggle.onclick = () => {
    setSettingsOpen(controls.hidden === true);
    if (!controls.hidden) key.focus();
  };
  setSettingsOpen(!key.value.trim());
  settings.append(settingsToggle);

  const chart = createPanel("Surface chart", "KMA surface weather chart (UTC, every 3 hours)", "UTC");
  const koreaSatellite = createPanel("Korea satellite", "KMA Korea satellite imagery", "UTC");
  const radar = createPanel("Korea radar", "KMA radar imagery", "KST");
  const pm10 = createPanel("PM10", "AirKorea PM10 forecast animation", "KST", true);
  const pm25 = createPanel("PM2.5", "AirKorea PM2.5 forecast animation", "KST", true);
  const dustRow = document.createElement("div");
  dustRow.className = "weather-dust-row";
  dustRow.append(pm10.element, pm25.element);
  const weatherColumn = document.createElement("div");
  weatherColumn.className = "weather-column";
  weatherColumn.append(chart.element, dustRow);
  const observationColumn = document.createElement("div");
  observationColumn.className = "weather-column";
  observationColumn.append(radar.element, koreaSatellite.element);
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
    // The 901-by-757 surface chart repeats its timestamp in the bottom 18 pixels.
    const chartOverlap = chart.aspectRatio === 901 / 757 ? 18 / 901 : 0;
    dustRow.style.marginTop = `${-100 * chartOverlap}%`;
    const weatherRatio = 1 / (1 / (chart.aspectRatio ?? 1) - chartOverlap + 1 / (pm10Ratio + pm25Ratio));
    const observationRatio = 1 / (1 / radarRatio + 1 / satelliteRatio);
    panels.style.setProperty("--weather-grid-columns",
      `minmax(0, ${weatherRatio}fr) minmax(0, ${observationRatio}fr)`);
    const availableHeight = Math.max(0, window.innerHeight - panels.getBoundingClientRect().top - 8);
    panels.style.maxWidth = `${availableHeight * (weatherRatio + observationRatio)}px`;
  }
  const toolbar = document.createElement("div");
  toolbar.className = "weather-toolbar";
  const actions = document.createElement("div");
  actions.className = "weather-actions";
  const time = document.createElement("input");
  time.type = "datetime-local";
  time.step = "600";
  time.setAttribute("aria-label", "Imagery date and time (KST)");
  const timeLabel = document.createElement("label");
  timeLabel.className = "weather-time";
  timeLabel.append(time, "KST");
  time.value = formatKst(floorTime(Date.now()));
  const previous = document.createElement("button");
  setAction(previous, "previous", "Previous observation time");
  const next = document.createElement("button");
  setAction(next, "next", "Next observation time");
  const now = document.createElement("button");
  setAction(now, "now", "Go to current time");
  actions.append(previous, timeLabel, next, now, settings);
  toolbar.append(status, actions);
  const view = document.createElement("section");
  view.className = "weather-view";
  tools.append(toolbar);
  view.append(controls, panels);
  app.replaceChildren(view);
  let disposed = false;
  let showRequest = 0;
  let loading = false;
  let timeline: number[] = [];
  let loadedDay = "";
  let selectedTime = new Date(time.value + "+09:00").getTime();
  function updateNavigation(): void {
    previous.disabled = loading || !timeline.some(value => value < selectedTime);
    next.disabled = loading || !timeline.some(value => value > selectedTime);
  }
  async function show(): Promise<void> {
    const request = ++showRequest;
    updateNavigation();
    const commits = await Promise.all([
      ...(chart.times.length ? [chart.prepare(selectedTime)] : []),
      ...(koreaSatellite.times.length ? [koreaSatellite.prepare(selectedTime)] : []),
      ...(radar.times.length ? [radar.prepare(selectedTime)] : []),
      ...(pm10.times.length ? [pm10.prepare(selectedTime)] : []),
      ...(pm25.times.length ? [pm25.prepare(selectedTime)] : []),
    ]);
    if (disposed || request !== showRequest) return;
    alignImageHeights();
    commits.forEach(commit => commit());
  }
  function select(value: number): void {
    selectedTime = value;
    time.value = formatKst(value);
    void show();
  }
  previous.onclick = () => {
    const value = timeline.filter(value => value < selectedTime).at(-1);
    if (value !== undefined) select(value);
  };
  next.onclick = () => {
    const value = timeline.find(value => value > selectedTime);
    if (value !== undefined) select(value);
  };
  time.onchange = () => {
    if (!time.value) return;
    selectedTime = floorTime(new Date(time.value + "+09:00").getTime());
    if (!Number.isFinite(selectedTime)) return;
    time.value = formatKst(selectedTime);
    if (time.value.slice(0, 10) !== loadedDay) void refresh();
    else void show();
  };
  now.onclick = () => {
    time.value = formatKst(floorTime(Date.now()));
    void refresh();
  };
  async function refresh(): Promise<void> {
    if (loading || !time.value || !time.validity.valid) return;
    loading = true;
    if (!chart.aspectRatio || !koreaSatellite.aspectRatio || !radar.aspectRatio) {
      toolbar.style.visibility = "hidden";
    }
    ++showRequest;
    time.disabled = true;
    now.disabled = true;
    updateNavigation();
    const http = new HttpTransport();
    const serviceKey = key.value.trim();
    const date = new Date(time.value + "+09:00");
    const dayStart = new Date(time.value.slice(0, 10) + "T00:00:00+09:00").getTime();
    selectedTime = date.getTime();
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
        new KmaChartProvider(http, serviceKey).getFrames({ time }))),
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
    loadedDay = time.value.slice(0, 10);
    timeline = [...new Set([...chart.times, ...koreaSatellite.times, ...radar.times, ...pm10.times, ...pm25.times])]
      .filter(value => value % TIME_STEP === 0)
      .filter(value => formatKst(value).slice(0, 10) === loadedDay)
      .sort((a, b) => a - b);
    if (results.some(Boolean)) setSettingsOpen(false);
    await show();
    if (disposed) return;
    loading = false;
    time.disabled = false;
    now.disabled = false;
    toolbar.style.removeProperty("visibility");
    updateNavigation();
  }
  updateNavigation();

  const layoutObserver = new ResizeObserver(alignImageHeights);
  layoutObserver.observe(tools);
  layoutObserver.observe(controls);
  window.addEventListener("resize", alignImageHeights);
  alignImageHeights();

  if (key.value.trim()) void refresh();

  return () => {
    disposed = true;
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
