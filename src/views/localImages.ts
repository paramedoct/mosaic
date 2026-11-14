import type { View } from "../types";
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

function mount(container: HTMLElement): () => void {
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
  const header = element("header", "library-header");
  const heading = element("div");
  heading.append(element("p", "library-eyebrow", "LOCAL IMAGE LIBRARY"), element("h1", "", "Local Images"),
    element("p", "library-description", "Explore your original images, right where they live."));
  const actions = element("div", "library-actions");
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
        if (!disposed) status.textContent = "Folder opened for this session. Original images stay on disk; select the folder again after reopening Mosaic.";
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
  const sessionFallback = button("Open folder for this session", () => sessionPicker.click());
  sessionFallback.hidden = !window.showDirectoryPicker;
  const reload = button("Reload library", () => {
    if (source) void run(() => useSource(source!));
  });
  reload.disabled = true;
  const cancelConnection = button("Cancel connection", () => pendingConnection?.abort());
  cancelConnection.hidden = true;
  actions.append(openSession, connect, sessionFallback, reload, sessionPicker, cancelConnection);
  header.append(heading, actions);
  const connection = element("section", "local-images-connection");
  const connectionText = element("div");
  const mode = element("span", "local-images-mode", "NOT CONNECTED");
  const connectionName = element("strong", "", "No library connected");
  const description = element("p", "library-hint", "Connect the image library root containing images/ and states/db. Folder connections are remembered automatically.");
  connectionText.append(mode, connectionName, description);
  const connectionActions = element("div", "library-actions");
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
  connectionActions.append(reconnect, forget);
  connection.append(connectionText, connectionActions);
  const status = element("p", "library-status");
  status.setAttribute("role", "status");
  const dropzone = element("div", "local-images-dropzone");
  dropzone.append(element("strong", "", "Drop your image library folder here"),
    element("p", "library-hint", "Drag the folder containing images/ and states/db from your file explorer to connect it directly."));
  dropzone.ondragover = event => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = busy ? "none" : "copy";
    dropzone.classList.toggle("is-dragging", !busy);
  };
  dropzone.ondragleave = () => dropzone.classList.remove("is-dragging");
  dropzone.ondrop = event => {
    event.preventDefault();
    dropzone.classList.remove("is-dragging");
    if (busy || disposed || !event.dataTransfer) return;
    const directory = droppedDirectory([...event.dataTransfer.items]);
    void run(async () => {
      status.textContent = "Opening dropped folder…";
      const root = await directory;
      if (!disposed) await connectDirectory(root);
    });
  };
  const importPanel = element("form", "library-import");
  importPanel.hidden = true;
  const importSubject = input("Subject");
  const importSource = input("Source");
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
  importPanel.append(element("h2", "", "Add images"), importControls,
    element("p", "library-hint", "Each ZIP becomes one image group, sorted by filename. Identical images are stored once and shared between groups. ZIP files may include folders; other files are ignored."));
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
      status.textContent = `${result.added} images added · ${result.skipped} duplicates reused or skipped.` +
        (result.groupsAdded !== undefined ? ` ${result.groupsAdded} groups added · ${result.groupsSkipped} existing groups skipped.` : "");
    });
  };
  const locationNotice = element("div", "library-actions local-images-copy");
  locationNotice.hidden = window.location.protocol !== "file:" || !window.location.hostname;
  locationNotice.append(button("Save a local HTML copy", downloadHtml));
  const filters = element("div", "library-filters");
  const search = input("Search images", "search");
  const subjects = select("Filter subject");
  const sources = select("Filter source");
  const order = select("Image order");
  options(subjects, [["", "All subjects"]]);
  options(sources, [["", "All sources"]]);
  options(order, [["newest", "Newest first"], ["oldest", "Oldest first"]]);
  const count = element("span", "library-count");
  for (const control of [subjects, sources, order]) control.onchange = () => { void refresh(); };
  search.oninput = () => { void refresh(); };
  filters.append(search, subjects, sources, order, count);
  const tags = element("div", "local-images-tags");
  tags.setAttribute("aria-label", "Filter tags");
  const grid = element("div", "image-grid");
  grid.setAttribute("aria-label", "Image collection");
  const hint = element("p", "library-hint", "Images stay in the connected folder. Adding images requires folder write access; identical files are skipped using SHA-256.");

  const dialog = element("dialog", "image-dialog");
  dialog.setAttribute("aria-label", "Image viewer");
  const viewerHeader = element("header", "image-viewer-header");
  const viewerTitle = element("h2");
  const close = button("Close", () => dialog.close());
  viewerHeader.append(viewerTitle, close);
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
  const deleteImage = button("Delete image", () => {
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
  viewerHeader.insertBefore(deleteImage, close);
  info.append(classification, properties, imageTags, viewerStatus);
  viewerBody.append(stage, info);
  const navigation = element("footer", "image-navigation");
  const previous = button("← Previous", () => { void move(-1); });
  const position = element("span");
  const next = button("Next →", () => { void move(1); });
  const zoom = button("Actual size", () => {
    const actual = stage.classList.toggle("actual-size");
    stage.scrollTo(0, 0);
    zoom.textContent = actual ? "Fit image" : "Actual size";
  });
  navigation.append(previous, position, next, zoom);
  dialog.append(viewerHeader, viewerBody, navigation);
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
  page.append(header, connection, dropzone, locationNotice, importPanel, filters, tags, status, grid, hint, dialog);
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

  function clearLibrary(): void {
    request += 1;
    dialog.close();
    releaseThumbnails();
    provider?.close();
    provider = undefined;
    source = undefined;
    selectedTags.clear();
    tags.replaceChildren();
    grid.replaceChildren(element("p", "library-empty", "Connect the image library folder containing images/ and states/db."));
    mode.textContent = "NOT CONNECTED";
    connectionName.textContent = "No library connected";
    description.textContent = "Connect the image library root containing images/ and states/db. Folder connections are remembered automatically.";
    count.textContent = "";
    reload.disabled = true;
    connect.disabled = true;
    connect.hidden = true;
    dropzone.hidden = false;
    importPanel.hidden = true;
  }

  async function useSource(next: FileConnection, isCurrent = () => true, signal?: AbortSignal): Promise<void> {
    status.textContent = "Starting SQLite…";
    const sqlite = await waitFor(loadSqlite(), "SQLite did not finish starting. Try reconnecting the folder.", 15000, signal);
    if (disposed || !isCurrent()) return;
    status.textContent = "Reading library database…";
    const candidate = new ScryProvider(files, sqlite);
    const pending = candidate.connect(next.root);
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
    mode.textContent = isSession ? "SESSION" : "CONNECTED";
    connectionName.textContent = next.name;
    description.textContent = isSession
        ? "Original image library folder opened for this session. Files are read-only and are not copied to browser storage."
        : "Image library folder connected. You can add images with write access; image copies are not stored in the browser.";
    importPanel.hidden = isSession;
    dropzone.hidden = !isSession;
    connect.hidden = isSession || next.root.kind === "directory" && next.root.handle === savedConnection;
    reconnect.hidden = true;
    search.value = "";
    options(subjects, [["", "All subjects"]]);
    options(sources, [["", "All sources"]]);
    await refresh();
    reload.disabled = false;
    connect.disabled = isSession;
    connect.title = isSession ? "This selection has no reusable folder handle and cannot be remembered without copying files." : "Remember the connected folder without selecting it again.";
    if (!disposed) status.textContent = "Library connected.";
  }

  async function rememberFolder(root: FileSystemDirectoryHandle): Promise<void> {
    try {
      const persistence = await savedFolder.save(root);
      if (disposed) return;
      savedConnection = root;
      reconnect.hidden = true;
      forget.hidden = false;
      connect.hidden = true;
      status.textContent = persistence === "tab"
        ? "Library connected. Folder connection will be restored after refreshing this tab."
        : "Library connected. Folder connection remembered.";
    } catch (error) {
      if (!disposed) {
        connect.hidden = false;
        status.textContent = `Folder connected for this session, but its connection was not saved. ${errorMessage(error)}`;
      }
    }
  }

  async function connectDirectory(root: FileSystemDirectoryHandle): Promise<void> {
    await connecting(signal => useSource({ name: root.name, root: { kind: "directory", handle: root } }, () => !signal.aborted, signal));
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
    deleteImage.textContent = viewerGroup ? "Delete group" : "Delete image";
    viewerTitle.textContent = viewerGroup?.subject ?? image.subject;
    classification.textContent = viewerGroup ? `${viewerGroup.subject} · ${viewerGroup.source}` : `${image.subject} · ${image.source}`;
    properties.textContent = `${image.mimeType} · ${bytes(image.byteSize)} · ${new Date(image.createdAt).toLocaleDateString()}`;
    imageTags.replaceChildren(...image.tags.map(tag => element("span", "local-images-tag", tag)));
    position.textContent = `${index + 1} / ${viewerImages.length}`;
    previous.disabled = index === 0;
    next.disabled = index === viewerImages.length - 1;
    stage.classList.remove("actual-size");
    stage.scrollTo(0, 0);
    zoom.textContent = "Actual size";
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
        tags: [...selectedTags], order: order.value as "oldest" | "newest" });
      if (disposed || token !== request) return;
      const images = result.standaloneImages;
      const entries = [
        ...images.map(image => ({ image, group: undefined as ImageGroup | undefined, createdAt: image.createdAt, id: Number(image.id) })),
        ...result.groups.map(group => ({ image: group.images[0], group, createdAt: group.createdAt, id: Number(group.id) })),
      ].sort((left, right) => {
        const compared = left.createdAt.localeCompare(right.createdAt) || left.id - right.id;
        return order.value === "oldest" ? compared : -compared;
      });
      options(subjects, [["", "All subjects"], ...result.subjects.map(value => [value, value] as [string, string])]);
      options(sources, [["", "All sources"], ...result.sources.map(value => [value, value] as [string, string])]);
      count.textContent = `${entries.length} items · ${result.total} images · ${bytes(result.byteSize)}`;
      tags.replaceChildren(...result.tags.map(tag => {
        const chip = button(tag, () => {
          if (selectedTags.has(tag)) selectedTags.delete(tag); else selectedTags.add(tag);
          void refresh();
        }, "local-images-tag");
        chip.setAttribute("aria-pressed", String(selectedTags.has(tag)));
        return chip;
      }));
      if (!result.tags.length) tags.append(element("span", "library-hint", "This library uses the original subject and source classifications."));
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
    const controls = [connect, openSession, sessionFallback, reload, reconnect, forget, addImages, importSubject, importSource, importFiles, deleteImage];
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
      if (isCurrent()) status.textContent = "Saved folder restoration did not respond. Connect a folder directly to try again.";
      expired = true;
    }, 10000);
    try {
      const saved = await savedFolder.load();
      if (!isCurrent()) return;
      savedConnection = saved;
      if (savedConnection) {
        connectionName.textContent = savedConnection.name;
        mode.textContent = "SAVED FOLDER";
        reconnect.hidden = forget.hidden = false;
        const allowed = await hasReadAccess(savedConnection);
        if (!isCurrent()) return;
        if (allowed) {
          await useSource({ name: savedConnection.name, root: { kind: "directory", handle: savedConnection } }, isCurrent);
          return;
        }
        dropzone.hidden = true;
        status.textContent = "Saved folder found. Reconnect it to approve read access.";
        return;
      }
      status.textContent = "Connect an image folder to open your library.";
    } catch (error) {
      if (isCurrent()) status.textContent = `Could not restore the folder connection. ${errorMessage(error)}`;
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
    releaseThumbnails();
    provider?.close();
    if (viewerUrl) URL.revokeObjectURL(viewerUrl);
  };
}

export default { title: "Local Images", category: "Images", icon: "images", mount } satisfies View;
