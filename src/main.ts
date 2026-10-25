import type { View } from "./types";
import { icon } from "./icons";
import "./style.css";

const views = import.meta.glob<View>("./views/*.ts", {
  eager: true,
  import: "default",
});

const app = document.querySelector<HTMLDivElement>("#app")!;
const catalog = document.createElement("nav");
catalog.className = "view-catalog";
catalog.setAttribute("aria-label", "Views");
const header = document.createElement("header");
header.className = "app-header";
const sidebar = document.createElement("aside");
sidebar.className = "app-sidebar";
const brand = document.createElement("div");
brand.className = "app-brand";
brand.setAttribute("role", "img");
brand.setAttribute("aria-label", "Mosaic");
brand.title = "Mosaic";
brand.append(icon("mosaic"));
sidebar.append(brand, catalog);
const workspace = document.createElement("div");
workspace.className = "app-workspace";
const tools = document.createElement("div");
tools.className = "view-tools";
header.append(tools);
const container = document.createElement("main");
let dispose: (() => void) | undefined;

for (const view of Object.values(views)) {
  const card = document.createElement("button");
  card.className = "view-card";
  card.setAttribute("aria-pressed", "false");
  const label = document.createElement("span");
  label.textContent = view.title;
  card.append(icon(view.icon ?? "mosaic"), label);
  card.setAttribute("aria-label", view.title);
  card.title = view.title;
  card.onclick = () => {
    dispose?.();
    for (const button of catalog.querySelectorAll("button")) {
      button.setAttribute("aria-pressed", String(button === card));
    }
    container.replaceChildren();
    tools.replaceChildren();
    dispose = view.mount(container, tools);
  };
  catalog.append(card);
}

workspace.append(header, container);
app.replaceChildren(sidebar, workspace);
catalog.querySelector("button")!.click();
