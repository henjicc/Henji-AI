import type {
  GpuDevice,
  GpuTexture,
} from '../worker/webgpuRuntimeSupport';

export interface ImageEditTextureDescriptor {
  width: number;
  height: number;
  format: 'rgba16float' | 'rgba8unorm';
  usage: number;
}

interface PooledTexture {
  texture: GpuTexture;
  descriptor: ImageEditTextureDescriptor;
  byteSize: number;
  inUse: boolean;
  lastUsed: number;
}

const BYTES_PER_PIXEL: Record<ImageEditTextureDescriptor['format'], number> = {
  rgba16float: 8,
  rgba8unorm: 4,
};

export class ImageEditTexturePool {
  private readonly entries: PooledTexture[] = [];
  private tick = 0;

  constructor(
    private readonly device: GpuDevice,
    private readonly budgetBytes = 256 * 1024 * 1024
  ) {}

  acquire(descriptor: ImageEditTextureDescriptor): GpuTexture {
    const entry = this.entries.find((candidate) =>
      !candidate.inUse && descriptorsEqual(candidate.descriptor, descriptor)
    );
    if (entry) {
      entry.inUse = true;
      entry.lastUsed = ++this.tick;
      return entry.texture;
    }
    const texture = this.device.createTexture({
      size: [descriptor.width, descriptor.height],
      format: descriptor.format,
      usage: descriptor.usage,
    });
    this.entries.push({
      texture,
      descriptor,
      byteSize: descriptor.width * descriptor.height * BYTES_PER_PIXEL[descriptor.format],
      inUse: true,
      lastUsed: ++this.tick,
    });
    this.trim();
    return texture;
  }

  release(texture: GpuTexture): void {
    const entry = this.entries.find((candidate) => candidate.texture === texture);
    if (!entry) {
      texture.destroy();
      return;
    }
    entry.inUse = false;
    entry.lastUsed = ++this.tick;
    this.trim();
  }

  destroy(): void {
    for (const entry of this.entries) entry.texture.destroy();
    this.entries.length = 0;
  }

  getAllocatedBytes(): number {
    return this.entries.reduce((total, entry) => total + entry.byteSize, 0);
  }

  private trim(): void {
    let allocated = this.getAllocatedBytes();
    if (allocated <= this.budgetBytes) return;
    const releasable = this.entries
      .filter((entry) => !entry.inUse)
      .sort((left, right) => left.lastUsed - right.lastUsed);
    for (const entry of releasable) {
      if (allocated <= this.budgetBytes) break;
      entry.texture.destroy();
      const index = this.entries.indexOf(entry);
      if (index >= 0) this.entries.splice(index, 1);
      allocated -= entry.byteSize;
    }
  }
}

function descriptorsEqual(
  left: ImageEditTextureDescriptor,
  right: ImageEditTextureDescriptor
): boolean {
  return left.width === right.width
    && left.height === right.height
    && left.format === right.format
    && left.usage === right.usage;
}
