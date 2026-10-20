import type { View } from "./types";
import "./style.css";

const views = import.meta.glob<View>("./views/*.ts", {
  eager: true,
  import: "default",
});

const app = document.querySelector<HTMLDivElement>("#app")!;
const catalog = document.createElement("nav");
catalog.className = "view-catalog";
catalog.setAttribute("aria-label", "Data cards");
const container = document.createElement("main");
let dispose: (() => void) | undefined;

for (const view of Object.values(views)) {
  const card = document.createElement("button");
  card.className = "view-card";
  card.setAttribute("aria-pressed", "false");
  card.textContent = view.title;
  card.title = view.category;
  card.onclick = () => {
    dispose?.();
    for (const button of catalog.querySelectorAll("button")) {
      button.setAttribute("aria-pressed", String(button === card));
    }
    container.replaceChildren();
    dispose = view.mount(container);
  };
  catalog.append(card);
}

app.replaceChildren(catalog, container);
catalog.querySelector("button")!.click();
