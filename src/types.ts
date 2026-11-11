import type { IconName } from "./icons";

export interface Provider<Query, Result> {
  fetch(query: Query): Promise<Result>;
}

export interface Viewer<T> {
  render(data: T): void;
}

export interface View {
  title: string;
  category: string;
  icon?: IconName;
  mount(container: HTMLElement, tools: HTMLElement): () => void;
}
