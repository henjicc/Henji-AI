import { describe, expect, it, vi } from 'vitest';
import {
  IMAGE_EDIT_OPERATION_IDS,
  createDefaultDiffusionOperationParams,
  createDefaultVgpuGlowOperationParams,
  createEmptyImageEditDocument,
  createImageEditOperation,
  upsertImageEditOperation,
  withImageEditWorkerExecutionCapabilities,
  type ImageEditDocument,
  type ImageEditWorkerCapabilities,
} from '@/core/imageEdit';
import type {
  WorkerImageEditClient,
  WorkerImageEditPreviewResult,
} from './workerImageEditClient';
import {
  UnifiedImageEditExecution,
  classifyWebGpuFallbackReason,
} from './imageEditExecution';
import {
  createWorkerAttemptRequestId,
  shouldRetryUnavailableWorkerCapabilities,
  shouldRetryWebGpuDeviceFailure,
} from './imageEditExecutionSupport';

const platformImage = vi.hoisted(() => ({
  readImageInfo: vi.fn(async (source: string) => ({
    source,
    fileName: 'source.png',
    extension: '.png',
    width: 100,
    height: 100,
    orientation: null,
    hasAlpha: true,
    fileSizeBytes: 400,
    createdAt: null,
    modifiedAt: null,
  })),
}));

vi.mock('@/platform', () => ({
  getPlatform: () => ({ image: platformImage }),
}));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

type ExecutionWorkerClient = Pick<
  WorkerImageEditClient,
  'initialize' | 'preview' | 'export' | 'cancel' | 'destroy'
>;

