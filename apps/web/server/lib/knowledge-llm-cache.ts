const LRU_CAP = 200;

class KnowledgeLRUCache<T = unknown> {
  private readonly map = new Map<string, T>();
  private readonly inflight = new Map<string, Promise<T>>();

  get(key: string): T | undefined {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key)!;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: string, value: T): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= LRU_CAP) {
      const lruKey = this.map.keys().next().value!;
      this.map.delete(lruKey);
    }
    this.map.set(key, value);
  }

  async getOrFetch(key: string, fetcher: () => Promise<T>): Promise<T> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;

    const pending = this.inflight.get(key);
    if (pending) return pending;
    if (this.inflight.size >= LRU_CAP) throw new Error('cache-capacity-exceeded');

    const promise = fetcher().then(
      (result) => {
        this.inflight.delete(key);
        this.set(key, result);
        return result;
      },
      (error: unknown) => {
        this.inflight.delete(key);
        throw error;
      },
    );

    this.inflight.set(key, promise);
    return promise;
  }

  clear(): void {
    this.map.clear();
    this.inflight.clear();
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
