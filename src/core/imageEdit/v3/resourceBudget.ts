export const IMAGE_EDIT_DEFAULT_TOTAL_BUDGET_BYTES = 1_342_177_280;
export const IMAGE_EDIT_DEFAULT_CPU_CACHE_TARGET_BYTES = 536_870_912;
export const IMAGE_EDIT_DEFAULT_GPU_TARGET_BYTES = 335_544_320;

export type ImageEditMemoryCategory =
  | 'cpu-cache'
  | 'gpu'
  | 'transfer'
  | 'encode'
  | 'in-flight';

export interface ImageEditMemorySnapshot {
  totalBytes: number;
  byCategory: Readonly<Record<ImageEditMemoryCategory, number>>;
  leaseCount: number;
  deviceGeneration: number;
}

export interface ImageEditAdmissionResult {
  admitted: boolean;
  availableBytes: number;
  pressure: 'normal' | 'soft' | 'hard';
  recommendation?: 'evict-cache' | 'lower-mip' | 'reduce-concurrency';
}

export interface ImageEditMemoryLease {
  readonly id: string;
  readonly category: ImageEditMemoryCategory;
  readonly bytes: number;
  readonly deviceGeneration: number;
  release(): void;
}

export interface ImageEditResourceBudgetOptions {
  totalBytes?: number;
  cpuCacheTargetBytes?: number;
  gpuTargetBytes?: number;
}

const EMPTY_USAGE: Record<ImageEditMemoryCategory, number> = {
  'cpu-cache': 0,
  gpu: 0,
  transfer: 0,
  encode: 0,
  'in-flight': 0,
};

function normalizeBytes(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} 必须是非负整数`);
  return value;
}

export class ImageEditResourceBudget {
  private readonly totalBytes: number;
  private readonly cpuCacheTargetBytes: number;
  private readonly gpuTargetBytes: number;
  private readonly usage = { ...EMPTY_USAGE };
  private readonly leases = new Map<string, { category: ImageEditMemoryCategory; bytes: number }>();
  private leaseSequence = 0;
  private generation = 0;

  constructor(options: ImageEditResourceBudgetOptions = {}) {
    this.totalBytes = normalizeBytes(
      options.totalBytes ?? IMAGE_EDIT_DEFAULT_TOTAL_BUDGET_BYTES,
      '总资源预算',
    );
    this.cpuCacheTargetBytes = normalizeBytes(
      options.cpuCacheTargetBytes ?? IMAGE_EDIT_DEFAULT_CPU_CACHE_TARGET_BYTES,
      'CPU 缓存目标',
    );
    this.gpuTargetBytes = normalizeBytes(
      options.gpuTargetBytes ?? IMAGE_EDIT_DEFAULT_GPU_TARGET_BYTES,
      'GPU 目标',
    );
    if (this.cpuCacheTargetBytes + this.gpuTargetBytes > this.totalBytes) {
      throw new Error('CPU 与 GPU 目标不能超过总资源预算');
    }
  }

  admission(category: ImageEditMemoryCategory, bytes: number): ImageEditAdmissionResult {
    const requested = normalizeBytes(bytes, '申请字节数');
    const snapshot = this.snapshot();
    const availableBytes = Math.max(0, this.totalBytes - snapshot.totalBytes);
    if (requested > availableBytes) {
      return {
        admitted: false,
        availableBytes,
        pressure: 'hard',
        recommendation: category === 'cpu-cache' ? 'evict-cache' : 'lower-mip',
      };
    }
    const categoryNext = snapshot.byCategory[category] + requested;
    const exceedsSoftTarget = (category === 'cpu-cache' && categoryNext > this.cpuCacheTargetBytes)
      || (category === 'gpu' && categoryNext > this.gpuTargetBytes);
    return {
      admitted: true,
      availableBytes,
      pressure: exceedsSoftTarget ? 'soft' : 'normal',
      ...(exceedsSoftTarget
        ? { recommendation: category === 'cpu-cache' ? 'evict-cache' : 'reduce-concurrency' }
        : {}),
    };
  }

  acquire(category: ImageEditMemoryCategory, bytes: number): ImageEditMemoryLease | null {
    const result = this.admission(category, bytes);
    if (!result.admitted) return null;
    const id = `memory-${++this.leaseSequence}`;
    this.usage[category] += bytes;
    this.leases.set(id, { category, bytes });
    let released = false;
    return {
      id,
      category,
      bytes,
      deviceGeneration: this.generation,
      release: () => {
        if (released) return;
        released = true;
        const lease = this.leases.get(id);
        if (!lease) return;
        this.leases.delete(id);
        this.usage[lease.category] -= lease.bytes;
      },
    };
  }

  advanceDeviceGeneration(): number {
    this.generation += 1;
    return this.generation;
  }

  snapshot(): ImageEditMemorySnapshot {
    const byCategory = { ...this.usage };
    return {
      totalBytes: Object.values(byCategory).reduce((total, bytes) => total + bytes, 0),
      byCategory,
      leaseCount: this.leases.size,
      deviceGeneration: this.generation,
    };
  }
}
