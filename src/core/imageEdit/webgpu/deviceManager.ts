import {
  getGpuProvider,
  type GpuAdapter,
  type GpuDevice,
  type GpuProvider,
  type GpuRenderPipeline,
} from '../worker/webgpuRuntimeSupport';

export interface ManagedWebGpuDevice {
  provider: GpuProvider;
  adapter: GpuAdapter;
  device: GpuDevice;
  generation: number;
}

export class ImageEditWebGpuDeviceManager {
  private managed: ManagedWebGpuDevice | null = null;
  private generation = 0;
  private lostHandler: ((reason: string) => void) | null = null;

  onDeviceLost(handler: (reason: string) => void): void {
    this.lostHandler = handler;
  }

  async acquire(): Promise<ManagedWebGpuDevice> {
    if (this.managed) return this.managed;
    const provider = getGpuProvider();
    if (!provider) throw new Error('当前 Worker 未暴露 navigator.gpu');
    const adapter = await provider.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('Worker 未找到可用 GPU adapter');
    const device = await adapter.requestDevice();
    const generation = ++this.generation;
    this.managed = { provider, adapter, device, generation };
    void device.lost.then((info) => {
      if (this.managed?.device !== device) return;
      this.managed = null;
      this.lostHandler?.(info.message || info.reason || 'WebGPU device lost');
    });
    return this.managed;
  }

  invalidate(): void {
    this.managed?.device.destroy();
    this.managed = null;
  }

  destroy(): void {
    this.invalidate();
    this.lostHandler = null;
  }
}

interface GpuCompilationMessage {
  type?: string;
  lineNum?: number;
  linePos?: number;
  message?: string;
}

interface GpuShaderModuleLike {
  getCompilationInfo?: () => Promise<{ messages: Iterable<GpuCompilationMessage> }>;
}

/**
 * 创建 ShaderModule 并立即读取编译诊断。
 *
 * createShaderModule 本身不会抛错：WGSL 编译失败只会产出一个 invalid module，真实错误
 * 停留在 compilationInfo 与 uncaptured error 里。若不在这里取出来，后续 pipeline 只会报
 * “is invalid due to a previous error”，把真正的行号和原因全部丢掉。
 */
export async function createShaderModuleChecked(
  device: GpuDevice,
  code: string,
  label: string
): Promise<unknown> {
  device.pushErrorScope('validation');
  const module = device.createShaderModule({ code, label });
  const scopeError = await device.popErrorScope();
  const compilationErrors = await readShaderCompilationErrors(module);
  if (compilationErrors.length > 0) {
    throw new Error(`${label} 编译失败：${compilationErrors.join('；')}`);
  }
  if (scopeError) {
    throw new Error(`${label} 编译失败：${scopeError.message ?? '未知错误'}`);
  }
  return module;
}

async function readShaderCompilationErrors(module: unknown): Promise<string[]> {
  const getCompilationInfo = (module as GpuShaderModuleLike | null)?.getCompilationInfo;
  if (typeof getCompilationInfo !== 'function') return [];
  try {
    const info = await getCompilationInfo.call(module);
    return [...info.messages]
      .filter((message) => message.type === 'error')
      .slice(0, 3)
      .map((message) => `第 ${message.lineNum ?? 0} 行第 ${message.linePos ?? 0} 列 ${message.message ?? '未知错误'}`);
  } catch {
    return [];
  }
}

export async function createRenderPipelineChecked(
  device: GpuDevice,
  descriptor: unknown,
  label: string
): Promise<GpuRenderPipeline> {
  device.pushErrorScope('validation');
  try {
    const pipeline = device.createRenderPipelineAsync
      ? await device.createRenderPipelineAsync(descriptor)
      : device.createRenderPipeline(descriptor);
    const error = await device.popErrorScope();
    if (error) {
      throw new Error(`${label} 校验失败：${error.message ?? '未知错误'}`);
    }
    return pipeline;
  } catch (error) {
    await device.popErrorScope().catch(() => null);
    throw error;
  }
}
