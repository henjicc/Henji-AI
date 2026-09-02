import type { Gpu, Texture } from 'vgpu';

const UPLOAD_TEXTURE_USAGE = [
  'copy_dst',
  'texture_binding',
  'render_attachment',
] as const;

/**
 * 可被 effect 采样的外部图片上传纹理。
 *
 * vGPU 的 Texture.resize 会替换底层 GPUTexture，但保留资源 identity；已经缓存的
 * bind group 因此仍可能引用被销毁的旧纹理。上传尺寸变化时必须创建新的 Texture
 * wrapper，让 effect 看到新的 identity，并通过旧资源的 destroy 事件清理绑定缓存。
 */
export class VgpuUploadTexture {
  private current: Texture;
  private destroyed = false;

  constructor(
    private readonly gpu: Gpu,
    private readonly label: string,
  ) {
    this.current = this.create([1, 1]);
  }

  get texture(): Texture {
    if (this.destroyed) throw new Error(`${this.label} 已销毁`);
    return this.current;
  }

  ensureSize(size: readonly [number, number]): boolean {
    if (this.destroyed) throw new Error(`${this.label} 已销毁`);
    const normalized = normalizeSize(size);
    if (sameSize(this.current.size, normalized)) return false;

    const previous = this.current;
    this.current = this.create(normalized);
    previous.destroy();
    return true;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.current.destroy();
  }

  private create(size: readonly [number, number]): Texture {
    return this.gpu.device.createTexture({
      size,
      format: 'rgba8unorm',
      usage: UPLOAD_TEXTURE_USAGE,
      label: this.label,
    });
  }
}

function normalizeSize(size: readonly [number, number]): readonly [number, number] {
  return [Math.max(1, Math.floor(size[0])), Math.max(1, Math.floor(size[1]))];
}

function sameSize(
  current: readonly [number, number, number?],
  next: readonly [number, number],
): boolean {
  return current[0] === next[0] && current[1] === next[1];
}
