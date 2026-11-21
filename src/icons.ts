import {
  ArrowDownWideNarrow,
  ChevronLeft,
  ChevronRight,
  createElement,
  FileArchive,
  Grid2X2,
  Image,
  ImagePlus,
  KeyRound,
  Link,
  Maximize2,
  RefreshCw,
  Save,
  SatelliteDish,
  Search,
  Settings,
  Sun,
  Trash2,
  Upload,
  X,
} from "lucide";

type IconDefinition = Parameters<typeof createElement>[0];

const icons = {
  addImages: ImagePlus,
  archive: FileArchive,
  close: X,
  images: Image,
  library: Settings,
  link: Link,
  lock: KeyRound,
  maximize: Maximize2,
  mosaic: Grid2X2,
  next: ChevronRight,
  previous: ChevronLeft,
  refresh: RefreshCw,
  satellite: SatelliteDish,
  save: Save,
  search: Search,
  sort: ArrowDownWideNarrow,
  trash: Trash2,
  upload: Upload,
  weather: Sun,
} satisfies Record<string, IconDefinition>;

export type IconName = keyof typeof icons;

export function icon(name: IconName): SVGSVGElement {
  return createElement(icons[name], { "aria-hidden": "true" }) as SVGSVGElement;
}

export function setAction(element: HTMLElement, name: IconName, label: string): void {
  element.replaceChildren(icon(name));
  element.title = label;
  element.setAttribute("aria-label", label);
}
