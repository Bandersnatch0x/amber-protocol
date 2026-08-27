const LRU_CAP = 200;

class KnowledgeLRUCache {
  private readonly map = new Map<string, string>();
  private readonly inflight = new Map<string, Promise<string>>();

  get(key: string): string | undefined {
    if (!this.map.has(key)) return undefined;
    const val = this.map.get(key)!;
    // Re-insert at end to mark as most-recently-used
    this.map.delete(key);
    this.map.set(key, val);
    return val;
  }

  set(key: string, value: string): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= LRU_CAP) {
      // Evict the least-recently-used entry (first key in insertion-order Map)
      const lruKey = this.map.keys().next().value!;
      this.map.delete(lruKey);
    }
    this.map.set(key, value);
  }

  /** Returns a promise that resolves to the cached value or fires fetcher exactly once. */
  async getOrFetch(key: string, fetcher: () => Promise<string>): Promise<string> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;

    const pending = this.inflight.get(key);
    if (pending) return pending;

    const promise = fetcher().then(
      (result) => {
        this.inflight.delete(key);
        this.set(key, result);
        return result;
      },
      (err: unknown) => {
        this.inflight.delete(key);
        throw err;
      },
    );

    this.inflight.set(key, promise);
    return promise;
  }

  get size(): number {
    return this.map.size;
  }

  get inflightSize(): number {
    return this.inflight.size;
  }
}

export const llmCache = new KnowledgeLRUCache();
export { KnowledgeLRUCache };
