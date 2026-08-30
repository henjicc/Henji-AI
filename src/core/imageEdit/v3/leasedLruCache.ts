export interface LeasedCacheValue<T> {
  readonly value: T;
  release(): void;
}

export interface LeasedLruCacheOptions<T> {
  maxBytes: number;
  dispose?: (value: T) => void;
}

interface CacheEntry<T> {
  value: T;
  bytes: number;
  leases: number;
  touchedAt: number;
  evictWhenReleased: boolean;
}

function normalizeCacheBytes(bytes: number): number {
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('缓存字节数必须是非负整数');
  return bytes;
}

export class LeasedLruCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly maxBytes: number;
  private readonly dispose?: (value: T) => void;
  private sequence = 0;
  private usedBytes = 0;

  constructor(options: LeasedLruCacheOptions<T>) {
    this.maxBytes = normalizeCacheBytes(options.maxBytes);
    this.dispose = options.dispose;
  }

  set(key: string, value: T, bytes: number): boolean {
    const normalizedBytes = normalizeCacheBytes(bytes);
    if (normalizedBytes > this.maxBytes) return false;
    const existing = this.entries.get(key);
    if (existing?.leases) {
      // 同一缓存键代表同一不可变结果。旧值仍被消费者租用时不能覆盖 Map 槽位，
      // 否则旧 lease 释放时将失去可定位的 entry，资源和预算都会永久泄漏。
      existing.evictWhenReleased = true;
      return false;
    }
    if (existing) this.removeEntry(key, existing);
    this.entries.set(key, {
      value,
      bytes: normalizedBytes,
      leases: 0,
      touchedAt: ++this.sequence,
      evictWhenReleased: false,
    });
    this.usedBytes += normalizedBytes;
    this.evictToBudget();
    return this.entries.has(key);
  }

  lease(key: string): LeasedCacheValue<T> | null {
    const entry = this.entries.get(key);
    if (!entry || entry.evictWhenReleased) return null;
    entry.leases += 1;
    entry.touchedAt = ++this.sequence;
    let released = false;
    return {
      value: entry.value,
      release: () => {
        if (released) return;
        released = true;
        entry.leases -= 1;
        if (entry.leases === 0 && entry.evictWhenReleased) this.removeEntry(key, entry);
      },
    };
  }

  delete(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    if (entry.leases > 0) {
      entry.evictWhenReleased = true;
      return;
    }
    this.removeEntry(key, entry);
  }

  clear(): void {
    for (const [key, entry] of this.entries) {
      if (entry.leases > 0) entry.evictWhenReleased = true;
      else this.removeEntry(key, entry);
    }
  }

  deleteWhere(predicate: (value: T, key: string) => boolean): void {
    for (const [key, entry] of this.entries) {
      if (predicate(entry.value, key)) this.delete(key);
    }
  }

  snapshot(): { usedBytes: number; entryCount: number; leasedCount: number } {
    let leasedCount = 0;
    for (const entry of this.entries.values()) if (entry.leases > 0) leasedCount += 1;
    return { usedBytes: this.usedBytes, entryCount: this.entries.size, leasedCount };
  }

  private evictToBudget(): void {
    while (this.usedBytes > this.maxBytes) {
      let candidate: [string, CacheEntry<T>] | null = null;
      for (const pair of this.entries) {
        const entry = pair[1];
        if (entry.leases > 0 || entry.evictWhenReleased) continue;
        if (!candidate || entry.touchedAt < candidate[1].touchedAt) candidate = pair;
      }
      if (!candidate) return;
      this.removeEntry(candidate[0], candidate[1]);
    }
  }

  private removeEntry(key: string, entry: CacheEntry<T>): void {
    if (this.entries.get(key) !== entry) return;
    this.entries.delete(key);
    this.usedBytes -= entry.bytes;
    this.dispose?.(entry.value);
  }
}
