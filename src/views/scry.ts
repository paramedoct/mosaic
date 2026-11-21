import type { View } from "../types";
import { icon, setAction } from "../icons";
import { ScryProvider, loadSqlite, type ImageGroup, type ImageSummary } from "../providers/scry";
import { FileTransport, type FileRoot } from "../transports/file";
import { downloadImages, downloadUrls } from "./scry/downloads";
import { chooseDirectory, droppedDirectory, hasReadAccess, requestReadAccess, savedFolder, waitFor } from "./scry/folders";
import { imageSearchChoices, parseImageSearch } from "./scry/search";
import { button, downloadHtml, element, errorMessage, input } from "./scry/ui";
import "./scry/style.css";

const files = new FileTransport();
type FileConnection = { name: string; root: FileRoot };

function bytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function suggestedInput(
  field: HTMLInputElement, choices: (value: string) => readonly { label: string; value: string }[], edited?: () => void,
  selected?: (value: string) => void,
) {
  const wrapper = element("div", "scry-suggested-input");
  const suggestions = element("div", "scry-suggestions");
  suggestions.setAttribute("role", "group");
  suggestions.setAttribute("aria-label", `${field.placeholder} suggestions`);
  wrapper.append(field, suggestions);
  function render(): void {
    suggestions.replaceChildren(...choices(field.value).map(({ label, value }) => button(label, () => {
      field.value = value;
      field.focus();
      if (label.endsWith(":") && edited && value.endsWith(":")) render();
      else suggestions.replaceChildren();
      edited?.();
      selected?.(value);
    })));
  }
  field.onclick = render;
  field.oninput = () => {
    render();
    edited?.();
  };
  wrapper.addEventListener("focusout", event => {
    if (!wrapper.contains(event.relatedTarget as Node | null)) suggestions.replaceChildren();
  });
  wrapper.onkeydown = event => {
    if (event.key === "Escape" && suggestions.childElementCount) {
      event.preventDefault();
      field.focus();
      suggestions.replaceChildren();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    if (!suggestions.childElementCount && event.target === field && event.key === "ArrowDown") render();
    const choices = [...suggestions.querySelectorAll("button")];
    const index = choices.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? choices[index + 1] : choices[index - 1] ?? field;
    if (!choices.length || !next) return;
    event.preventDefault();
    next.focus();
  };
  return wrapper;
}

function importSourceInput() {
  let values: readonly string[] = [];
  let source = "";
  const field = input("source");
  field.setAttribute("aria-label", "Source");
  field.autocomplete = "off";
  field.spellcheck = false;
  const summary = button("", () => {
    source = "";
    renderSummary();
    field.focus();
  }, "image-import-source-summary");
  summary.setAttribute("aria-live", "polite");
  function renderSummary(): void {
    summary.hidden = !source;
    summary.setAttribute("aria-label", source ? `Remove source ${source}` : "No source selected");
    summary.replaceChildren(element("span", "", "Source"), element("strong", "", source), icon("close"));
  }
  function commit(value = field.value): boolean {
    const trimmed = value.trim();
    if (!trimmed) return false;
    source = values.find(candidate => candidate.toLowerCase() === trimmed.toLowerCase()) ?? trimmed;
    field.value = "";
    field.setCustomValidity("");
    renderSummary();
    return true;
  }
  const wrapper = suggestedInput(field, value => {
    const query = value.trim().toLowerCase();
    return values.filter(choice => choice !== value && choice.toLowerCase().includes(query)).slice(0, 5)
      .map(choice => ({ label: choice, value: choice }));
  }, () => field.setCustomValidity(""), commit);
  wrapper.classList.add("image-import-source-field");
  wrapper.prepend(icon("source"));
  field.addEventListener("keydown", event => {
    if (event.isComposing || !field.value.trim() || event.key !== "Enter" && event.key !== "Tab") return;
    if (event.key === "Enter") event.preventDefault();
    commit();
    wrapper.querySelector(".scry-suggestions")?.replaceChildren();
  });
  wrapper.addEventListener("focusout", () => queueMicrotask(() => {
    if (wrapper.contains(document.activeElement)) return;
    commit();
  }));
  renderSummary();
  return {
    wrapper,
    summary,
    value: () => source,
    reportValidity(): boolean {
      commit();
      field.setCustomValidity(source ? "" : "Enter a source.");
      return field.reportValidity();
    },
    update(next: readonly string[]) { values = next; },
  };
}

function parseTags(value: string): string[] {
  return [...new Map(value.split(/[,\n]/).map(tag => tag.trim()).filter(Boolean)
    .map(tag => [tag.toLowerCase(), tag] as const)).values()];
}

function importTagInput() {
  let values: readonly string[] = [];
  const tags: string[] = [];
  const wrapper = element("div", "scry-suggested-input image-import-tag-field");
  const summary = element("div", "image-import-tag-summary");
  summary.setAttribute("aria-label", "Selected tags");
  summary.setAttribute("aria-live", "polite");
  const entry = element("div", "image-import-tag-entry");
  const field = input("tag");
  field.setAttribute("aria-label", "Add tag");
  field.autocomplete = "off";
  field.spellcheck = false;
  entry.append(icon("tag"), field);
  const suggestions = element("div", "scry-suggestions");
  suggestions.setAttribute("role", "group");
  suggestions.setAttribute("aria-label", "Tag suggestions");
  wrapper.append(entry, suggestions);

  function renderTags(): void {
    summary.hidden = !tags.length;
    summary.replaceChildren(...tags.map((tag, index) => {
      const chip = button("", () => {
        tags.splice(index, 1);
        field.setCustomValidity("");
        renderTags();
        renderSuggestions();
        field.focus();
      }, "image-import-tag");
      chip.setAttribute("aria-label", `Remove tag ${tag}`);
      chip.append(element("span", "", tag), icon("close"));
      return chip;
    }));
  }

  function addTags(input: string): boolean {
    const existing = new Map(values.map(value => [value.toLowerCase(), value]));
    const selected = new Set(tags.map(tag => tag.toLowerCase()));
    let added = false;
    for (const parsed of parseTags(input)) {
      const key = parsed.toLowerCase();
      if (selected.has(key)) continue;
      tags.push(existing.get(key) ?? parsed);
      selected.add(key);
      added = true;
    }
    if (added) {
      field.setCustomValidity("");
      renderTags();
    }
    return added;
  }

  function commit(): boolean {
    const added = addTags(field.value);
    if (parseTags(field.value).length) field.value = "";
    renderSuggestions();
    return added;
  }

  function renderSuggestions(): void {
    const query = field.value.trim().toLowerCase();
    const selected = new Set(tags.map(tag => tag.toLowerCase()));
    suggestions.replaceChildren(...values.filter(value =>
      !selected.has(value.toLowerCase()) && value.toLowerCase().includes(query)).slice(0, 5).map(value => {
      const choice = button(value, () => {
        addTags(value);
        field.value = "";
        renderSuggestions();
        field.focus();
      });
      choice.onpointerdown = event => event.preventDefault();
      return choice;
    }));
  }

  entry.onclick = event => { if (event.target !== field) field.focus(); };
  field.onclick = renderSuggestions;
  field.oninput = () => {
    field.setCustomValidity("");
    const match = /^(.*[,\n])([^,\n]*)$/s.exec(field.value);
    if (match) {
      addTags(match[1]);
      field.value = match[2];
    }
    renderSuggestions();
  };
  field.onkeydown = event => {
    if (event.isComposing) return;
    if ((event.key === "," || event.key === "Enter" || event.key === "Tab") && field.value.trim()) {
      if (event.key !== "Tab") event.preventDefault();
      commit();
      return;
    }
    if (event.key === "Backspace" && !field.value && tags.length) {
      tags.pop();
      renderTags();
      renderSuggestions();
      return;
    }
    if (event.key === "Escape") {
      suggestions.replaceChildren();
      return;
    }
    if (event.key === "ArrowDown" && suggestions.firstElementChild) {
      event.preventDefault();
      (suggestions.firstElementChild as HTMLButtonElement).focus();
    }
  };
  wrapper.onkeydown = event => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" || event.target === field) return;
    const choices = [...suggestions.querySelectorAll("button")];
    const index = choices.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? choices[index + 1] : choices[index - 1] ?? field;
    if (!next) return;
    event.preventDefault();
    next.focus();
  };
  wrapper.addEventListener("focusout", () => queueMicrotask(() => {
    if (wrapper.contains(document.activeElement)) return;
    commit();
    suggestions.replaceChildren();
  }));
  renderTags();

  return {
    wrapper,
    summary,
    tags: () => [...tags],
    reportValidity(): boolean {
      commit();
      field.setCustomValidity(tags.length ? "" : "Enter at least one tag.");
      return field.reportValidity();
    },
    update(next: readonly string[]) { values = next; },
  };
}

