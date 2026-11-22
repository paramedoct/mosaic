import type { ImageGroup, ImageSummary } from "../../providers/scry";
import { button, element } from "./ui";

const cardImageCacheLimit = 100;

export interface ImageGridEntry {
  image: ImageSummary;
  group?: ImageGroup;
  createdAt: string;
  id: number;
}

interface ImageGridOptions {
  open(entry: ImageGridEntry, standaloneImages: readonly ImageSummary[]): void;
}

export interface ImageGrid {
  element: HTMLDivElement;
  set(
    entries: readonly ImageGridEntry[], standaloneImages: readonly ImageSummary[],
    readImage: (id: string) => Promise<Blob>, emptyMessage: string,
  ): void;
  clear(): void;
  dispose(): void;
}

export function createImageGrid(options: ImageGridOptions): ImageGrid {
  const grid = element("div", "image-grid");
  grid.setAttribute("aria-label", "Image collection");
  const imageUrls = new Map<string, string>();
  const activeImages = new Map<string, Set<HTMLImageElement>>();
  const renderedCards = new Map<number, HTMLButtonElement>();
  let loadingImages = new Set<string>();
  let entries: readonly ImageGridEntry[] = [];
  let standaloneImages: readonly ImageSummary[] = [];
  let readImage: ((id: string) => Promise<Blob>) | undefined;
  let renderFrame: number | undefined;
  let renderKey = "";
  let version = 0;

  const observer = new IntersectionObserver(observations => {
    for (const observation of observations) {
      const image = observation.target as HTMLImageElement;
      if (observation.isIntersecting) activateImage(image, version);
      else deactivateImage(image);
    }
  }, { rootMargin: "150px" });

  function trimCache(): void {
    let inactive = [...imageUrls.keys()].filter(id => !activeImages.has(id)).length;
    for (const [id, url] of imageUrls) {
      if (inactive <= cardImageCacheLimit) break;
      if (activeImages.has(id)) continue;
      imageUrls.delete(id);
      URL.revokeObjectURL(url);
      inactive -= 1;
    }
  }

  function activateImage(image: HTMLImageElement, token: number): void {
    const id = image.dataset.id;
    if (!id) return;
    const active = activeImages.get(id) ?? new Set<HTMLImageElement>();
    active.add(image);
    activeImages.set(id, active);
    const cached = imageUrls.get(id);
    if (cached) {
      imageUrls.delete(id);
      imageUrls.set(id, cached);
      image.src = cached;
      return;
    }
    void loadImage(id, token);
  }

  function deactivateImage(image: HTMLImageElement): void {
    const id = image.dataset.id;
    if (!id) return;
    const active = activeImages.get(id);
    active?.delete(image);
    if (active && !active.size) activeImages.delete(id);
    if (image.hasAttribute("src")) image.removeAttribute("src");
    trimCache();
  }

  function releaseImages(): void {
    observer.disconnect();
    for (const url of imageUrls.values()) URL.revokeObjectURL(url);
    imageUrls.clear();
    activeImages.clear();
    loadingImages = new Set<string>();
    renderedCards.clear();
  }

  async function loadImage(id: string, token: number): Promise<void> {
    const currentRead = readImage;
    const loading = loadingImages;
    if (!currentRead || loading.has(id)) return;
    loading.add(id);
    try {
      const blob = await currentRead(id);
      if (token !== version) return;
      const url = URL.createObjectURL(blob);
      const previous = imageUrls.get(id);
      if (previous) URL.revokeObjectURL(previous);
      imageUrls.delete(id);
      imageUrls.set(id, url);
      for (const image of activeImages.get(id) ?? []) if (image.isConnected) image.src = url;
      trimCache();
    } catch {
      if (token === version) for (const image of activeImages.get(id) ?? []) {
        image.alt = "Original image unavailable";
        const card = image.closest("button");
        if (!card?.querySelector(".image-unavailable")) {
          card?.append(element("span", "library-hint image-unavailable", "Original unavailable"));
        }
      }
    } finally { loading.delete(id); }
  }

  function removeCard(index: number): void {
    const card = renderedCards.get(index);
    if (!card) return;
    const image = card.querySelector<HTMLImageElement>("img");
    if (image) {
      observer.unobserve(image);
      deactivateImage(image);
    }
    card.remove();
    renderedCards.delete(index);
  }

  function positionCard(card: HTMLButtonElement, index: number, size: number, gap: number, columns: number): void {
    const row = Math.floor(index / columns);
    const column = index % columns;
    card.style.insetInlineStart = `${column * (size + gap)}px`;
    card.style.top = `${row * (size + gap)}px`;
    card.style.width = `${size}px`;
    card.style.height = `${size}px`;
  }

  function createCard(entry: ImageGridEntry): HTMLButtonElement {
    const { image, group } = entry;
    const card = button("", () => options.open(entry, standaloneImages),
      group ? "image-card image-group-card" : "image-card");
    card.style.position = "absolute";
    const label = image.tags.join(", ") || image.source;
    card.setAttribute("aria-label", group ? `View ${label}, ${group.images.length} images` : `View ${label}`);
    const preview = element("img");
    preview.alt = label;
    preview.loading = "lazy";
    preview.dataset.id = image.id;
    preview.onerror = () => { preview.alt = "Image format could not be displayed"; };
    card.append(preview);
    if (group) {
      const badge = element("span", "image-group-count", String(group.images.length));
      badge.setAttribute("aria-hidden", "true");
      card.append(badge);
    }
    observer.observe(preview);
    return card;
  }

  function renderWindow(): void {
    renderFrame = undefined;
    if (!entries.length || !grid.isConnected) return;
    const style = getComputedStyle(grid);
    const minimum = Number.parseFloat(style.getPropertyValue("--image-card-min")) || 170;
    const gap = Number.parseFloat(style.getPropertyValue("--image-grid-gap")) || 8;
    const width = grid.clientWidth;
    if (!width) return;
    const columns = Math.max(1, Math.floor((width + gap) / (minimum + gap)));
    const size = (width - gap * (columns - 1)) / columns;
    const stride = size + gap;
    const rows = Math.ceil(entries.length / columns);
    const height = rows * size + Math.max(0, rows - 1) * gap;
    grid.style.height = `${height}px`;
    const bounds = grid.getBoundingClientRect();
    const visibleStart = Math.max(0, Math.min(height, -bounds.top));
    const visibleEnd = Math.max(visibleStart, Math.min(height, window.innerHeight - bounds.top));
    const startRow = Math.max(0, Math.floor(visibleStart / stride) - 2);
    const endRow = Math.min(rows, Math.max(startRow + 1, Math.ceil(visibleEnd / stride) + 2));
    const start = startRow * columns;
    const end = Math.min(entries.length, endRow * columns);
    const key = `${version}:${width}:${columns}:${start}:${end}`;
    if (key === renderKey) return;
    renderKey = key;
    for (const index of [...renderedCards.keys()]) if (index < start || index >= end) removeCard(index);
    const cards: HTMLButtonElement[] = [];
    for (let index = start; index < end; index++) {
      let card = renderedCards.get(index);
      if (!card) {
        card = createCard(entries[index]);
        renderedCards.set(index, card);
      }
      positionCard(card, index, size, gap, columns);
      cards.push(card);
    }
    grid.append(...cards);
  }

  function scheduleRender(): void {
    if (renderFrame !== undefined) return;
    renderFrame = requestAnimationFrame(renderWindow);
  }

  function clear(): void {
    version += 1;
    releaseImages();
    entries = [];
    standaloneImages = [];
    readImage = undefined;
    renderKey = "";
    grid.classList.remove("is-virtualized");
    grid.style.height = "";
    grid.replaceChildren();
  }

  const resizeObserver = new ResizeObserver(scheduleRender);
  resizeObserver.observe(grid);
  window.addEventListener("scroll", scheduleRender, { passive: true });

  return {
    element: grid,
    set(nextEntries, nextImages, nextReadImage, emptyMessage): void {
      clear();
      entries = nextEntries;
      standaloneImages = nextImages;
      readImage = nextReadImage;
      grid.classList.toggle("is-virtualized", Boolean(entries.length));
      if (entries.length) renderWindow();
      else grid.append(element("p", "library-empty", emptyMessage));
    },
    clear,
    dispose(): void {
      clear();
      resizeObserver.disconnect();
      window.removeEventListener("scroll", scheduleRender);
      if (renderFrame !== undefined) cancelAnimationFrame(renderFrame);
    },
  };
}
