/** Let the event loop flush UI / extension host work between CPU-heavy steps. */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}
