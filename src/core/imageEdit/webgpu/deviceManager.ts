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

export interface ImageEditWebGpuRecoveryPolicy {
  maxLosses: number;
  lossWindowMs: number;
  cooldownMs: number;
}

export interface ImageEditWebGpuRecoveryStatus {
  state: 'idle' | 'acquiring' | 'ready' | 'cooldown' | 'destroyed';
  generation: number;
  recentLosses: number;
  retryAfterMs: number;
}

export interface ImageEditWebGpuDeviceLoss {
  generation: number;
  reason: string;
  recovery: ImageEditWebGpuRecoveryStatus;
}

export interface ImageEditWebGpuDeviceManagerOptions {
  getProvider?: () => GpuProvider | null;
  now?: () => number;
  recovery?: Partial<ImageEditWebGpuRecoveryPolicy>;
}

const DEFAULT_RECOVERY_POLICY: ImageEditWebGpuRecoveryPolicy = {
  maxLosses: 3,
  lossWindowMs: 30_000,
  cooldownMs: 15_000,
};

export class ImageEditWebGpuRecoveryCooldownError extends Error {
  readonly code = 'webgpu-device-recovery-cooldown';

  constructor(readonly retryAfterMs: number) {
    super(`WebGPU 设备恢复已进入冷却，请在 ${retryAfterMs}ms 后重试`);
    this.name = 'ImageEditWebGpuRecoveryCooldownError';
  }
}

export class ImageEditWebGpuInitializationInvalidatedError extends Error {
  readonly code = 'webgpu-device-initialization-invalidated';

  constructor() {
    super('WebGPU 设备初始化已失效');
    this.name = 'ImageEditWebGpuInitializationInvalidatedError';
  }
}

export class ImageEditWebGpuDeviceManager {
  private managed: ManagedWebGpuDevice | null = null;
  private generation = 0;
  private lifecycle = 0;
  private acquisition: Promise<ManagedWebGpuDevice> | null = null;
  private cooldownUntil = 0;
  private lossTimes: number[] = [];
  private destroyed = false;
  private lostHandler: ((reason: string, loss: ImageEditWebGpuDeviceLoss) => void) | null = null;
  private readonly getProvider: () => GpuProvider | null;
  private readonly now: () => number;
  private readonly recovery: ImageEditWebGpuRecoveryPolicy;

  constructor(options: ImageEditWebGpuDeviceManagerOptions = {}) {
    this.getProvider = options.getProvider ?? getGpuProvider;
    this.now = options.now ?? Date.now;
    this.recovery = {
      ...DEFAULT_RECOVERY_POLICY,
      ...options.recovery,
    };
    assertRecoveryPolicy(this.recovery);
  }

  onDeviceLost(
    handler: (reason: string, loss: ImageEditWebGpuDeviceLoss) => void
  ): void {
    this.lostHandler = handler;
  }

  async acquire(): Promise<ManagedWebGpuDevice> {
    if (this.managed) return this.managed;
    if (this.destroyed) throw new Error('WebGPU 设备管理器已销毁');
    this.assertRecoveryAvailable();
    if (this.acquisition) return await this.acquisition;
    const lifecycle = this.lifecycle;
    const acquisition = this.createManagedDevice(lifecycle);
    this.acquisition = acquisition;
    try {
      return await acquisition;
    } finally {
      if (this.acquisition === acquisition) this.acquisition = null;
    }
  }

  invalidate(): void {
    this.lifecycle += 1;
    const managed = this.managed;
    this.managed = null;
    this.acquisition = null;
    managed?.device.destroy();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.invalidate();
    this.lostHandler = null;
  }

  isCurrent(generation: number): boolean {
    return this.managed?.generation === generation;
  }

  getRecoveryStatus(): ImageEditWebGpuRecoveryStatus {
    const now = this.now();
    this.pruneLosses(now);
    const retryAfterMs = Math.max(0, this.cooldownUntil - now);
    return {
      state: this.destroyed
        ? 'destroyed'
        : retryAfterMs > 0
          ? 'cooldown'
          : this.managed
            ? 'ready'
            : this.acquisition
              ? 'acquiring'
              : 'idle',
      generation: this.generation,
      recentLosses: this.lossTimes.length,
      retryAfterMs,
    };
  }

  private async createManagedDevice(
    lifecycle: number
  ): Promise<ManagedWebGpuDevice> {
    let device: GpuDevice | null = null;
    try {
      const provider = this.getProvider();
      if (!provider) throw new Error('当前 Worker 未暴露 navigator.gpu');
      const adapter = await provider.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) throw new Error('Worker 未找到可用 GPU adapter');
      device = await adapter.requestDevice();
      if (this.destroyed || this.lifecycle !== lifecycle) {
        throw new ImageEditWebGpuInitializationInvalidatedError();
      }
      const generation = ++this.generation;
      const managed = { provider, adapter, device, generation };
      this.managed = managed;
      void device.lost.then((info) => this.handleDeviceLost(managed, info));
      return managed;
    } catch (error) {
      if (device && this.managed?.device !== device) device.destroy();
      throw error;
    }
  }

  private handleDeviceLost(
    lost: ManagedWebGpuDevice,
    info: { reason?: string; message?: string }
  ): void {
    if (
      this.managed?.device !== lost.device
      || this.managed.generation !== lost.generation
    ) return;
    this.managed = null;
    this.lifecycle += 1;
    const now = this.now();
    this.lossTimes.push(now);
    this.pruneLosses(now);
    if (this.lossTimes.length >= this.recovery.maxLosses) {
      this.cooldownUntil = Math.max(
        this.cooldownUntil,
        now + this.recovery.cooldownMs
      );
    }
    const reason = info.message || info.reason || 'WebGPU device lost';
    const recovery = this.getRecoveryStatus();
    this.lostHandler?.(reason, {
      generation: lost.generation,
      reason,
      recovery,
    });
  }

  private assertRecoveryAvailable(): void {
    const retryAfterMs = Math.max(0, this.cooldownUntil - this.now());
    if (retryAfterMs > 0) {
      throw new ImageEditWebGpuRecoveryCooldownError(retryAfterMs);
    }
  }

  private pruneLosses(now: number): void {
    const lowerBound = now - this.recovery.lossWindowMs;
    this.lossTimes = this.lossTimes.filter((lostAt) => lostAt >= lowerBound);
    if (this.cooldownUntil <= now) this.cooldownUntil = 0;
  }
}

function assertRecoveryPolicy(policy: ImageEditWebGpuRecoveryPolicy): void {
  if (
    !Number.isInteger(policy.maxLosses)
    || policy.maxLosses < 1
    || !Number.isFinite(policy.lossWindowMs)
    || policy.lossWindowMs <= 0
    || !Number.isFinite(policy.cooldownMs)
    || policy.cooldownMs <= 0
  ) {
    throw new Error('WebGPU 设备恢复策略无效');
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
