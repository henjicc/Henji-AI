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
