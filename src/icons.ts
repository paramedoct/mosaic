const paths = {
  refresh: "M20 7v5h-5 M20 12a8 8 0 1 0-2.3 5.7",
  now: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0 M12 6v6l4 2",
  previous: "m15 5-7 7 7 7",
  next: "m9 5 7 7-7 7",
  key: "M15 3a6 6 0 1 1-4.8 9.6L3 20v-4l6.6-6.6A6 6 0 0 1 15 3Z M17 7h.01",
  trash: "M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7",
  satellite: "m4 4 4-2 4 4-4 4Z m8 8 4-4 6 6-4 4Z M9 9l6 6 M5 13a6 6 0 0 1 6 6 M3 17a2 2 0 0 1 2 2",
} as const;

type IconName = keyof typeof paths;

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
