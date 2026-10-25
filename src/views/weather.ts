import { HttpTransport } from "../transports/http";
import { KmaSatProvider } from "../providers/kmaSat";
import { KmaRadarProvider } from "../providers/kmaRadar";

import { icon, setAction } from "../icons";

import type { View } from "../types";

interface Frame {
  url: string;
  time: number;
}

const KST_OFFSET = 9 * 60 * 60_000;

function formatKst(time: number): string {
  return new Date(time + KST_OFFSET).toISOString().slice(0, 16);
}

function parseFrames(urls: string[], timeZone: "UTC" | "KST"): Frame[] {
  return urls.flatMap(url => {
    const match = new URL(url).pathname.match(/(?<!\d)(20\d{10})(?:\d{2})?(?!\d)/);
    if (!match) return [];
    const value = match[1];
    const zone = timeZone === "KST" ? "+09:00" : "Z";
    const time = Date.parse(
      `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` +
      `T${value.slice(8, 10)}:${value.slice(10, 12)}:00${zone}`
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

  return {
    element,
    get times(): number[] { return frames.map(frame => frame.time); },
    async show(time: number): Promise<void> {
      const request = ++requestId;
      const candidates = frames.filter(frame => frame.time <= time).reverse();
      if (candidates.length === 0) {
        image.removeAttribute("src");
        empty.hidden = false;
        status.textContent = "No imagery at this time";
        return;
      }
      for (const selected of candidates) {
        const frame = new Image();
        frame.src = selected.url;
        try {
          await frame.decode();
        } catch {
          if (disposed || request !== requestId) return;
          continue;
        }
        if (disposed || request !== requestId) return;
        element.style.flexGrow = String(frame.naturalWidth / frame.naturalHeight);
        image.src = frame.src;
        empty.hidden = true;
        status.textContent = "";
        return;
      }
      image.removeAttribute("src");
      empty.hidden = false;
      status.textContent = "Load failed";
    },
    async refresh(getFrames: () => Promise<string[]>): Promise<boolean> {
      ++requestId;
      frames = [];
      image.removeAttribute("src");
      empty.hidden = false;
      status.textContent = "Loading…";
      try {
        const urls = await getFrames();
        if (disposed) return false;
        frames = parseFrames(urls, timeZone);
        status.textContent = frames.length ? "" : "No dated imagery available";
        return frames.length > 0;
      } catch {
        if (!disposed) status.textContent = "Load failed";
        return false;
      }
    },
    dispose(): void { disposed = true; ++requestId; },
  };
}

function mount(app: HTMLElement): () => void {
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

  const satellite = createPanel("East Asia satellite", "KMA satellite imagery", "UTC");
  const radar = createPanel("Korea radar", "KMA radar imagery", "KST");
  const panels = document.createElement("div");
  panels.className = "weather-panels";
  panels.append(satellite.element, radar.element);
  const toolbar = document.createElement("div");
  toolbar.className = "weather-toolbar";
  const title = document.createElement("h1");
  title.textContent = "Weather imagery";
  const actions = document.createElement("div");
  actions.className = "weather-actions";
  const time = document.createElement("input");
  time.type = "datetime-local";
  time.setAttribute("aria-label", "Imagery date and time (KST)");
  const timeLabel = document.createElement("label");
  timeLabel.className = "weather-time";
  timeLabel.append(time, "KST");
  time.value = formatKst(Date.now());
  const previous = document.createElement("button");
  setAction(previous, "previous", "Previous observation time");
  const next = document.createElement("button");
  setAction(next, "next", "Next observation time");
  const now = document.createElement("button");
  setAction(now, "now", "Go to current time");
  actions.append(previous, timeLabel, next, now, settings);
  toolbar.append(title, status, actions);
  const view = document.createElement("section");
  view.className = "weather-view";
  view.append(toolbar, controls, panels);
  app.replaceChildren(view);
  let disposed = false;
  let loading = false;
  let timeline: number[] = [];
  let loadedDay = "";
  let selectedTime = new Date(time.value + "+09:00").getTime();
  function updateNavigation(): void {
    previous.disabled = loading || !timeline.some(value => value < selectedTime);
    next.disabled = loading || !timeline.some(value => value > selectedTime);
  }
  async function show(): Promise<void> {
    updateNavigation();
    await Promise.all([
      ...(satellite.times.length ? [satellite.show(selectedTime)] : []),
      ...(radar.times.length ? [radar.show(selectedTime)] : []),
    ]);
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
    if (!time.value || !time.validity.valid) return;
    selectedTime = new Date(time.value + "+09:00").getTime();
    if (time.value.slice(0, 10) !== loadedDay) void refresh();
    else void show();
  };
  now.onclick = () => {
    time.value = formatKst(Date.now());
    void refresh();
  };
  async function refresh(): Promise<void> {
    if (loading || !time.value || !time.validity.valid) return;
    loading = true;
    time.disabled = true;
    now.disabled = true;
    updateNavigation();
    const http = new HttpTransport();
    const serviceKey = key.value.trim();
    const date = new Date(time.value + "+09:00");
    const dayStart = new Date(time.value.slice(0, 10) + "T00:00:00+09:00").getTime();
    selectedTime = date.getTime();
    const results = await Promise.all([
      satellite.refresh(async () => {
        const provider = new KmaSatProvider(http, serviceKey);
        const days = [dayStart, dayStart + 24 * 60 * 60_000 - 1];
        const results = await Promise.allSettled(days.map(value => provider.getFrames({
          time: new Date(value), area: "ea", data: "rgbdn",
        })));
        const frames = results.flatMap(result => result.status === "fulfilled" ? result.value : []);
        if (results.every(result => result.status === "rejected")) {
          throw new Error("Satellite imagery unavailable");
        }
        return [...new Set(frames)].filter(url => url.toLowerCase().includes("thn"));
      }),
      radar.refresh(() => new KmaRadarProvider(http, serviceKey).getFrames({
        time: new Date(date.getTime() + KST_OFFSET),
      })),
    ]);
    if (disposed) return;
    loadedDay = time.value.slice(0, 10);
    timeline = [...new Set([...satellite.times, ...radar.times])]
      .filter(value => formatKst(value).slice(0, 10) === loadedDay)
      .sort((a, b) => a - b);
    if (results.some(Boolean)) setSettingsOpen(false);
    loading = false;
    time.disabled = false;
    now.disabled = false;
    await show();
  }
  updateNavigation();

  if (key.value.trim()) void refresh();

  return () => {
    disposed = true;
    satellite.dispose();
    radar.dispose();
  };
}

export default {
  title: "Satellite & radar",
  category: "Weather",
  mount,
} satisfies View;
