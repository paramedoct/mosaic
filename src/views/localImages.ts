import type { View } from "../types";
import { LocalImagesProvider, type ImageGroup, type ImageSummary } from "../providers/localImages";
import { FileTransport } from "../transports/file";
import { chooseDirectory, hasReadAccess, isSharedFileDocument, requestReadAccess, type FileConnection } from "../files/connection";
import { standaloneHtml } from "../files/standalone";
import { ConnectionStore } from "../storage/connections";
import { loadSqlite } from "../sqlite/engine";
import { button, download, element, errorMessage, input, options, select } from "./library/ui";
import "./library/style.css";

const files = new FileTransport();
const connections = new ConnectionStore();

function bytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function mount(container: HTMLElement): () => void {
  let disposed = false;
  let busy = false;
  let request = 0;
  let viewerRequest = 0;
  let provider: LocalImagesProvider | undefined;
  let source: FileConnection | undefined;
  let savedConnection: FileSystemDirectoryHandle | undefined;
  let images: readonly ImageSummary[] = [];
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
    const root = source.root.handle;
    try {
      await connections.save(root);
      if (disposed) return;
      savedConnection = root;
      reconnect.hidden = forget.hidden = false;
      status.textContent = "Folder connection remembered. Original files stay on disk.";
    } catch (error) {
      if (!disposed) status.textContent = `Folder connected for this session, but its connection was not saved. ${errorMessage(error)}`;
    }
  }); });
  connect.disabled = true;
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
    if (isSharedFileDocument() || !window.showDirectoryPicker) { sessionPicker.click(); return; }
    void run(async () => {
      const root = await chooseDirectory();
      if (!disposed) await useSource({ name: root.name, root: { kind: "directory", handle: root } });
    });
  }, "primary-button");
  const sessionFallback = button("Open folder for this session", () => sessionPicker.click());
  sessionFallback.hidden = !window.showDirectoryPicker || isSharedFileDocument();
  const reload = button("Reload library", () => {
    if (source) void run(() => useSource(source!));
  });
  reload.disabled = true;
  actions.append(openSession, connect, sessionFallback, reload, sessionPicker);
  header.append(heading, actions);
  const connection = element("section", "local-images-connection");
  const connectionText = element("div");
  const mode = element("span", "local-images-mode", "NOT CONNECTED");
  const connectionName = element("strong", "", "No library connected");
  const description = element("p", "library-hint", "Connect the image library root containing images/ and states/db. Session connections need folder selection again after reopening.");
  connectionText.append(mode, connectionName, description);
  const connectionActions = element("div", "library-actions");
  const reconnect = button("Reconnect saved folder", () => { void run(async () => {
    const root = savedConnection;
    if (!root) return;
    if (!await requestReadAccess(root)) throw new Error("Read access was not granted. You can reconnect later.");
    if (!disposed) await useSource({ name: root.name, root: { kind: "directory", handle: root } });
  }); });
  const forget = button("Forget folder", () => { void run(async () => {
    await connections.forget();
    savedConnection = undefined;
    reconnect.hidden = forget.hidden = true;
    clearLibrary();
    status.textContent = "Folder connection forgotten. Original files were not changed.";
  }); });
  reconnect.hidden = forget.hidden = true;
  connectionActions.append(reconnect, forget);
  connection.append(connectionText, connectionActions);
  const status = element("p", "library-status");
  status.setAttribute("role", "status");
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
  const locationNotice = element("section", "library-import");
  locationNotice.hidden = !isSharedFileDocument();
  locationNotice.append(element("p", "library-description", "Mosaic was opened from a network location. Save this HTML to a Windows drive and open that copy to enable remembered folder connections. Your image library folder can stay where it is."),
    button("Save a local HTML copy", () => download(standaloneHtml(), "mosaic.html")));
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
  page.append(header, locationNotice, connection, importPanel, filters, tags, status, grid, hint, dialog);
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
    images = [];
    selectedTags.clear();
    tags.replaceChildren();
    grid.replaceChildren(element("p", "library-empty", "Connect the image library folder containing images/ and states/db."));
    mode.textContent = "NOT CONNECTED";
    connectionName.textContent = "No library connected";
    description.textContent = "Connect the image library root containing images/ and states/db. Session connections need folder selection again after reopening.";
    count.textContent = "";
    reload.disabled = true;
    connect.disabled = true;
    importPanel.hidden = true;
  }

  async function useSource(next: FileConnection): Promise<void> {
    const sqlite = await loadSqlite();
    if (disposed) return;
    const candidate = new LocalImagesProvider(files, sqlite);
    try { await candidate.connect(next.root); }
    catch (error) { candidate.close(); throw error; }
    if (disposed) { candidate.close(); return; }
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
    search.value = "";
    options(subjects, [["", "All subjects"]]);
    options(sources, [["", "All sources"]]);
    await refresh();
    reload.disabled = false;
    connect.disabled = isSession;
    connect.title = isSession ? "This selection has no reusable folder handle and cannot be remembered without copying files." : "Remember the connected folder without selecting it again.";
    if (!disposed) status.textContent = "Library connected.";
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
    if (!image || !current || disposed) return;
    const token = ++viewerRequest;
    activeIndex = index;
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
      images = result.standaloneImages;
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
    busy = true;
    const controls = [connect, openSession, sessionFallback, reload, reconnect, forget, addImages, importSubject, importSource, importFiles];
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
    try {
      savedConnection = await connections.load();
      if (disposed) return;
      if (savedConnection) {
        reconnect.hidden = forget.hidden = false;
        if (await hasReadAccess(savedConnection)) {
          await useSource({ name: savedConnection.name, root: { kind: "directory", handle: savedConnection } });
          return;
        }
        connectionName.textContent = savedConnection.name;
        status.textContent = "Saved folder found. Reconnect it to approve read access.";
        return;
      }
      status.textContent = "Connect an image folder to open your library.";
    } catch (error) {
      if (!disposed) status.textContent = `Could not restore the folder connection. ${errorMessage(error)}`;
    }
  }

  clearLibrary();
  void run(restore);
  return () => {
    disposed = true;
    request += 1;
    viewerRequest += 1;
    dialog.close();
    releaseThumbnails();
    provider?.close();
    if (viewerUrl) URL.revokeObjectURL(viewerUrl);
  };
}

export default { title: "Local Images", category: "Images", icon: "images", mount } satisfies View;
