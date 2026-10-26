import { HttpTransport } from "../transports/http";
import { KmaSatProvider } from "../providers/kmaSat";
import { KmaRadarProvider } from "../providers/kmaRadar";
import { KmaChartProvider } from "../providers/kmaChart";

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
    const match = new URL(url).pathname.match(/(?<!\d)(20\d{8}(?:\d{2})?)(?:\d{2})?(?!\d)/);
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

function createPanel(title: string, alt: string, timeZone: "UTC" | "KST") {
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
        aspectRatio = frame.naturalWidth / frame.naturalHeight;
        return () => {
          if (disposed || request !== requestId) return;
          stage.style.aspectRatio = `${frame.naturalWidth} / ${frame.naturalHeight}`;
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
  const detail = document.createElement("div");
  detail.className = "weather-detail";
  detail.append(radar.element, koreaSatellite.element);
  const panels = document.createElement("div");
  panels.className = "weather-panels";
  panels.append(chart.element, detail);
  const workspace = app.closest<HTMLElement>(".app-workspace");
  function alignImageHeights(): void {
    if (!chart.aspectRatio || !koreaSatellite.aspectRatio || !radar.aspectRatio) return;
    const columnRatio = chart.aspectRatio * (1 / koreaSatellite.aspectRatio + 1 / radar.aspectRatio);
    panels.style.setProperty("--weather-grid-columns", `minmax(0, ${columnRatio}fr) minmax(0, 1fr)`);
    workspace?.style.setProperty("--weather-layout-width",
      `calc(var(--weather-detail-width) * ${1 + columnRatio} + 2 * var(--workspace-padding))`);
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
    ]);
    if (disposed) return;
    loadedDay = time.value.slice(0, 10);
    timeline = [...new Set([...chart.times, ...koreaSatellite.times, ...radar.times])]
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

  if (key.value.trim()) void refresh();

  return () => {
    disposed = true;
    workspace?.style.removeProperty("--weather-layout-width");
    toolbar.remove();
    chart.dispose();
    koreaSatellite.dispose();
    radar.dispose();
  };
}

export default {
  title: "Weather",
  icon: "weather",
  category: "Weather",
  mount,
} satisfies View;
