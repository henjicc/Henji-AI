const GIBIBYTE = 1024 * 1024 * 1024;

/**
 * 机器内存系数：基准值是早年按小内存机器定的，按物理内存每 16 GiB 放大一倍，夹在 1–8 倍
 * （64 GiB 机器为 4 倍）。渲染层拿到真实物理内存前，以及 Worker、主进程等拿不到的环境，
 * 退回 navigator.deviceMemory：浏览器把它封顶在 8，因此 8 GiB 及以上都按 4 倍估算。
 */
const deviceMemoryScale = Math.max(1, Math.min(8,
  (globalThis as { navigator?: { deviceMemory?: number } }).navigator?.deviceMemory ?? 8) / 2);
let memoryScale = deviceMemoryScale;

export function imageEditMemoryScale(): number {
  return memoryScale;
}

/** 渲染层读到物理内存后调用；此后新建的缓存与账本按真实内存取目标值。 */
export function setImageEditSystemMemoryBytes(totalBytes: number): void {
  if (!(totalBytes > 0)) return;
  memoryScale = Math.max(1, Math.min(8, totalBytes / (16 * GIBIBYTE)));
}

/** 把基准缓存字节数按机器内存放大；结果只作淘汰目标，不作拒绝门槛。 */
export function scaleImageEditCacheBytes(baseBytes: number): number {
  return Math.round(baseBytes * memoryScale);
}

export function imageEditDefaultBudgetBytes(): Required<ImageEditResourceBudgetOptions> {
  return {
    totalBytes: scaleImageEditCacheBytes(1_342_177_280),
    cpuCacheTargetBytes: scaleImageEditCacheBytes(536_870_912),
    gpuTargetBytes: scaleImageEditCacheBytes(335_544_320),
  };
}

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

/**
 * 预算压力只用来决定淘汰缓存和降预览画质：'hard' 表示申请后会超过总账，
 * 'soft' 表示超过该类别的缓存目标。申请本身永远放行。
 */
export interface ImageEditAdmissionResult {
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
  private readonly options: ImageEditResourceBudgetOptions;
  private readonly usage = { ...EMPTY_USAGE };
  private readonly leases = new Map<string, { category: ImageEditMemoryCategory; bytes: number }>();
  private leaseSequence = 0;
  private generation = 0;

  /** 省略的目标值随机器内存系数取值，物理内存晚于账本到达时也会生效。 */
  constructor(options: ImageEditResourceBudgetOptions = {}) {
    this.options = { ...options };
    const limits = this.limits();
    normalizeBytes(limits.totalBytes, '总资源预算');
    normalizeBytes(limits.cpuCacheTargetBytes, 'CPU 缓存目标');
    normalizeBytes(limits.gpuTargetBytes, 'GPU 目标');
    if (limits.cpuCacheTargetBytes + limits.gpuTargetBytes > limits.totalBytes) {
      throw new Error('CPU 与 GPU 目标不能超过总资源预算');
    }
  }

  limits(): Required<ImageEditResourceBudgetOptions> {
    return { ...imageEditDefaultBudgetBytes(), ...this.options };
  }

  admission(category: ImageEditMemoryCategory, bytes: number): ImageEditAdmissionResult {
    const requested = normalizeBytes(bytes, '申请字节数');
    const snapshot = this.snapshot();
    const limits = this.limits();
    const availableBytes = Math.max(0, limits.totalBytes - snapshot.totalBytes);
    if (requested > availableBytes) {
      return {
        availableBytes,
        pressure: 'hard',
        recommendation: category === 'cpu-cache' ? 'evict-cache' : 'lower-mip',
      };
    }
    const categoryNext = snapshot.byCategory[category] + requested;
    const exceedsSoftTarget = (category === 'cpu-cache' && categoryNext > limits.cpuCacheTargetBytes)
      || (category === 'gpu' && categoryNext > limits.gpuTargetBytes);
    return {
      availableBytes,
      pressure: exceedsSoftTarget ? 'soft' : 'normal',
      ...(exceedsSoftTarget
        ? { recommendation: category === 'cpu-cache' ? 'evict-cache' : 'reduce-concurrency' }
        : {}),
    };
  }

  /** 只记账，不拒绝：调用方应先按 admission 的压力淘汰自己的缓存，淘汰完仍超出也照样分配。 */
  acquire(category: ImageEditMemoryCategory, bytes: number): ImageEditMemoryLease {
    normalizeBytes(bytes, '申请字节数');
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
