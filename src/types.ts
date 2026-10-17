export interface Provider<T> {
  fetch(): Promise<T>;
}

export interface Viewer<T> {
  render(data: T): void;
}