function deferred<T>(): Deferred<T> {
  let resolve = (_value: T): void => undefined;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function availableCapabilities(): ImageEditWorkerCapabilities {
  return {
    available: true,
    adapterName: 'test-adapter',
    backend: 'test',
    isFallbackAdapter: false,
    features: [],
    limits: {},
    rgba16Float: { renderable: true, sampleable: true },
    offscreenCanvas: true,
    imageBitmap: true,
    supportedExportFormats: ['image/png'],
  };
}

function unavailableCapabilities(
  detail: string,
  code: NonNullable<ImageEditWorkerCapabilities['initializationFailure']>['code']
): ImageEditWorkerCapabilities {
  return {
    ...availableCapabilities(),
    available: false,
    initializationFailure: { code, detail },
    reason: detail,
  };
}

function effectDocument(effect: 'diffusion' | 'vgpu-glow' = 'diffusion'): ImageEditDocument {
  const isDiffusion = effect === 'diffusion';
  return upsertImageEditOperation(
    createEmptyImageEditDocument(),
    createImageEditOperation(
      isDiffusion
        ? IMAGE_EDIT_OPERATION_IDS.diffusion
        : IMAGE_EDIT_OPERATION_IDS.vgpuGlow,
      isDiffusion
        ? createDefaultDiffusionOperationParams()
        : createDefaultVgpuGlowOperationParams()
    )
  );
}

function fakeBitmap(): ImageBitmap {
  return { close: vi.fn() } as unknown as ImageBitmap;
}

function attachWorkerClient(
  execution: UnifiedImageEditExecution,
  client: ExecutionWorkerClient
): void {
  Object.assign(execution, { workerClient: client });
}

function createClient(
  initialize: ExecutionWorkerClient['initialize'],
  preview: ExecutionWorkerClient['preview']
): ExecutionWorkerClient {
  return {
    initialize,
    preview,
    export: () => { throw new Error('测试不应执行导出'); },
    cancel: vi.fn(),
    destroy: vi.fn(),
  };
}

describe('图片编辑 WebGPU 降级诊断', () => {
  it('把不可用 API、无 adapter 和初始化失败区分为稳定诊断码', () => {
    expect(classifyWebGpuFallbackReason(
      new Error('当前 Worker 未暴露 navigator.gpu'),
      0
    )).toBe('webgpu-api-unavailable');
    expect(classifyWebGpuFallbackReason(
      new Error('Worker 未找到可用 GPU adapter'),
      0
    )).toBe('webgpu-adapter-unavailable');
    expect(classifyWebGpuFallbackReason(
      new Error('OffscreenCanvas WebGPU context 不可用'),
      0
    )).toBe('webgpu-initialization-failed');
    expect(classifyWebGpuFallbackReason(
      new Error('已脱敏的 Worker 错误'),
      0,
      'webgpu-adapter-unavailable'
    )).toBe('webgpu-adapter-unavailable');
  });

  it('设备连续丢失达到恢复上限时给出独立恢复耗尽诊断', () => {
    expect(classifyWebGpuFallbackReason(
      new Error('WebGPU 设备丢失：test-device-lost'),
      1
    )).toBe('webgpu-device-recovery-exhausted');
    expect(classifyWebGpuFallbackReason(
      new Error('已脱敏的 Worker 错误'),
      0,
      'webgpu-device-recovery-cooldown'
    )).toBe('webgpu-device-recovery-exhausted');
  });

  it('导出事务遇到设备丢失时最多重试一次且每次使用独立 Worker id', () => {
    const error = new Error('[device-lost] export-device-lost');
    expect(shouldRetryWebGpuDeviceFailure(error, 0)).toBe(true);
    expect(shouldRetryWebGpuDeviceFailure(error, 1)).toBe(false);
    expect(createWorkerAttemptRequestId('export-1', 0)).not.toBe(
      createWorkerAttemptRequestId('export-1', 1)
    );
  });

  it('只把明确的 device-lost/unavailable 初始化结果纳入一次恢复', () => {
    expect(shouldRetryUnavailableWorkerCapabilities(
      unavailableCapabilities('device-unavailable during init', 'webgpu-device-request-failed'),
      0
    )).toBe(true);
    expect(shouldRetryUnavailableWorkerCapabilities(
      unavailableCapabilities('baseline pipeline creation failed', 'webgpu-baseline-pipeline-failed'),
      0
    )).toBe(false);
  });

  it('能力声明明确为协作式取消，不声称硬取消', () => {
    const execution = new UnifiedImageEditExecution();
    expect(execution.getCapabilities().hardCancellationSupported).toBe(false);
    expect(withImageEditWorkerExecutionCapabilities(
      availableCapabilities()
    ).hardCancellationSupported).toBe(false);
    execution.destroy();
  });
});

describe('图片编辑 WebGPU 恢复与预览 revision', () => {
  it('并发预览完成后关闭已过期 revision 的 ImageBitmap 再拒绝', async () => {
    const firstPreview = deferred<WorkerImageEditPreviewResult>();
    const secondPreview = deferred<WorkerImageEditPreviewResult>();
    const preview = vi.fn((
      _source: Parameters<ExecutionWorkerClient['preview']>[0],
      revision: number
    ) => revision === 1 ? firstPreview.promise : secondPreview.promise);
    const execution = new UnifiedImageEditExecution();
    attachWorkerClient(execution, createClient(
      vi.fn(async () => availableCapabilities()),
      preview as ExecutionWorkerClient['preview']
    ));
    const document = effectDocument();
    const older = execution.execute({
      sourceImageUrl: 'source.png',
      document,
      purpose: 'preview',
      previewScopeId: 'editor-a',
      revision: 1,
    });
    await vi.waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
    const latest = execution.execute({
      sourceImageUrl: 'source.png',
      document,
      purpose: 'preview',
      previewScopeId: 'editor-a',
      revision: 2,
    });
    await vi.waitFor(() => expect(preview).toHaveBeenCalledTimes(2));

    const staleBitmap = fakeBitmap();
    firstPreview.resolve({
      bitmap: staleBitmap,
      revision: 1,
      width: 100,
      height: 100,
      durationMs: 2,
    });
    await expect(older).rejects.toThrow('已过期');
    expect(staleBitmap.close).toHaveBeenCalledOnce();

    const latestBitmap = fakeBitmap();
    secondPreview.resolve({
      bitmap: latestBitmap,
      revision: 2,
      width: 100,
      height: 100,
      durationMs: 1,
    });
    await expect(latest).resolves.toMatchObject({
      kind: 'preview-frame',
      revision: 2,
      frame: latestBitmap,
    });
    expect(latestBitmap.close).not.toHaveBeenCalled();
    latestBitmap.close();
    execution.destroy();
  });

  it('初始化 Promise 因 device lost 拒绝时只恢复一次并传 recoverDevice=true', async () => {
    const initialize = vi.fn()
      .mockRejectedValueOnce(new Error('[device-lost] lost during init'))
      .mockResolvedValueOnce(availableCapabilities());
    const bitmap = fakeBitmap();
    const execution = new UnifiedImageEditExecution();
    attachWorkerClient(execution, createClient(
      initialize,
      vi.fn(async () => ({ bitmap, revision: 1, width: 100, height: 100, durationMs: 1 }))
    ));

    await expect(execution.execute({
      sourceImageUrl: 'source.png',
      document: effectDocument(),
      purpose: 'preview',
      previewScopeId: 'editor-a',
      revision: 1,
    })).resolves.toMatchObject({ kind: 'preview-frame', revision: 1 });
    expect(initialize).toHaveBeenNthCalledWith(1, false);
    expect(initialize).toHaveBeenNthCalledWith(2, true);
    bitmap.close();
    execution.destroy();
  });

  it('初始化返回 device-unavailable 时恢复一次，普通 pipeline 失败直接降级', async () => {
    const recoveryInitialize = vi.fn()
      .mockResolvedValueOnce(unavailableCapabilities(
        'device-unavailable during init',
        'webgpu-device-request-failed'
      ))
      .mockResolvedValueOnce(availableCapabilities());
    const bitmap = fakeBitmap();
    const recovered = new UnifiedImageEditExecution();
    attachWorkerClient(recovered, createClient(
      recoveryInitialize,
      vi.fn(async () => ({ bitmap, revision: 1, width: 100, height: 100, durationMs: 1 }))
    ));
    await expect(recovered.execute({
      sourceImageUrl: 'source.png',
      document: effectDocument(),
      purpose: 'preview',
      previewScopeId: 'editor-a',
      revision: 1,
    })).resolves.toMatchObject({ kind: 'preview-frame' });
    expect(recoveryInitialize).toHaveBeenNthCalledWith(2, true);
    bitmap.close();
    recovered.destroy();

    const pipelineInitialize = vi.fn(async () => unavailableCapabilities(
      'baseline pipeline creation failed',
      'webgpu-baseline-pipeline-failed'
    ));
    const preview = vi.fn();
    const failed = new UnifiedImageEditExecution();
    attachWorkerClient(failed, createClient(
      pipelineInitialize,
      preview as ExecutionWorkerClient['preview']
    ));
    await expect(failed.execute({
      sourceImageUrl: 'source.png',
      document: effectDocument('vgpu-glow'),
      purpose: 'preview',
      previewScopeId: 'editor-b',
      revision: 1,
    })).rejects.toThrow('辉光 Pro 需要可用的 WebGPU');
    expect(pipelineInitialize).toHaveBeenCalledOnce();
    expect(preview).not.toHaveBeenCalled();
    failed.destroy();
  });
});