function mount(container: HTMLElement, tools: HTMLElement): () => void {
  let disposed = false;
  let busy = false;
  let operation = 0;
  let restoreTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingConnection: AbortController | undefined;
  let request = 0;
  let viewerRequest = 0;
  let provider: ScryProvider | undefined;
  let source: FileConnection | undefined;
  let savedConnection: FileSystemDirectoryHandle | undefined;
  let viewerImages: readonly ImageSummary[] = [];
  let viewerGroup: ImageGroup | undefined;
  let activeIndex = 0;
  let viewerUrl: string | undefined;
  let wheelDistance = 0;
  let wheelLocked = false;
  let wheelReset: ReturnType<typeof setTimeout> | undefined;
  const thumbnailUrls = new Set<string>();
  const page = element("section", "library-view local-images-view");
  const toolbar = element("div", "scry-toolbar");
  const connectionToggle = button("", () => setConnectionOpen(!connectionDialog.open), "scry-tool-button");
  setAction(connectionToggle, "library", "Library settings");
  const importToggle = button("", () => setImportOpen(true), "scry-tool-button");
  setAction(importToggle, "addImages", "Add images");
  importToggle.disabled = true;
  const connect = button("Remember folder connection", () => { void run(async () => {
    if (source?.root.kind !== "directory") return;
    await rememberFolder(source.root.handle);
  }); });
  connect.disabled = true;
  connect.hidden = true;
  const sessionPicker = input("Open image folder for this session", "file");
  sessionPicker.webkitdirectory = true;
  sessionPicker.multiple = true;
  sessionPicker.hidden = true;
  sessionPicker.onchange = () => {
    const selected = sessionPicker.files ? [...sessionPicker.files] : [];
    if (selected.length) void run(async () => {
      try {
        const name = selected[0].webkitRelativePath.split("/")[0] || "Selected files";
        await useSource({ name, root: { kind: "selection", files: selected } });
        if (!disposed) status.textContent = "";
      } finally { sessionPicker.value = ""; }
    });
  };
  const openSession = button("Connect image folder", () => {
    if (!window.showDirectoryPicker) { sessionPicker.click(); return; }
    void run(async () => {
      status.textContent = "Waiting for folder selection…";
      const root = await chooseDirectory();
      if (!disposed) await connectDirectory(root);
    });
  }, "primary-button");
  const createLibrary = button("Create image library", () => { void run(async () => {
    status.textContent = "Choose or create a folder for the new image library…";
    const root = await chooseDirectory("readwrite");
    if (!disposed) await connectDirectory(root, true);
  }); });
  createLibrary.hidden = !window.showDirectoryPicker;
  const sessionFallback = button("Open folder for this session", () => sessionPicker.click());
  sessionFallback.hidden = !window.showDirectoryPicker;
  const reload = button("", () => {
    if (source) void run(() => useSource(source!));
  }, "scry-tool-button");
  setAction(reload, "refresh", "Reload library");
  reload.disabled = true;
  const cancelConnection = button("Cancel connection", () => pendingConnection?.abort());
  cancelConnection.hidden = true;
  const localCopy = button("", downloadHtml, "scry-tool-button");
  setAction(localCopy, "save", "Save a local HTML copy");
  localCopy.hidden = window.location.protocol !== "file:" || !window.location.hostname;
  toolbar.append(connectionToggle, importToggle, reload, localCopy);
  tools.append(toolbar);

  const connectionDialog = element("dialog", "library-dialog");
  connectionDialog.setAttribute("aria-labelledby", "scry-library-title");
  const connectionHeader = element("header", "library-dialog-header");
  const connectionTitle = element("h2", "", "Library");
  connectionTitle.id = "scry-library-title";
  const closeConnection = button("", () => setConnectionOpen(false));
  setAction(closeConnection, "close", "Close");
  connectionHeader.append(connectionTitle, closeConnection);
  const connectionName = element("strong", "", "No library connected");
  const connectionActions = element("div", "library-dialog-actions");
  const reconnect = button("Reconnect saved folder", () => { void run(async () => {
    const root = savedConnection;
    if (!root) return;
    await connecting(async signal => {
      status.textContent = "Waiting for folder access. Approve the permission request in your browser to continue.";
      if (!await requestReadAccess(root, signal)) throw new Error("Read access was not granted. You can reconnect later.");
      if (!disposed) await useSource({ name: root.name, root: { kind: "directory", handle: root } }, () => !signal.aborted, signal);
    });
  }); });
  const forget = button("Forget folder", () => { void run(async () => {
    const persistence = await savedFolder.forget();
    savedConnection = undefined;
    reconnect.hidden = forget.hidden = true;
    clearLibrary();
    status.textContent = persistence === "tab"
      ? "Folder connection forgotten for this tab. Browser storage could not be updated. Original files were not changed."
      : "Folder connection forgotten. Original files were not changed.";
  }); });
  reconnect.hidden = forget.hidden = true;
  connectionActions.append(openSession, createLibrary, connect, sessionFallback, reconnect, forget, cancelConnection, sessionPicker);
  connectionDialog.append(connectionHeader, connectionName, connectionActions);
  connectionDialog.onclick = event => {
    if (event.target !== connectionDialog) return;
    const bounds = connectionDialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right ||
      event.clientY < bounds.top || event.clientY > bounds.bottom) setConnectionOpen(false);
  };
  const status = element("p", "library-status");
  status.setAttribute("role", "status");
  page.ondragover = event => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = busy ? "none" : "copy";
    page.classList.toggle("is-dragging", !busy);
  };
  page.ondragleave = event => {
    if (!page.contains(event.relatedTarget as Node | null)) page.classList.remove("is-dragging");
  };
  page.ondrop = event => {
    event.preventDefault();
    page.classList.remove("is-dragging");
    if (busy || disposed || !event.dataTransfer) return;
    const directory = droppedDirectory([...event.dataTransfer.items]);
    void run(async () => {
      status.textContent = "Opening dropped folder…";
      const root = await directory;
      if (!disposed) await connectDirectory(root);
    });
  };
  const importPanel = element("form", "image-import-form");
  importPanel.noValidate = true;
  importPanel.setAttribute("aria-label", "Add images");
  const importFields = element("fieldset", "image-import-fields");
  importFields.disabled = true;
  importPanel.append(importFields);
  const sourceInput = importSourceInput();
  const tagInput = importTagInput();
  const importFiles = input("Images or ZIP files to add", "file");
  importFiles.accept = "image/*,.zip,application/zip,application/x-zip-compressed";
  importFiles.multiple = true;
  importFiles.hidden = true;
  const importUrls = input("https://");
  importUrls.setAttribute("aria-label", "Image or ZIP links");
  importUrls.spellcheck = false;
  importUrls.autocomplete = "off";
  type ImportItem = {
    kind: "file";
    file: File;
    preview?: string;
    state: "queued" | "saving" | "error";
    error?: string;
  } | {
    kind: "url";
    url: string;
    state: "queued" | "downloading" | "ready" | "saving" | "error";
    received?: number;
    size?: number;
    error?: string;
  };
  const queuedItems: ImportItem[] = [];
  let queueFrame: number | undefined;
  const importQueue = element("ul", "image-import-queue");
  importQueue.hidden = true;
  const importMessage = element("p", "image-import-message");
  importMessage.setAttribute("role", "status");
  const addImages = element("button", "primary-button image-import-submit");
  setAction(addImages, "upload", "Add to library");
  addImages.type = "submit";
  const addCount = element("span", "image-import-count");
  addImages.append(addCount);
  function itemLabel(item: ImportItem): { name: string; detail: string } {
    if (item.kind === "file") return { name: item.file.name, detail: bytes(item.file.size) };
    const url = new URL(item.url);
    const segment = url.pathname.split("/").filter(Boolean).pop() ?? url.hostname;
    let name = segment;
    try { name = decodeURIComponent(segment); } catch { /* Keep the encoded path segment. */ }
    return { name, detail: url.hostname };
  }
  function itemStatus(item: ImportItem): string {
    if (item.state === "downloading") {
      return item.size ? `${bytes(item.received ?? 0)} / ${bytes(item.size)}` : `${bytes(item.received ?? 0)}`;
    }
    if (item.state === "ready") return "Downloaded";
    if (item.state === "saving") return "Adding…";
    if (item.state === "error") return item.error ?? "Failed";
    return "";
  }
  function renderQueue(): void {
    importQueue.hidden = queuedItems.length === 0;
    addImages.disabled = queuedItems.length === 0;
    addCount.textContent = queuedItems.length ? String(queuedItems.length) : "";
    addCount.hidden = queuedItems.length === 0;
    importQueue.replaceChildren(...queuedItems.map((queued, index) => {
      const row = element("li", `image-import-item is-${queued.state}`);
      const visual = element("span", "image-import-preview");
      if (queued.kind === "file" && queued.preview) {
        const preview = element("img");
        preview.src = queued.preview;
        preview.alt = "";
        visual.append(preview);
      } else {
        visual.append(icon(queued.kind === "url" ? "link" : "archive"));
      }
      const { name, detail } = itemLabel(queued);
      const copy = element("span", "image-import-item-copy");
      const title = element("strong", "", name);
      title.title = queued.kind === "url" ? queued.url : queued.file.name;
      const meta = element("span", "", detail);
      copy.append(title, meta);
      const state = element("span", "image-import-item-state", itemStatus(queued));
      state.title = state.textContent;
      if (queued.state === "downloading") {
        const progress = element("progress");
        progress.setAttribute("aria-label", `Downloading ${name}`);
        if (queued.size) {
          progress.max = queued.size;
          progress.value = Math.min(queued.received ?? 0, queued.size);
        }
        state.prepend(progress);
      }
      const action = button("", () => {
        if (busy) return;
        if (queued.state === "error" && queued.kind === "url") {
          queued.state = "queued";
          queued.error = undefined;
          renderQueue();
          importPanel.requestSubmit();
          return;
        }
        const [removed] = queuedItems.splice(index, 1);
        if (removed?.kind === "file" && removed.preview) URL.revokeObjectURL(removed.preview);
        renderQueue();
        (importQueue.querySelectorAll("button")[index] ??
          importQueue.querySelector("li:last-child button") ?? importUrls).focus();
      });
      setAction(action, queued.state === "error" && queued.kind === "url" ? "refresh" : "close",
        queued.state === "error" && queued.kind === "url" ? `Retry ${name}` : `Remove ${name}`);
      row.append(visual, copy, state, action);
      return row;
    }));
  }
  function scheduleQueueRender(): void {
    if (queueFrame !== undefined) return;
    queueFrame = requestAnimationFrame(() => {
      queueFrame = undefined;
      renderQueue();
    });
  }
  function queueFiles(filesToAdd: readonly File[]): boolean {
    let rejected = 0;
    for (const file of filesToAdd) {
      const archive = /\.zip$/i.test(file.name) || ["application/zip", "application/x-zip-compressed"].includes(file.type);
      if (!file.type.startsWith("image/") && !archive) { rejected++; continue; }
      const duplicate = queuedItems.some(item => item.kind === "file" && item.file.name === file.name &&
        item.file.size === file.size && item.file.lastModified === file.lastModified);
      if (duplicate) continue;
      queuedItems.push({ kind: "file", file,
        preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined, state: "queued" });
    }
    renderQueue();
    importMessage.textContent = rejected ? `Skipped ${rejected} unsupported ${rejected === 1 ? "file" : "files"}.` : "";
    return rejected === 0;
  }
  function queueLinks(value: string): boolean {
    const entries = downloadUrls(value);
    if (!entries.length) return true;
    let rejected = 0;
    for (const entry of entries) {
      const url = URL.canParse(entry) ? new URL(entry) : undefined;
      if (url?.protocol === "https:" && !url.username && !url.password) {
        if (!queuedItems.some(item => item.kind === "url" && item.url === url.href)) {
          queuedItems.push({ kind: "url", url: url.href, state: "queued" });
        }
      }
      else rejected++;
    }
    renderQueue();
    importMessage.textContent = rejected ? `Skipped ${rejected} invalid HTTPS ${rejected === 1 ? "link" : "links"}.` : "";
    return rejected === 0;
  }
  importUrls.onpaste = event => {
    event.preventDefault();
    queueLinks(event.clipboardData?.getData("text/plain") ?? "");
    importUrls.value = "";
  };
  importUrls.onkeydown = event => {
    if (event.key !== "Enter" || event.isComposing || !importUrls.value.trim()) return;
    event.preventDefault();
    if (queueLinks(importUrls.value)) importUrls.value = "";
  };
  const chooseFiles = button("", () => importFiles.click());
  setAction(chooseFiles, "add", "Choose files");
  const linkRow = element("label", "image-import-links");
  linkRow.append(icon("link"), importUrls);
  const inputs = element("div", "image-import-inputs");
  inputs.append(linkRow, chooseFiles, importFiles);
  importFiles.onchange = () => {
    queueFiles(Array.from(importFiles.files ?? []));
    importFiles.value = "";
  };
  importUrls.oninput = () => {
    importMessage.textContent = "";
  };
  const metadataFields = element("div", "image-import-metadata");
  metadataFields.append(sourceInput.wrapper, tagInput.wrapper);
  const importPicker = element("div", "image-import-picker");
  const importSummary = element("div", "image-import-summary");
  const metadataSummary = element("div", "image-import-metadata-summary");
  metadataSummary.append(sourceInput.summary, tagInput.summary);
  importSummary.append(importQueue, metadataSummary);
  importPicker.append(inputs, metadataFields);
  const closeImport = button("", () => setImportOpen(false), "image-import-close");
  setAction(closeImport, "close", "Close");
  const importDialogActions = element("div", "image-import-dialog-actions");
  importDialogActions.append(closeImport, addImages);
  const importTop = element("div", "image-import-top");
  importTop.append(importSummary, importPicker, importDialogActions);
  importFields.append(importTop, importMessage);
  const importDialog = element("dialog", "image-import-dialog");
  importDialog.setAttribute("aria-label", "Add images");
  importDialog.append(importPanel);
  importDialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  renderQueue();
  importPanel.ondragover = event => {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = busy ? "none" : "copy";
    importPanel.classList.toggle("is-dragging", !busy);
  };
  importPanel.ondragleave = event => {
    event.stopPropagation();
    if (!importPanel.contains(event.relatedTarget as Node | null)) importPanel.classList.remove("is-dragging");
  };
  importPanel.ondrop = event => {
    event.preventDefault();
    event.stopPropagation();
    importPanel.classList.remove("is-dragging");
    if (!busy && event.dataTransfer) queueFiles([...event.dataTransfer.files]);
  };
  importPanel.onsubmit = event => {
    event.preventDefault();
    const current = provider;
    const root = source?.root;
    const selected = queuedItems.filter((item): item is Extract<ImportItem, { kind: "file" }> => item.kind === "file")
      .map(item => item.file);
    if (busy || !current || root?.kind !== "directory") return;
    if (!queueLinks(importUrls.value)) return;
    importUrls.value = "";
    const linkItems = queuedItems.filter((item): item is Extract<ImportItem, { kind: "url" }> => item.kind === "url");
    const urls = linkItems.map(item => item.url);
    if (!selected.length && !urls.length) {
      importUrls.focus();
      return;
    }
    importMessage.textContent = "";
    if (!tagInput.reportValidity() || !sourceInput.reportValidity()) return;
    const tags = tagInput.tags();
    const permission = root.handle.requestPermission({ mode: "readwrite" });
    void run(async () => {
      status.textContent = "";
      if (await permission.catch(() => "denied") !== "granted") {
        importMessage.textContent = "Write access was not granted.";
        return;
      }
      queuedItems.forEach(item => {
        item.state = item.kind === "url" ? "queued" : "saving";
        item.error = undefined;
      });
      renderQueue();
      let downloaded: File[];
      let activeUrl: string | undefined;
      try {
        downloaded = await downloadImages(urls, progress => {
          activeUrl = progress.current;
          linkItems.forEach((item, index) => {
            if (index < progress.completed || !progress.current) item.state = "ready";
            else if (item.url === progress.current) {
              item.state = "downloading";
              item.received = progress.received;
              item.size = progress.size;
            }
          });
          scheduleQueueRender();
        });
      } catch (error) {
        const failed = linkItems.find(item => item.url === activeUrl) ?? linkItems.find(item => item.state !== "ready");
        if (failed) {
          failed.state = "error";
          failed.error = errorMessage(error);
        }
        queuedItems.filter(item => item.kind === "file").forEach(item => { item.state = "queued"; });
        renderQueue();
        return;
      }
      queuedItems.forEach(item => { item.state = "saving"; });
      renderQueue();
      let result;
      try {
        result = await current.addImages([...selected, ...downloaded], tags, sourceInput.value());
      } catch (error) {
        importMessage.textContent = errorMessage(error);
        queuedItems.forEach(item => { item.state = "error"; item.error = "Could not add"; });
        renderQueue();
        return;
      }
      if (disposed) return;
      importUrls.value = "";
      queuedItems.forEach(item => { if (item.kind === "file" && item.preview) URL.revokeObjectURL(item.preview); });
      queuedItems.splice(0);
      renderQueue();
      await refresh();
      setImportOpen(false);
      status.textContent = `${result.added} images added · ${result.skipped} duplicates reused or skipped.` +
        (result.groupsAdded !== undefined ? ` ${result.groupsAdded} groups added · ${result.groupsSkipped} existing groups skipped.` : "");
    });
  };
  const filters = element("div", "library-filters");
  const search = input("Search images or tags", "search");
  search.autocomplete = "off";
  search.title = 'Combine terms, source: or tag:. Use quotes for spaces and - to exclude.';
  let searchFacets: Parameters<typeof imageSearchChoices>[1] = { source: [], tag: [] };
  const searchField = suggestedInput(search, value => imageSearchChoices(value, searchFacets), () => { void refresh(); });
  searchField.classList.add("library-search");
  searchField.prepend(icon("search"));
  let oldestFirst = false;
  const order = button("", () => {
    oldestFirst = !oldestFirst;
    order.classList.toggle("is-oldest", oldestFirst);
    setAction(order, "sort", oldestFirst ? "Oldest first" : "Newest first");
    void refresh();
  }, "library-filter-action");
  setAction(order, "sort", "Newest first");
  const count = element("span", "library-count");
  filters.append(searchField, count, order);
  const libraryControls = element("header", "library-controls");
  libraryControls.append(filters);
  const grid = element("div", "image-grid");
  grid.setAttribute("aria-label", "Image collection");

  const dialog = element("dialog", "image-dialog");
  dialog.setAttribute("aria-label", "Image viewer");
  const close = button("", () => dialog.close());
  setAction(close, "close", "Close");
  const viewerBody = element("div", "image-viewer-body");
  const stage = element("div", "image-viewer-stage");
  const original = element("img", "image-original");
  stage.append(original);
  const info = element("div", "image-info");
  const classification = element("p");
  const properties = element("p", "library-description");
  const imageTags = element("div", "local-images-tags");
  const viewerStatus = element("p", "library-status");
  viewerStatus.setAttribute("role", "status");
  const deleteImage = button("", () => {
    const current = provider;
    const root = source?.root;
    const image = viewerImages[activeIndex];
    const group = viewerGroup;
    if (busy || !current || root?.kind !== "directory" || !image) return;
    const message = group
      ? `Delete this entire group (${group.images.length} images)? Images shared with other groups will be kept.`
      : "Permanently delete this image from the library and disk?";
    if (!window.confirm(message)) return;
    const permission = root.handle.requestPermission({ mode: "readwrite" });
    void run(async () => {
      viewerStatus.textContent = "Deleting…";
      try {
        if (await permission !== "granted") throw new Error("Write access was not granted. Nothing was deleted.");
        const result = await current.deleteEntry({ kind: group ? "group" : "image", id: group?.id ?? image.id });
        if (disposed) return;
        dialog.close();
        await refresh();
        status.textContent = `${group ? "Group deleted. " : ""}${result.deleted} images deleted.` +
          (result.shared ? ` ${result.shared} shared images kept.` : "") +
          (result.failedFiles ? ` ${result.failedFiles} files could not be removed from disk.` : "");
      } catch (error) {
        if (!disposed) viewerStatus.textContent = errorMessage(error);
        throw error;
      }
    });
  }, "danger-button");
  setAction(deleteImage, "trash", "Delete image");
  info.append(classification, properties, imageTags, viewerStatus);
  viewerBody.append(stage, info);
  const navigation = element("footer", "image-navigation");
  const previous = button("", () => { void move(-1); });
  setAction(previous, "previous", "Previous");
  const position = element("span");
  const next = button("", () => { void move(1); });
  setAction(next, "next", "Next");
  const zoom = button("", () => {
    const actual = stage.classList.toggle("actual-size");
    stage.scrollTo(0, 0);
    setAction(zoom, "maximize", actual ? "Fit image" : "Actual size");
  });
  setAction(zoom, "maximize", "Actual size");
  const destructiveActions = element("div", "image-navigation-actions");
  destructiveActions.append(deleteImage);
  const pagingActions = element("div", "image-navigation-paging");
  pagingActions.append(previous, position, next);
  const viewerActions = element("div", "image-navigation-actions image-navigation-viewer-actions");
  viewerActions.append(zoom, close);
  navigation.append(destructiveActions, pagingActions, viewerActions);
  dialog.append(viewerBody, navigation);
  dialog.addEventListener("keydown", event => {
    if (event.key === "ArrowLeft") { event.preventDefault(); void move(-1); }
    if (event.key === "ArrowRight") { event.preventDefault(); void move(1); }
  });
  stage.addEventListener("wheel", event => {
    if (!viewerGroup || stage.classList.contains("actual-size")) return;
    event.preventDefault();
    clearTimeout(wheelReset);
    wheelReset = setTimeout(() => {
      wheelDistance = 0;
      wheelLocked = false;
    }, 160);
    if (wheelLocked) return;
    const dominantDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight : 1;
    wheelDistance += dominantDelta * scale;
    if (Math.abs(wheelDistance) < 40) return;
    wheelLocked = true;
    void move(wheelDistance > 0 ? 1 : -1);
  }, { passive: false });
  dialog.addEventListener("close", () => {
    viewerRequest += 1;
    clearTimeout(wheelReset);
    wheelDistance = 0;
    wheelLocked = false;
    if (viewerUrl) URL.revokeObjectURL(viewerUrl);
    viewerUrl = undefined;
    original.removeAttribute("src");
    viewerImages = [];
    viewerGroup = undefined;
    activeIndex = 0;
  });
  page.append(libraryControls, grid, status, connectionDialog, importDialog, dialog);
  container.replaceChildren(page);
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      observer.unobserve(entry.target);
      void loadThumbnail(entry.target as HTMLImageElement, request);
    }
  }, { rootMargin: "150px" });

  function releaseThumbnails(): void {
    observer.disconnect();
    for (const url of thumbnailUrls) URL.revokeObjectURL(url);
    thumbnailUrls.clear();
  }

  function setConnectionOpen(open: boolean): void {
    if (open && !connectionDialog.open) connectionDialog.showModal();
    else if (!open && connectionDialog.open) connectionDialog.close();
  }

  function setImportOpen(open: boolean): void {
    if (open && !importDialog.open && source?.root.kind === "directory") {
      importDialog.showModal();
      importUrls.focus();
    } else if (!open && importDialog.open) importDialog.close();
  }

  function clearLibrary(): void {
    request += 1;
    dialog.close();
    setImportOpen(false);
    releaseThumbnails();
    provider?.close();
    provider = undefined;
    source = undefined;
    searchFacets = { source: [], tag: [] };
    grid.replaceChildren();
    connectionName.textContent = "No library connected";
    count.textContent = "";
    reload.disabled = true;
    importToggle.disabled = true;
    importFields.disabled = true;
    connect.disabled = true;
    connect.hidden = true;
  }

  async function useSource(next: FileConnection, isCurrent = () => true, signal?: AbortSignal, create = false): Promise<void> {
    status.textContent = "Starting SQLite…";
    const sqlite = await waitFor(loadSqlite(), "SQLite did not finish starting. Try reconnecting the folder.", 15000, signal);
    if (disposed || !isCurrent()) return;
    status.textContent = create ? "Creating image library…" : "Reading library database…";
    const candidate = new ScryProvider(files, sqlite);
    const pending = (async () => {
      if (create) await candidate.createLibrary(next.root);
      await candidate.connect(next.root);
    })();
    try { await waitFor(pending, "The browser did not finish reading the library database. Try reconnecting the folder.", 15000, signal); }
    catch (error) {
      candidate.close();
      void pending.then(() => candidate.close(), () => {});
      throw error;
    }
    if (disposed || !isCurrent()) { candidate.close(); return; }
    clearLibrary();
    provider = candidate;
    source = next;
    const isSession = next.root.kind === "selection";
    connectionName.textContent = next.name;
    importToggle.disabled = isSession;
    importFields.disabled = isSession || busy;
    connect.hidden = isSession || next.root.kind === "directory" && next.root.handle === savedConnection;
    reconnect.hidden = true;
    search.value = "";
    await refresh();
    reload.disabled = false;
    connect.disabled = isSession;
    connect.title = isSession ? "This selection has no reusable folder handle and cannot be remembered without copying files." : "Remember the connected folder without selecting it again.";
    if (!disposed) {
      status.textContent = "";
      setConnectionOpen(false);
    }
  }

  async function rememberFolder(root: FileSystemDirectoryHandle): Promise<void> {
    try {
      const persistence = await savedFolder.save(root);
      if (disposed) return;
      savedConnection = root;
      reconnect.hidden = true;
      forget.hidden = false;
      connect.hidden = true;
      status.textContent = persistence === "tab" ? "Connection saved for this tab." : "";
    } catch (error) {
      if (!disposed) {
        connect.hidden = false;
        status.textContent = `Folder connected for this session, but its connection was not saved. ${errorMessage(error)}`;
      }
    }
  }

  async function connectDirectory(root: FileSystemDirectoryHandle, create = false): Promise<void> {
    await connecting(signal => useSource({ name: root.name, root: { kind: "directory", handle: root } }, () => !signal.aborted, signal, create));
    if (!disposed && source?.root.kind === "directory" && source.root.handle === root) await rememberFolder(root);
  }

  async function connecting(action: (signal: AbortSignal) => Promise<void>): Promise<void> {
    const controller = new AbortController();
    pendingConnection = controller;
    cancelConnection.hidden = false;
    try { await action(controller.signal); }
    finally {
      if (pendingConnection === controller) {
        pendingConnection = undefined;
        if (!disposed) cancelConnection.hidden = true;
      }
    }
  }

  async function loadThumbnail(image: HTMLImageElement, token: number): Promise<void> {
    const current = provider;
    if (!current) return;
    try {
      const blob = await current.readImage(image.dataset.id!);
      if (disposed || request !== token || !image.isConnected) return;
      const url = URL.createObjectURL(blob);
      thumbnailUrls.add(url);
      image.src = url;
    } catch {
      if (!disposed && request === token) {
        image.alt = "Original image unavailable";
        image.closest("button")?.append(element("span", "library-hint image-unavailable", "Original unavailable"));
      }
    }
  }

  async function showImage(index: number): Promise<void> {
    const image = viewerImages[index];
    const current = provider;
    if (!image || !current || disposed || busy) return;
    const token = ++viewerRequest;
    activeIndex = index;
    deleteImage.hidden = source?.root.kind !== "directory";
    setAction(deleteImage, "trash", viewerGroup ? "Delete group" : "Delete image");
    classification.textContent = viewerGroup?.source ?? image.source;
    properties.textContent = `${image.mimeType} · ${bytes(image.byteSize)} · ${new Date(image.createdAt).toLocaleDateString()}`;
    imageTags.replaceChildren(...image.tags.map(tag => element("span", "local-images-tag", tag)));
    position.textContent = `${index + 1} / ${viewerImages.length}`;
    previous.disabled = index === 0;
    next.disabled = index === viewerImages.length - 1;
    stage.classList.remove("actual-size");
    stage.scrollTo(0, 0);
    setAction(zoom, "maximize", "Actual size");
    if (viewerUrl) URL.revokeObjectURL(viewerUrl);
    viewerUrl = undefined;
    original.removeAttribute("src");
    original.alt = image.tags.join(", ") || image.source;
    viewerStatus.textContent = "Reading original image…";
    if (!dialog.open) dialog.showModal();
    try {
      const blob = await current.readImage(image.id);
      if (disposed || token !== viewerRequest || !dialog.open) return;
      viewerUrl = URL.createObjectURL(blob);
      original.src = viewerUrl;
      viewerStatus.textContent = "";
    } catch (error) { if (!disposed && token === viewerRequest) viewerStatus.textContent = errorMessage(error); }
  }

  async function move(delta: number): Promise<void> {
    if (viewerImages[activeIndex + delta]) await showImage(activeIndex + delta);
  }

  async function refresh(): Promise<void> {
    const current = provider;
    if (!current || disposed) return;
    const token = ++request;
    try {
      const result = await current.fetch({ terms: parseImageSearch(search.value), order: oldestFirst ? "oldest" : "newest" });
      if (disposed || token !== request) return;
      const images = result.standaloneImages;
      const entries = [
        ...images.map(image => ({ image, group: undefined as ImageGroup | undefined, createdAt: image.createdAt, id: Number(image.id) })),
        ...result.groups.map(group => ({ image: group.images[0], group, createdAt: group.createdAt, id: Number(group.id) })),
      ].sort((left, right) => {
        const compared = left.createdAt.localeCompare(right.createdAt) || left.id - right.id;
        return oldestFirst ? compared : -compared;
      });
      searchFacets = { source: result.sources, tag: result.tags };
      tagInput.update(result.tags);
      sourceInput.update(result.sources);
      count.textContent = entries.length === 1 ? "1 result" : `${entries.length} results`;
      releaseThumbnails();
      grid.replaceChildren(...entries.map(({ image, group }) => {
        const card = button("", () => {
          viewerGroup = group;
          viewerImages = group?.images ?? images;
          void showImage(group ? 0 : images.findIndex(candidate => candidate.id === image.id));
        }, group ? "image-card image-group-card" : "image-card");
        const label = image.tags.join(", ") || image.source;
        card.setAttribute("aria-label", group ? `View ${label}, ${group.images.length} images` : `View ${label}`);
        const thumbnail = element("img");
        thumbnail.alt = label;
        thumbnail.loading = "lazy";
        thumbnail.dataset.id = image.id;
        thumbnail.onerror = () => { thumbnail.alt = "Image format could not be displayed"; };
        card.append(thumbnail);
        if (group) {
          const badge = element("span", "image-group-count", String(group.images.length));
          badge.setAttribute("aria-hidden", "true");
          card.append(badge);
        }
        observer.observe(thumbnail);
        return card;
      }));
      if (!entries.length) grid.append(element("p", "library-empty", result.total ? "No images match these filters." : "No images are registered in this library."));
    } catch (error) { if (!disposed && token === request) status.textContent = errorMessage(error); }
  }

  async function run(action: () => Promise<void>): Promise<void> {
    if (busy || disposed) return;
    operation += 1;
    busy = true;
    const controls = [connectionToggle, importToggle, connect, openSession, createLibrary, sessionFallback, closeImport,
      reload, reconnect, forget, deleteImage, order];
    controls.forEach(control => { control.disabled = true; });
    importFields.disabled = true;
    status.textContent = "Reading library…";
    try { await action(); }
    catch (error) {
      if (!disposed) status.textContent = errorMessage(error);
    } finally {
      busy = false;
      if (!disposed) {
        controls.forEach(control => { control.disabled = false; });
        reload.disabled = !provider;
        importToggle.disabled = source?.root.kind !== "directory";
        importFields.disabled = source?.root.kind !== "directory";
        connect.disabled = source?.root.kind !== "directory";
      }
    }
  }

  async function restore(): Promise<void> {
    const token = operation;
    let expired = false;
    const isCurrent = () => !disposed && !expired && token === operation;
    status.textContent = "Looking for a saved folder connection…";
    restoreTimer = setTimeout(() => {
      if (isCurrent()) {
        status.textContent = "Saved folder restoration did not respond. Connect a folder directly to try again.";
        setConnectionOpen(true);
      }
      expired = true;
    }, 10000);
    try {
      const saved = await savedFolder.load();
      if (!isCurrent()) return;
      savedConnection = saved;
      if (savedConnection) {
        connectionName.textContent = savedConnection.name;
        reconnect.hidden = forget.hidden = false;
        const allowed = await hasReadAccess(savedConnection);
        if (!isCurrent()) return;
        if (allowed) {
          await useSource({ name: savedConnection.name, root: { kind: "directory", handle: savedConnection } }, isCurrent);
          return;
        }
        status.textContent = "Saved folder found. Reconnect it to approve read access.";
        setConnectionOpen(true);
        return;
      }
      status.textContent = "";
      setConnectionOpen(true);
    } catch (error) {
      if (isCurrent()) {
        status.textContent = `Could not restore the folder connection. ${errorMessage(error)}`;
        setConnectionOpen(true);
      }
    } finally { clearTimeout(restoreTimer); }
  }

  clearLibrary();
  void restore();
  return () => {
    disposed = true;
    pendingConnection?.abort();
    clearTimeout(restoreTimer);
    clearTimeout(wheelReset);
    if (queueFrame !== undefined) cancelAnimationFrame(queueFrame);
    request += 1;
    viewerRequest += 1;
    dialog.close();
    setConnectionOpen(false);
    setImportOpen(false);
    releaseThumbnails();
    provider?.close();
    queuedItems.forEach(item => { if (item.kind === "file" && item.preview) URL.revokeObjectURL(item.preview); });
    if (viewerUrl) URL.revokeObjectURL(viewerUrl);
    toolbar.remove();
  };
}

export default { title: "Scry", category: "Images", icon: "images", mount } satisfies View;
