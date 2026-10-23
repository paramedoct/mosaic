import { HttpTransport } from "../transports/http";
import { Gk2aProvider } from "../providers/gk2a";

import { icon, setAction } from "../icons";

import type { View } from "../types";

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

  const load = document.createElement("button");
  setAction(load, "refresh", "Load imagery");
  load.className = "primary-button";

  const image = document.createElement("img");
  image.className = "weather-image";
  image.alt = "GK2A satellite imagery";

  const previous = document.createElement("button");
  setAction(previous, "previous", "Previous image");
  previous.disabled = true;
  const next = document.createElement("button");
  setAction(next, "next", "Next image");
  next.disabled = true;

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
    if (event.key === "Enter") load.click();
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
  settings.append(settingsToggle, controls);

  const empty = document.createElement("div");
  empty.className = "weather-empty";
  empty.setAttribute("aria-label", "No imagery loaded");
  empty.append(icon("satellite"));
  const stage = document.createElement("div");
  stage.className = "weather-stage";
  stage.append(empty, image);
  const playback = document.createElement("div");
  playback.className = "weather-playback";
  playback.append(previous, next, status);
  const view = document.createElement("section");
  view.className = "weather-view";
  playback.prepend(load, settings);
  view.append(stage, playback);
  app.replaceChildren(view);

  let urls: string[] = [];
  let index = 0;
  let frameRequest = 0;

  function updateNavigation(): void {
    previous.disabled = load.disabled || index <= 0 || urls.length === 0;
    next.disabled = load.disabled || index >= urls.length - 1;
  }

  async function show(): Promise<void> {
    if (urls.length === 0) return;

    const request = ++frameRequest;
    const frameIndex = index;
    const frame = new Image();
    frame.src = urls[frameIndex];

    try {
      await frame.decode();
    } catch {
      if (request === frameRequest) status.textContent = "Load failed";
      return;
    }
    if (request !== frameRequest) return;

    image.src = frame.src;
    empty.hidden = true;
    status.textContent = ` ${frameIndex + 1} / ${urls.length}`;
  }

  load.onclick = async () => {
    ++frameRequest;
    load.disabled = true;
    updateNavigation();
    status.textContent = "…";

    try {
      const provider = new Gk2aProvider(
        new HttpTransport(),
        key.value.trim()
      );

      urls = (await provider.getFrames({
        time: new Date(),
        area: "ea",
        data: "rgbdn",
      })).filter(url => url.toLowerCase().includes("thn")).sort();

      index = Math.max(0, urls.length - 1);
      if (urls.length === 0) {
        image.removeAttribute("src");
        empty.hidden = false;
        status.textContent = "No imagery available";
      } else {
        await show();
      }
      if (urls.length > 0) setSettingsOpen(false);
    } catch {
      status.textContent = "Load failed";
    } finally {
      load.disabled = false;
      updateNavigation();
    }
  };

  previous.onclick = () => {
    if (index <= 0) return;
    --index;
    updateNavigation();
    void show();
  };
  next.onclick = () => {
    if (index >= urls.length - 1) return;
    ++index;
    updateNavigation();
    void show();
  };

  if (key.value.trim()) load.click();

  return () => {
    ++frameRequest;
  };
}

export default {
  title: "East Asia satellite",
  category: "Weather",
  mount,
} satisfies View;
