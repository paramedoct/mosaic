const paths = {
  mosaic: "M3 3h7v7H3Z M14 3h7v7h-7Z M3 14h7v7H3Z M14 14h7v7h-7Z",
  weather: "M7 14a4 4 0 1 1 5-6 M8 3V1 M3 5 1.5 3.5 M3 10H1 M15 5l1.5-1.5 M8 20h10a4 4 0 0 0 .5-8 5 5 0 0 0-9.5 1A3.5 3.5 0 0 0 8 20Z",
  refresh: "M20 7v5h-5 M20 12a8 8 0 1 0-2.3 5.7",
  lock: "M7 10V7a5 5 0 0 1 10 0v3 M6 10h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z M12 14v3",
  close: "m6 6 12 12 M18 6 6 18",
  trash: "M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7",
  satellite: "m4 4 4-2 4 4-4 4Z m8 8 4-4 6 6-4 4Z M9 9l6 6 M5 13a6 6 0 0 1 6 6 M3 17a2 2 0 0 1 2 2",
} as const;

export type IconName = keyof typeof paths;

export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.7");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(svg.namespaceURI, "path");
  path.setAttribute("d", paths[name]);
  svg.append(path);
  return svg;
}

export function setAction(element: HTMLElement, name: IconName, label: string): void {
  element.replaceChildren(icon(name));
  element.title = label;
  element.setAttribute("aria-label", label);
}
