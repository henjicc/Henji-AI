import { LeasedLruCache, type LeasedCacheValue } from './leasedLruCache';
import {
  ImageEditResourceBudget,
  type ImageEditMemoryCategory,
  type ImageEditMemoryLease,
} from './resourceBudget';

export type ImageEditRenderCacheTier =
  | 'source-proxy'
  | 'node-tile'
  | 'global-analysis'
  | 'viewport';

export interface ImageEditRenderCacheEntry<T> {
  value: T;
  bytes: number;
  category: Extract<ImageEditMemoryCategory, 'cpu-cache' | 'gpu'>;
  deviceGeneration: number;
  dispose?: (value: T) => void;
}

interface BudgetedCacheEntry<T> extends ImageEditRenderCacheEntry<T> {
  budgetLease: ImageEditMemoryLease;
}

export interface ImageEditRenderCacheLease<T> {
  readonly value: T;
  readonly bytes: number;
  readonly deviceGeneration: number;
  release(): void;
}

export interface ImageEditRenderCachesOptions {
  budget: ImageEditResourceBudget;
  tierBudgets: Readonly<Record<ImageEditRenderCacheTier, number>>;
}

export class ImageEditRenderCaches<T = unknown> {
  private readonly caches: Record<ImageEditRenderCacheTier, LeasedLruCache<BudgetedCacheEntry<T>>>;
  private readonly budget: ImageEditResourceBudget;

  constructor(options: ImageEditRenderCachesOptions) {
    this.budget = options.budget;
    const create = (tier: ImageEditRenderCacheTier) => new LeasedLruCache<BudgetedCacheEntry<T>>({
      maxBytes: options.tierBudgets[tier],
      dispose: (entry) => {
        entry.dispose?.(entry.value);
        entry.budgetLease.release();
      },
    });
    this.caches = {
      'source-proxy': create('source-proxy'),
      'node-tile': create('node-tile'),
      'global-analysis': create('global-analysis'),
      viewport: create('viewport'),
    };
  }

  set(tier: ImageEditRenderCacheTier, key: string, entry: ImageEditRenderCacheEntry<T>): boolean {
    const lease = this.budget.acquire(entry.category, entry.bytes);
    if (!lease) return false;
    const cached = this.caches[tier].set(key, { ...entry, budgetLease: lease }, entry.bytes);
    if (!cached) lease.release();
    return cached;
  }

  lease(tier: ImageEditRenderCacheTier, key: string): ImageEditRenderCacheLease<T> | null {
    const leased: LeasedCacheValue<BudgetedCacheEntry<T>> | null = this.caches[tier].lease(key);
    if (!leased) return null;
    return {
      value: leased.value.value,
      bytes: leased.value.bytes,
      deviceGeneration: leased.value.deviceGeneration,
      release: leased.release,
    };
  }

  delete(tier: ImageEditRenderCacheTier, key: string): void {
    this.caches[tier].delete(key);
  }

  clearTier(tier: ImageEditRenderCacheTier): void {
    this.caches[tier].clear();
  }

  clearGpuResources(): void {
    for (const cache of Object.values(this.caches)) {
      cache.deleteWhere((entry) => entry.category === 'gpu');
    }
  }

  snapshot(): Record<ImageEditRenderCacheTier, ReturnType<LeasedLruCache<T>['snapshot']>> {
    return {
      'source-proxy': this.caches['source-proxy'].snapshot(),
      'node-tile': this.caches['node-tile'].snapshot(),
      'global-analysis': this.caches['global-analysis'].snapshot(),
      viewport: this.caches.viewport.snapshot(),
    };
  }
}
