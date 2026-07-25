import { DIFFUSION_SHADER_SOURCE, DIFFUSION_SHADER_VERSION } from './shaders';
import { collectRelevantGpuLimits } from './worker/webgpuCapabilities';

export interface ImageEditWebGpuCapabilities {
  available: boolean;
  adapterName: string | null;
  backend: string | null;
  isFallbackAdapter: boolean | null;
  features: string[];
  limits: Record<string, number>;
  rgba16Float: {
    renderable: boolean;
    sampleable: boolean;
  };
  shaderVersion: string;
  reason?: string;
}

interface GpuAdapterLike {
  info?: { device?: string; description?: string; vendor?: string; architecture?: string };
  isFallbackAdapter?: boolean;
  features?: Iterable<string>;
  limits?: Record<string, number>;
  requestDevice: (descriptor?: unknown) => Promise<GpuDeviceLike>;
}

interface GpuDeviceLike {
  createTexture: (descriptor: unknown) => { destroy?: () => void };
  pushErrorScope?: (filter: string) => void;
  popErrorScope?: () => Promise<{ message?: string } | null>;
  destroy?: () => void;
}

interface GpuLike {
  requestAdapter: (options?: unknown) => Promise<GpuAdapterLike | null>;
}

function getGpu(): GpuLike | null {
  if (typeof navigator === 'undefined') return null;
  const candidate = (navigator as Navigator & { gpu?: GpuLike }).gpu;
  return candidate ?? null;
}

export async function probeImageEditWebGpu(): Promise<ImageEditWebGpuCapabilities> {
  const gpu = getGpu();
  if (!gpu) {
    return {
      available: false,
      adapterName: null,
      backend: null,
      isFallbackAdapter: null,
      features: [],
      limits: {},
      rgba16Float: { renderable: false, sampleable: false },
      shaderVersion: DIFFUSION_SHADER_VERSION,
      reason: '当前 Renderer 未暴露 navigator.gpu',
    };
  }

  try {
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) {
      return {
        available: false,
        adapterName: null,
        backend: null,
        isFallbackAdapter: null,
        features: [],
        limits: {},
        rgba16Float: { renderable: false, sampleable: false },
        shaderVersion: DIFFUSION_SHADER_VERSION,
        reason: '未找到可用 GPU adapter',
      };
    }
    const device = await adapter.requestDevice();
    const rgba16Float = await probeRgba16Float(device);
    const info = adapter.info ?? {};
    device.destroy?.();
    return {
      available: true,
      adapterName: info.description || info.device || info.vendor || null,
      backend: info.architecture || null,
      isFallbackAdapter: adapter.isFallbackAdapter ?? null,
      features: adapter.features ? [...adapter.features] : [],
      limits: collectRelevantGpuLimits(adapter.limits),
      rgba16Float,
      shaderVersion: DIFFUSION_SHADER_VERSION,
    };
  } catch (error) {
    return {
      available: false,
      adapterName: null,
      backend: null,
      isFallbackAdapter: null,
      features: [],
      limits: {},
      rgba16Float: { renderable: false, sampleable: false },
      shaderVersion: DIFFUSION_SHADER_VERSION,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function probeRgba16Float(
  device: GpuDeviceLike
): Promise<ImageEditWebGpuCapabilities['rgba16Float']> {
  device.pushErrorScope?.('validation');
  let texture: { destroy?: () => void } | null = null;
  try {
    texture = device.createTexture({
      size: [1, 1],
      format: 'rgba16float',
      usage: 0x04 | 0x10,
    });
    const validationError = await device.popErrorScope?.();
    const valid = !validationError;
    return { renderable: valid, sampleable: valid };
  } catch {
    if (device.popErrorScope) await device.popErrorScope();
    return { renderable: false, sampleable: false };
  } finally {
    texture?.destroy?.();
  }
}

/**
 * 在运行时创建 ShaderModule 前做最小一致性检查，避免 Renderer 静默使用旧 Shader。
 */
export function assertDiffusionShaderSource(): void {
  if (!DIFFUSION_SHADER_SOURCE.includes('@fragment') || !DIFFUSION_SHADER_SOURCE.includes('fragment_main')) {
    throw new Error('共享柔光 WGSL 内容不完整');
  }
}
