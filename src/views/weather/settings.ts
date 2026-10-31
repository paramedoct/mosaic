import { setAction } from "../../icons";

export function createWeatherSettings(onLoad: () => void) {
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
    onLoad();
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

  return {
    dialog,
    toggle: settingsToggle,
    getKey: () => key.value.trim(),
    setLoading: (loading: boolean) => { load.disabled = loading; },
    open: () => setSettingsOpen(true),
    close: () => setSettingsOpen(false),
  };
}
