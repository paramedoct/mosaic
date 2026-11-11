import type { View } from "../types";
import { LocalImagesProvider, type ImageSummary } from "../providers/localImages";
import { FileTransport } from "../transports/file";
import { chooseDirectory, type FileConnection } from "../files/connection";
import { loadSqlite } from "../sqlite/engine";
import { button, download, element, errorMessage, input, options, select } from "./library/ui";
import "./library/style.css";

const files = new FileTransport();

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
  let images: readonly ImageSummary[] = [];
  let activeId: string | undefined;
  let viewerUrl: string | undefined;
  const selectedTags = new Set<string>();
  const thumbnailUrls = new Set<string>();
  const page = element("section", "library-view local-images-view");
  const header = element("header", "library-header");
  const heading = element("div");
  heading.append(element("p", "library-eyebrow", "LOCAL IMAGE LIBRARY"), element("h1", "", "Local Images"),
    element("p", "library-description", "Explore your original images, right where they live."));
  const actions = element("div", "library-actions");
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
      const root = await chooseDirectory();
      if (!disposed) await useSource({ name: root.name, root: { kind: "directory", handle: root } });
    });
  }, "primary-button");
  const sessionFallback = button("Open folder for this session", () => sessionPicker.click());
  sessionFallback.hidden = !window.showDirectoryPicker;
  const reload = button("Reload library", () => {
    if (source) void run(() => useSource(source!));
  });
  reload.disabled = true;
  actions.append(openSession, sessionFallback, reload, sessionPicker);
  header.append(heading, actions);
  const connection = element("section", "local-images-connection");
  const connectionText = element("div");
  const mode = element("span", "local-images-mode", "NOT CONNECTED");
  const connectionName = element("strong", "", "No library connected");
  const description = element("p", "library-hint", "Connect the image library root containing images/ and states/db. Session connections need folder selection again after reopening.");
  connectionText.append(mode, connectionName, description);
  connection.append(connectionText);
  const status = element("p", "library-status");
  status.setAttribute("role", "status");
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
  const hint = element("p", "library-hint", "Read-only prototype · SQLite metadata is read in memory. Images are opened from their source only when displayed.");

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
  const path = element("code", "image-hash");
  const hash = element("code", "image-hash");
  const viewerStatus = element("p", "library-status");
  viewerStatus.setAttribute("role", "status");
  const exportImage = button("Download original", () => {
    const image = images.find(image => image.id === activeId);
    const current = provider;
    if (image && current) void run(async () => {
      const blob = await current.readImage(image.id);
      const extensions: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg" };
      if (!disposed) download(blob, `${image.sha256}.${extensions[image.mimeType] ?? "image"}`);
    });
  });
  info.append(classification, properties, imageTags, path, hash, exportImage, viewerStatus);
  viewerBody.append(stage, info);
  const navigation = element("footer", "image-navigation");
  const previous = button("← Previous", () => { void move(-1); });
  const position = element("span");
  const next = button("Next →", () => { void move(1); });
  const zoom = button("Actual size", () => {
    const actual = stage.classList.toggle("actual-size");
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
    activeId = undefined;
  });
  page.append(header, connection, filters, tags, status, grid, hint, dialog);
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
        : "Original image library folder connected. The database and images are read-only; image copies are not stored in the browser.";
    search.value = "";
    options(subjects, [["", "All subjects"]]);
    options(sources, [["", "All sources"]]);
    await refresh();
    reload.disabled = false;
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

  async function showImage(id: string): Promise<void> {
    const image = images.find(image => image.id === id);
    const current = provider;
    if (!image || !current || disposed) return;
    const token = ++viewerRequest;
    activeId = id;
    viewerTitle.textContent = image.subject;
    classification.textContent = `${image.subject} · ${image.source}`;
    properties.textContent = `${image.mimeType} · ${bytes(image.byteSize)} · ${new Date(image.createdAt).toLocaleDateString()}`;
    imageTags.replaceChildren(...image.tags.map(tag => element("span", "local-images-tag", tag)));
    path.textContent = image.path;
    hash.textContent = image.sha256;
    position.textContent = `${images.indexOf(image) + 1} / ${images.length}`;
    previous.disabled = images.indexOf(image) === 0;
    next.disabled = images.indexOf(image) === images.length - 1;
    stage.classList.remove("actual-size");
    zoom.textContent = "Actual size";
    if (viewerUrl) URL.revokeObjectURL(viewerUrl);
    viewerUrl = undefined;
    original.removeAttribute("src");
    original.alt = image.subject;
    viewerStatus.textContent = "Reading original image…";
    if (!dialog.open) dialog.showModal();
    try {
      const blob = await current.readImage(id);
      if (disposed || token !== viewerRequest || !dialog.open) return;
      viewerUrl = URL.createObjectURL(blob);
      original.src = viewerUrl;
      viewerStatus.textContent = "";
    } catch (error) { if (!disposed && token === viewerRequest) viewerStatus.textContent = errorMessage(error); }
  }

  async function move(delta: number): Promise<void> {
    const image = images[images.findIndex(image => image.id === activeId) + delta];
    if (image) await showImage(image.id);
  }

  async function refresh(): Promise<void> {
    const current = provider;
    if (!current || disposed) return;
    const token = ++request;
    try {
      const result = await current.fetch({ subject: subjects.value, source: sources.value, text: search.value,
        tags: [...selectedTags], order: order.value as "oldest" | "newest" });
      if (disposed || token !== request) return;
      images = result.images;
      options(subjects, [["", "All subjects"], ...result.subjects.map(value => [value, value] as [string, string])]);
      options(sources, [["", "All sources"], ...result.sources.map(value => [value, value] as [string, string])]);
      count.textContent = `${images.length} / ${result.total} images · ${bytes(result.byteSize)}`;
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
      grid.replaceChildren(...images.map(image => {
        const card = button("", () => { void showImage(image.id); }, "image-card");
        card.setAttribute("aria-label", `View ${image.subject}`);
        const thumbnail = element("img");
        thumbnail.alt = image.subject;
        thumbnail.loading = "lazy";
        thumbnail.dataset.id = image.id;
        thumbnail.onerror = () => { thumbnail.alt = "Image format could not be displayed"; };
        const tagLine = element("span", "image-tag-line", image.tags.join(" · "));
        card.append(thumbnail, element("strong", "", image.subject), element("small", "", image.source), tagLine);
        observer.observe(thumbnail);
        return card;
      }));
      if (!images.length) grid.append(element("p", "library-empty", result.total ? "No images match these filters." : "No images are registered in this library."));
    } catch (error) { if (!disposed && token === request) status.textContent = errorMessage(error); }
  }

  async function run(action: () => Promise<void>): Promise<void> {
    if (busy || disposed) return;
    busy = true;
    const controls = [openSession, sessionFallback, reload];
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
      }
    }
  }

  clearLibrary();
  status.textContent = "Connect an image folder to open your library.";
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
