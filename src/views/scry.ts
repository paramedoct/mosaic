import type { View } from "../types";
import { setAction } from "../icons";
import { ScryProvider, loadSqlite, type ImageGroup, type ImageSummary } from "../providers/scry";
import { FileTransport, type FileRoot } from "../transports/file";
import { chooseDirectory, droppedDirectory, hasReadAccess, requestReadAccess, savedFolder, waitFor } from "./scry/folders";
import { button, downloadHtml, element, errorMessage, input, options, select } from "./scry/ui";
import "./scry/style.css";

const files = new FileTransport();
type FileConnection = { name: string; root: FileRoot };

function bytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
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
  const selectedTags = new Set<string>();
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
  const importDialog = element("dialog", "library-dialog");
  importDialog.setAttribute("aria-labelledby", "scry-import-title");
  const importHeader = element("header", "library-dialog-header");
  const importTitle = element("h2", "", "Add images");
  importTitle.id = "scry-import-title";
  const closeImport = button("", () => setImportOpen(false));
  setAction(closeImport, "close", "Close");
  importHeader.append(importTitle, closeImport);
  const importPanel = element("form", "library-import");
  const importSubject = input("Subject");
  const importSource = input("Source");
  const importSubjects = element("datalist");
  const importSources = element("datalist");
  importSubjects.id = "local-image-subjects";
  importSources.id = "local-image-sources";
  importSubject.setAttribute("list", importSubjects.id);
  importSource.setAttribute("list", importSources.id);
  importSubject.required = importSource.required = true;
  const importFiles = input("Images or ZIP files to add", "file");
  importFiles.accept = "image/*,.zip,application/zip,application/x-zip-compressed";
  importFiles.multiple = true;
  importFiles.required = true;
  const addImages = element("button", "primary-button", "Add images");
  addImages.type = "submit";
  const importControls = element("div", "library-actions");
  for (const [label, control] of [["Subject", importSubject], ["Source", importSource], ["Images", importFiles]] as const) {
    const field = element("label", "image-import-field", label);
    field.append(control);
    importControls.append(field);
  }
  importControls.append(addImages);
  importPanel.append(importControls, importSubjects, importSources);
  importDialog.append(importHeader, importPanel);
  importDialog.onclick = event => {
    if (event.target !== importDialog) return;
    const bounds = importDialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right ||
      event.clientY < bounds.top || event.clientY > bounds.bottom) setImportOpen(false);
  };
  importPanel.onsubmit = event => {
    event.preventDefault();
    const current = provider;
    const root = source?.root;
    const selected = importFiles.files ? [...importFiles.files] : [];
    if (busy || !current || root?.kind !== "directory") return;
    const permission = root.handle.requestPermission({ mode: "readwrite" });
    void run(async () => {
      if (await permission !== "granted") throw new Error("Write access was not granted. No images were added.");
      status.textContent = "Opening files, hashing and adding images…";
      const result = await current.addImages(selected, importSubject.value, importSource.value);
      if (disposed) return;
      importFiles.value = "";
      await refresh();
      setImportOpen(false);
      status.textContent = `${result.added} images added · ${result.skipped} duplicates reused or skipped.` +
        (result.groupsAdded !== undefined ? ` ${result.groupsAdded} groups added · ${result.groupsSkipped} existing groups skipped.` : "");
    });
  };
  const filters = element("div", "library-filters");
  const search = input("Search images", "search");
  const subjects = select("Filter subject");
  const sources = select("Filter source");
  let oldestFirst = false;
  const order = button("", () => {
    oldestFirst = !oldestFirst;
    order.classList.toggle("is-oldest", oldestFirst);
    setAction(order, "sort", oldestFirst ? "Oldest first" : "Newest first");
    void refresh();
  }, "library-filter-action");
  setAction(order, "sort", "Newest first");
  options(subjects, [["", "All subjects"]]);
  options(sources, [["", "All sources"]]);
  const count = element("span", "library-count");
  for (const control of [subjects, sources]) control.onchange = () => { void refresh(); };
  search.oninput = () => { void refresh(); };
  filters.append(search, subjects, sources, order, count);
  const tags = element("div", "local-images-tags");
  tags.setAttribute("aria-label", "Filter tags");
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
  dialog.addEventListener("close", () => {
    viewerRequest += 1;
    if (viewerUrl) URL.revokeObjectURL(viewerUrl);
    viewerUrl = undefined;
    original.removeAttribute("src");
    viewerImages = [];
    viewerGroup = undefined;
    activeIndex = 0;
  });
  page.append(filters, tags, status, grid, connectionDialog, importDialog, dialog);
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
      importSubject.focus();
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
    selectedTags.clear();
    tags.replaceChildren();
    grid.replaceChildren();
    connectionName.textContent = "No library connected";
    count.textContent = "";
    reload.disabled = true;
    importToggle.disabled = true;
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
    connect.hidden = isSession || next.root.kind === "directory" && next.root.handle === savedConnection;
    reconnect.hidden = true;
    search.value = "";
    options(subjects, [["", "All subjects"]]);
    options(sources, [["", "All sources"]]);
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
    classification.textContent = viewerGroup ? `${viewerGroup.subject} · ${viewerGroup.source}` : `${image.subject} · ${image.source}`;
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
    original.alt = image.subject;
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
      const result = await current.fetch({ subject: subjects.value, source: sources.value, text: search.value,
        tags: [...selectedTags], order: oldestFirst ? "oldest" : "newest" });
      if (disposed || token !== request) return;
      const images = result.standaloneImages;
      const entries = [
        ...images.map(image => ({ image, group: undefined as ImageGroup | undefined, createdAt: image.createdAt, id: Number(image.id) })),
        ...result.groups.map(group => ({ image: group.images[0], group, createdAt: group.createdAt, id: Number(group.id) })),
      ].sort((left, right) => {
        const compared = left.createdAt.localeCompare(right.createdAt) || left.id - right.id;
        return oldestFirst ? compared : -compared;
      });
      options(subjects, [["", "All subjects"], ...result.subjects.map(value => [value, value] as [string, string])]);
      options(sources, [["", "All sources"], ...result.sources.map(value => [value, value] as [string, string])]);
      importSubjects.replaceChildren(...result.subjects.map(value => {
        const option = element("option");
        option.value = value;
        return option;
      }));
      importSources.replaceChildren(...result.sources.map(value => {
        const option = element("option");
        option.value = value;
        return option;
      }));
      count.textContent = `${entries.length} / ${result.total}`;
      tags.replaceChildren(...result.tags.map(tag => {
        const chip = button(tag, () => {
          if (selectedTags.has(tag)) selectedTags.delete(tag); else selectedTags.add(tag);
          void refresh();
        }, "local-images-tag");
        chip.setAttribute("aria-pressed", String(selectedTags.has(tag)));
        return chip;
      }));
      releaseThumbnails();
      grid.replaceChildren(...entries.map(({ image, group }) => {
        const card = button("", () => {
          viewerGroup = group;
          viewerImages = group?.images ?? images;
          void showImage(group ? 0 : images.findIndex(candidate => candidate.id === image.id));
        }, group ? "image-card image-group-card" : "image-card");
        card.setAttribute("aria-label", group ? `View ${group.subject}, ${group.images.length} images` : `View ${image.subject}`);
        const thumbnail = element("img");
        thumbnail.alt = image.subject;
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
    const controls = [connectionToggle, importToggle, connect, openSession, createLibrary, sessionFallback,
      reload, reconnect, forget, addImages, importSubject, importSource, importFiles, deleteImage, order];
    controls.forEach(control => { control.disabled = true; });
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
    request += 1;
    viewerRequest += 1;
    dialog.close();
    setConnectionOpen(false);
    setImportOpen(false);
    releaseThumbnails();
    provider?.close();
    if (viewerUrl) URL.revokeObjectURL(viewerUrl);
    toolbar.remove();
  };
}

export default { title: "Scry", category: "Images", icon: "images", mount } satisfies View;
