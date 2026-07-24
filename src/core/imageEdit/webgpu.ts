import { DIFFUSION_SHADER_SOURCE, DIFFUSION_SHADER_VERSION } from './shaders';

export interface ImageEditWebGpuCapabilities {
  available: boolean;
  adapterName: string | null;
  backend: string | null;
  features: string[];
  limits: Record<string, number>;
  shaderVersion: string;
  reason?: string;
}

interface GpuAdapterLike {
  info?: { device?: string; description?: string; vendor?: string; architecture?: string };
  features?: Iterable<string>;
  limits?: Record<string, number>;
  requestDevice: (descriptor?: unknown) => Promise<unknown>;
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
      features: [],
      limits: {},
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
        features: [],
        limits: {},
        shaderVersion: DIFFUSION_SHADER_VERSION,
        reason: '未找到可用 GPU adapter',
      };
    }
    // 创建一次设备确认 adapter 可用于计算/渲染；设备由调用方自行管理。
    await adapter.requestDevice();
    const info = adapter.info ?? {};
    return {
      available: true,
      adapterName: info.description || info.device || info.vendor || null,
      backend: info.architecture || null,
      features: adapter.features ? [...adapter.features] : [],
      limits: adapter.limits ? { ...adapter.limits } : {},
      shaderVersion: DIFFUSION_SHADER_VERSION,
    };
  } catch (error) {
    return {
      available: false,
      adapterName: null,
      backend: null,
      features: [],
      limits: {},
      shaderVersion: DIFFUSION_SHADER_VERSION,
      reason: error instanceof Error ? error.message : String(error),
    };
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
