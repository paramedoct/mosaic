export function standaloneHtml(): Blob {
  const html = document.documentElement.cloneNode(true) as HTMLElement;
  html.querySelector("#app")?.replaceChildren();
  return new Blob(["<!doctype html>\n", html.outerHTML], { type: "text/html;charset=utf-8" });
}
