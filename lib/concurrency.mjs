export function createAsyncMutex() {
  let chain = Promise.resolve();
  return (fn) => {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };
}

/** Serialize async work per key. Different keys may run in parallel. */
export function createKeyedAsyncMutex() {
  const locks = new Map();
  return (key, fn) => {
    const normalized = String(key || "");
    let mutex = locks.get(normalized);
    if (!mutex) {
      mutex = createAsyncMutex();
      locks.set(normalized, mutex);
    }
    return mutex(fn);
  };
}

export async function mapWithConcurrency(items, concurrency, worker, { signal } = {}) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];
  const limit = Math.max(1, Math.min(Number(concurrency) || 1, list.length));
  const results = new Array(list.length);
  let nextIndex = 0;
  async function runner() {
    while (true) {
      if (signal?.aborted) return;
      const index = nextIndex;
      if (index >= list.length) return;
      nextIndex += 1;
      results[index] = await worker(list[index], index);
    }
  }
  await Promise.all(Array.from({ length: limit }, () => runner()));
  return results;
}
