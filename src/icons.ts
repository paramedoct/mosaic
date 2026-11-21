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
  MapPin,
  Maximize2,
  Plus,
  RefreshCw,
  Save,
  SatelliteDish,
  Search,
  Settings,
  Sun,
  Tag,
  Trash2,
  X,
} from "lucide";

type IconDefinition = Parameters<typeof createElement>[0];

const uploadIcon: IconDefinition = [
  ["path", { d: "M12 16V4" }],
  ["path", { d: "m7 9 5-5 5 5" }],
  ["path", { d: "M4 15v5h16v-5" }],
];

const icons = {
  add: Plus,
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
  source: MapPin,
  tag: Tag,
  trash: Trash2,
  upload: uploadIcon,
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
