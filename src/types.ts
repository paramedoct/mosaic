export interface Provider<T> {
  fetch(): Promise<T>;
}

export interface Viewer<T> {
  render(data: T): void;
}

export interface View {
  title: string;
  category: string;
  mount(container: HTMLElement): () => void;
}
