export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K, className = "", text = "",
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

export function button(text: string, action: () => void, className = ""): HTMLButtonElement {
  const node = element("button", className, text);
  node.type = "button";
  node.onclick = action;
  return node;
}

export function input(label: string, type = "text"): HTMLInputElement {
  const node = element("input");
  node.type = type;
  node.placeholder = label;
  node.setAttribute("aria-label", label);
  return node;
}

export function select(label: string): HTMLSelectElement {
  const node = element("select");
  node.setAttribute("aria-label", label);
  return node;
}

export function options(node: HTMLSelectElement, values: readonly [string, string][]): void {
  const selected = node.value;
  node.replaceChildren(...values.map(([value, label]) => {
    const option = element("option", "", label);
    option.value = value;
    return option;
  }));
  if (values.some(([value]) => value === selected)) node.value = selected;
}

export function downloadHtml(): void {
  const html = document.documentElement.cloneNode(true) as HTMLElement;
  html.querySelector("#app")?.replaceChildren();
  const blob = new Blob(["<!doctype html>\n", html.outerHTML], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = element("a");
  link.href = url;
  link.download = "mosaic.html";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The operation failed.";
}
