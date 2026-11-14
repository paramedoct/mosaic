export function waitFor<T>(pending: Promise<T>, message: string, timeout: number,
  signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancel = () => finish(() => reject(new DOMException("Connection cancelled.", "AbortError")));
    const timer = setTimeout(() => finish(() => reject(new Error(message))), timeout);
    function finish(action: () => void): void {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      action();
    }
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    pending.then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
  });
}
