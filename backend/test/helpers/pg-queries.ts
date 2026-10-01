import pg from 'pg';
import { vi } from 'vitest';

// Observe actual driver calls: Node emits this deprecation only once per process.
// Counting unsettled queries also detects recurrence after an earlier warning.
export async function observeClientQueries<T>(work: () => Promise<T>) {
  // The adapter uses pg's promise overload, rather than its callback overload.
  const clientQueries: {
    query: (
      this: pg.Client,
      config: string | pg.QueryConfig,
      values?: unknown[],
    ) => Promise<unknown>;
  } = pg.Client.prototype;
  // apply below explicitly restores the original client's receiver.
  // oxlint-disable-next-line typescript/unbound-method
  const original = clientQueries.query;
  const pending = new Map<pg.Client, number>();
  const queries: string[] = [];
  let overlaps = 0;
  const spy = vi.spyOn(clientQueries, 'query').mockImplementation(function (
    this: pg.Client,
    ...args
  ) {
    // pg.Pool delegates via a callback and manages its own checkout/release.
    // Observe the promise calls used by transaction clients without altering it.
    if (args.some((arg) => typeof arg === 'function'))
      return original.apply(this, args);
    const active = pending.get(this) ?? 0;
    if (active > 0) overlaps++;
    pending.set(this, active + 1);
    const config = args[0];
    queries.push(typeof config === 'string' ? config : config.text);
    const result = original.apply(this, args);
    const settled = () => pending.set(this, (pending.get(this) ?? 1) - 1);
    void result.then(settled, settled);
    return result;
  });
  try {
    const value = await work();
    return { value, queries, overlaps };
  } finally {
    spy.mockRestore();
  }
}
