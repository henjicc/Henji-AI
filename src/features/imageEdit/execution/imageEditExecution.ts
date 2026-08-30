import {
  compileDiffusionRecipe,
  compileVgpuGlowRecipe,
  IMAGE_EDIT_OPERATION_IDS,
  imageEditOperationRegistry,
  type DiffusionOperationParams,
  type VgpuGlowOperationParams,
  type ImageEditEncodedFormat,
  type ImageEditExecutionCapabilities,
  type ImageEditExecutionDiagnostics,
  type ImageEditExecutionPort,
  type ImageEditExecutionRequest,
  type ImageEditExecutionResult,
  type ImageEditWorkerComposition,
} from '@/core/imageEdit';
import { createLogger } from '@/core/logging';
import { getPlatform } from '@/platform';
import type {
  ImageEditWorkerCapabilities,
  ImageEditWorkerInitializationFailureCode,
} from '@/core/imageEdit/worker/protocol';
import { fitWithinPixelBudget, IMAGE_EDIT_PREVIEW_MAX_PIXELS } from '@/core/imageEdit/worker/exportPrototype';
import { WorkerImageEditClient } from './workerImageEditClient';

const logger = createLogger('features.imageEdit.execution');
const MAX_DEVICE_RECOVERY_ATTEMPTS = 2;

interface WebGpuFallbackDiagnostic {
  reason: NonNullable<ImageEditExecutionDiagnostics['fallbackReason']>;
  deviceRecoveryAttempts: number;
  initializationFailureCode?: ImageEditWorkerInitializationFailureCode;
}

type WorkerExecutionOutcome =
  | { kind: 'completed'; result: ImageEditExecutionResult }
  | { kind: 'fallback'; diagnostic: WebGpuFallbackDiagnostic };

export class UnifiedImageEditExecution implements ImageEditExecutionPort {
  private workerClient: WorkerImageEditClient | null = null;
  private workerCapabilities: ImageEditWorkerCapabilities | null = null;
  private readonly activeWorkerRequestIds = new Set<string>();

  async execute(request: ImageEditExecutionRequest): Promise<ImageEditExecutionResult> {
    const requestId = request.requestId ?? createRequestId();
    const purpose = request.purpose ?? 'export';
    let usesVgpuGlow = false;
    logger.info('image_edit.execution.start', { requestId, purpose });
    try {
      assertOutputQuality(request.outputQuality);
      const document = imageEditOperationRegistry.validateDocument(request.document);
      const params = getEnabledDiffusionParams(document);
      const vgpuGlowParams = getEnabledVgpuGlowParams(document);
      usesVgpuGlow = vgpuGlowParams !== null;
      if (!params && !vgpuGlowParams) {
        throw new Error('统一 GPU 执行器未收到启用的光效操作');
      }
      if (params && vgpuGlowParams) {
        throw new Error('“发光”和“辉光 Pro”暂不支持叠加，请只启用其中一个以便对比效果');
      }
      if (usesVgpuGlow) {
        logger.info('image_edit.vgpu_glow.execution.start', {
          requestId,
          purpose,
          look: vgpuGlowParams?.look,
        });
      }
      const info = await getPlatform().image.readImageInfo(request.sourceImageUrl);
      const composition = createWorkerComposition(document, purpose === 'export');
      const orientedInfo = resolveOrientedSize(info.width, info.height, composition.orientation.rotate);
      const recipe = params
        ? compileDiffusionRecipe(params, {
          width: orientedInfo.width,
          height: orientedInfo.height,
          quality: request.quality ?? params.quality,
        })
        : undefined;
      const vgpuGlowRecipe = vgpuGlowParams
        ? compileVgpuGlowRecipe(vgpuGlowParams, {
          width: orientedInfo.width,
          height: orientedInfo.height,
        })
        : undefined;
      logPreviewBudget(requestId, purpose, orientedInfo, request.maxPixels);
      const normalizedRequest = { ...request, requestId, document };
      const workerResult = await this.tryWorkerExecution(
        normalizedRequest,
        recipe,
        vgpuGlowRecipe,
        composition
      );
      const result = workerResult.kind === 'completed'
        ? workerResult.result
        : vgpuGlowParams
          ? throwVgpuGlowUnavailable(workerResult.diagnostic)
          : await this.executeSharpFallback(
          normalizedRequest,
          params as DiffusionOperationParams,
          composition,
          workerResult.diagnostic
        );
      logger.info('image_edit.execution.completed', {
        requestId,
        purpose,
        backend: result.backend,
      });
      if (usesVgpuGlow) {
        logger.info('image_edit.vgpu_glow.execution.completed', {
          requestId,
          purpose,
          backend: result.backend,
        });
      }
      return result;
    } catch (error) {
      if (isAbortError(error)) {
        logger.info('image_edit.execution.cancelled', { requestId, purpose });
        if (usesVgpuGlow) {
          logger.info('image_edit.vgpu_glow.execution.cancelled', { requestId, purpose });
        }
        throw error;
      }
      logger.error('image_edit.execution.failed', {
        requestId,
        purpose,
        error: error instanceof Error ? error.message : String(error),
      });
      if (usesVgpuGlow) {
        logger.error('image_edit.vgpu_glow.execution.failed', {
          requestId,
          purpose,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      throw error;
    }
  }

  async cancel(requestId: string): Promise<void> {
    if (this.activeWorkerRequestIds.has(requestId)) {
      this.workerClient?.cancel(requestId);
    }
  }

  getCapabilities(): ImageEditExecutionCapabilities {
    return createCapabilities('webgpu-worker');
  }

  destroy(): void {
    this.workerClient?.destroy();
    this.workerClient = null;
    this.workerCapabilities = null;
    this.activeWorkerRequestIds.clear();
  }

  private async tryWorkerExecution(
    request: ImageEditExecutionRequest & { requestId: string },
    recipe: ReturnType<typeof compileDiffusionRecipe> | undefined,
    vgpuGlowRecipe: ReturnType<typeof compileVgpuGlowRecipe> | undefined,
    composition: ImageEditWorkerComposition
  ): Promise<WorkerExecutionOutcome> {
    const client = this.workerClient ?? new WorkerImageEditClient();
    this.workerClient = client;
    for (let attempt = 0; attempt <= MAX_DEVICE_RECOVERY_ATTEMPTS; attempt += 1) {
      let capabilities: ImageEditWorkerCapabilities;
      try {
        capabilities = this.workerCapabilities ?? await client.initialize();
      } catch (error) {
        this.workerCapabilities = null;
        const diagnostic = createWebGpuFallbackDiagnostic(error, attempt);
        logWebGpuFallback(request.requestId, request.purpose ?? 'export', diagnostic);
        return { kind: 'fallback', diagnostic };
      }
      if (!capabilities.available) {
        this.workerCapabilities = null;
        const diagnostic = createWebGpuFallbackDiagnostic(
          capabilities.reason ?? 'Worker WebGPU 初始化未返回可用设备',
          attempt,
          capabilities.initializationFailure?.code
        );
        logWebGpuFallback(request.requestId, request.purpose ?? 'export', diagnostic);
        return { kind: 'fallback', diagnostic };
      }
      this.workerCapabilities = capabilities;
      try {
        this.activeWorkerRequestIds.add(request.requestId);
        let removeAbortListener = (): void => undefined;
        try {
          removeAbortListener = bindAbort(
            request.signal,
            () => client.cancel(request.requestId)
          );
          if ((request.purpose ?? 'export') === 'preview') {
            const preview = await client.preview(
              { kind: 'url', url: request.sourceImageUrl },
              request.revision ?? 0,
              request.maxPixels,
              recipe,
              vgpuGlowRecipe,
              composition,
              {
                requestId: request.requestId,
                previewScopeId: request.previewScopeId,
              }
            );
            return {
              kind: 'completed',
              result: {
              kind: 'preview-frame',
              frame: preview.bitmap,
              document: request.document,
              executorId: 'image-edit-unified',
              backend: 'webgpu-worker',
              width: preview.width,
              height: preview.height,
              revision: preview.revision,
              capabilities: createCapabilities('webgpu-worker'),
              diagnostics: {
                durationMs: preview.durationMs,
                deviceRecoveryAttempts: attempt,
              },
              },
            };
          }
          const task = client.export(
            { kind: 'url', url: request.sourceImageUrl },
            {
              requestId: request.requestId,
              revision: request.revision,
              recipe,
              vgpuGlowRecipe,
              composition,
              renderQuality: request.quality,
              format: request.format ?? 'image/png',
              quality: request.outputQuality,
              onProgress: (completed, total) => request.onProgress?.({
                requestId: request.requestId,
                stage: 'composite',
                completed,
                total,
              }),
            }
          );
          const exported = await task.result;
          const result: ImageEditExecutionResult = {
            kind: 'encoded-export',
            output: {
              kind: 'bytes',
              bytes: exported.bytes,
              format: exported.format,
            },
            document: request.document,
            executorId: 'image-edit-unified',
            backend: 'webgpu-worker',
            width: exported.width,
            height: exported.height,
            capabilities: createCapabilities('webgpu-worker'),
            diagnostics: {
              durationMs: exported.durationMs,
              deviceRecoveryAttempts: attempt,
            },
          };
          if (exported.revision !== undefined) result.revision = exported.revision;
          return { kind: 'completed', result };
        } finally {
          removeAbortListener();
          this.activeWorkerRequestIds.delete(request.requestId);
        }
      } catch (error) {
        if (isAbortError(error)) throw error;
        if (!isRecoverableDeviceError(error)) {
          throw error;
        }
        if (attempt === MAX_DEVICE_RECOVERY_ATTEMPTS) {
          this.workerCapabilities = null;
          const diagnostic: WebGpuFallbackDiagnostic = {
            reason: 'webgpu-device-recovery-exhausted',
            deviceRecoveryAttempts: attempt,
          };
          logWebGpuFallback(request.requestId, request.purpose ?? 'export', diagnostic);
          return { kind: 'fallback', diagnostic };
        }
        logger.warn('WebGPU 设备异常，准备重建后重试', {
          event: 'image_edit.execution.webgpu.recovery.start',
          requestId: request.requestId,
          context: { recoveryAttempt: attempt + 1 },
        });
        this.workerCapabilities = null;
      }
    }
    return {
      kind: 'fallback',
      diagnostic: {
        reason: 'webgpu-device-recovery-exhausted',
        deviceRecoveryAttempts: MAX_DEVICE_RECOVERY_ATTEMPTS,
      },
    };
  }

  private async executeSharpFallback(
    request: ImageEditExecutionRequest & { requestId: string },
    params: DiffusionOperationParams,
    composition: ImageEditWorkerComposition,
    fallbackDiagnostic: WebGpuFallbackDiagnostic
  ): Promise<ImageEditExecutionResult> {
    throwIfAborted(request.signal);
    assertSharpCompositionSupported(composition);
    const platform = getPlatform();
    const capabilities = await platform.image.probeDiffusionFallback();
    if (!capabilities.available) {
      throw new Error(`Sharp 柔光降级不可用：${capabilities.reason ?? '未知原因'}`);
    }
    logger.warn('WebGPU 不可用，切换 Sharp 兼容执行', {
      event: 'image_edit.execution.fallback.sharp.start',
      requestId: request.requestId,
      context: {
        purpose: request.purpose ?? 'export',
        fallbackReason: fallbackDiagnostic.reason,
        deviceRecoveryAttempts: fallbackDiagnostic.deviceRecoveryAttempts,
      },
    });
    const result = await platform.image.renderDiffusionFallback({
      requestId: request.requestId,
      source: request.sourceImageUrl,
      purpose: request.purpose ?? 'export',
      format: mapSharpFormat(request.format ?? 'image/png'),
      quality: request.outputQuality === undefined
        ? undefined
        : Math.round(request.outputQuality * 100),
      maxPreviewPixels: request.maxPixels,
      params,
    });
    throwIfAborted(request.signal);
    const executionCapabilities = createCapabilities('sharp', result.unsupportedParameters);
    if ((request.purpose ?? 'export') === 'preview') {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(result.bytes)], {
        type: mapMimeFormat(result.format),
      }));
      return {
        kind: 'preview-frame',
        frame: bitmap,
        document: request.document,
        executorId: 'image-edit-unified',
        backend: 'sharp',
        width: result.width,
        height: result.height,
        revision: request.revision,
        capabilities: executionCapabilities,
        diagnostics: createFallbackDiagnostics(
          result.durationMs,
          result.unsupportedParameters,
          fallbackDiagnostic
        ),
      };
    }
    return {
      kind: 'encoded-export',
      output: {
        kind: 'bytes',
        bytes: result.bytes,
        format: mapMimeFormat(result.format),
      },
      document: request.document,
      executorId: 'image-edit-unified',
      backend: 'sharp',
      width: result.width,
      height: result.height,
      revision: request.revision,
      capabilities: executionCapabilities,
      diagnostics: createFallbackDiagnostics(
        result.durationMs,
        result.unsupportedParameters,
        fallbackDiagnostic
      ),
    };
  }
}

function assertSharpCompositionSupported(composition: ImageEditWorkerComposition): void {
  const hasOrientation = composition.orientation.rotate !== 0 || composition.orientation.mirrored;
  const hasAnnotations = Boolean(composition.annotations?.items.length);
  const hasCrop = composition.crop?.rect !== null && composition.crop?.rect !== undefined;
  if (hasOrientation || hasAnnotations || hasCrop) {
    throw new Error('Sharp 柔光降级暂不支持与朝向、标注或裁剪合成，已保留原始编辑文档');
  }
}

export const imageEditExecutionPort = new UnifiedImageEditExecution();

function getEnabledDiffusionParams(
  document: ImageEditExecutionRequest['document']
): DiffusionOperationParams | null {
  const operation = document.operations.find((entry) =>
    entry.enabled && entry.operationId === IMAGE_EDIT_OPERATION_IDS.diffusion
  );
  return (operation?.params as DiffusionOperationParams | undefined) ?? null;
}

function getEnabledVgpuGlowParams(
  document: ImageEditExecutionRequest['document']
): VgpuGlowOperationParams | null {
  const operation = document.operations.find((entry) =>
    entry.enabled && entry.operationId === IMAGE_EDIT_OPERATION_IDS.vgpuGlow
  );
  return (operation?.params as VgpuGlowOperationParams | undefined) ?? null;
}

function createWorkerComposition(
  document: ImageEditExecutionRequest['document'],
  includePostEffects: boolean
): ImageEditWorkerComposition {
  const getParams = <TParams extends object>(operationId: string, fallback: TParams): TParams => {
    const operation = document.operations.find((entry) => entry.enabled && entry.operationId === operationId);
    return (operation?.params as TParams | undefined) ?? fallback;
  };
  const orientation = getParams(IMAGE_EDIT_OPERATION_IDS.orientation, { rotate: 0 as const, mirrored: false });
  if (!includePostEffects) return { orientation };
  return {
    orientation,
    annotations: getParams(IMAGE_EDIT_OPERATION_IDS.annotations, { items: [] }),
    crop: getParams(IMAGE_EDIT_OPERATION_IDS.crop, { rect: null }),
  };
}

function resolveOrientedSize(width: number, height: number, rotate: number): { width: number; height: number } {
  return rotate === 90 || rotate === 270 ? { width: height, height: width } : { width, height };
}

function createCapabilities(
  backend: 'webgpu-worker' | 'sharp',
  unsupportedParameters: readonly string[] = []
): ImageEditExecutionCapabilities {
  const fallbackUnsupported = backend === 'webgpu-worker'
    ? [...unsupportedParameters, IMAGE_EDIT_OPERATION_IDS.vgpuGlow]
    : unsupportedParameters;
  return {
    executorId: 'image-edit-unified',
    backends: [backend],
    supportedOperationIds: [
      IMAGE_EDIT_OPERATION_IDS.orientation,
      IMAGE_EDIT_OPERATION_IDS.diffusion,
      IMAGE_EDIT_OPERATION_IDS.vgpuGlow,
      IMAGE_EDIT_OPERATION_IDS.annotations,
      IMAGE_EDIT_OPERATION_IDS.crop,
    ],
    purposes: ['preview', 'export'],
    qualities: ['realtime', 'high'],
    exportFormats: ['image/png', 'image/jpeg', 'image/webp'],
    hardCancellationSupported: backend === 'webgpu-worker',
    fallback: {
      backend: 'sharp',
      unsupportedParameters: fallbackUnsupported,
      hardCancellationSupported: false,
    },
  };
}

function throwVgpuGlowUnavailable(diagnostic: WebGpuFallbackDiagnostic): never {
  throw new Error(
    `辉光 Pro 需要可用的 WebGPU，当前无法启动 VGPU（${diagnostic.reason}）`
  );
}

function createFallbackDiagnostics(
  durationMs: number,
  unsupportedParameters: readonly string[],
  fallbackDiagnostic: WebGpuFallbackDiagnostic
): NonNullable<ImageEditExecutionResult['diagnostics']> {
  return {
    durationMs,
    fallbackReason: fallbackDiagnostic.reason,
    deviceRecoveryAttempts: fallbackDiagnostic.deviceRecoveryAttempts,
    unsupportedParameters,
  };
}

export function classifyWebGpuFallbackReason(
  error: unknown,
  deviceRecoveryAttempts: number,
  initializationFailureCode?: ImageEditWorkerInitializationFailureCode
): NonNullable<ImageEditExecutionDiagnostics['fallbackReason']> {
  if (deviceRecoveryAttempts >= MAX_DEVICE_RECOVERY_ATTEMPTS && isRecoverableDeviceError(error)) {
    return 'webgpu-device-recovery-exhausted';
  }
  if (initializationFailureCode === 'webgpu-api-unavailable') {
    return 'webgpu-api-unavailable';
  }
  if (initializationFailureCode === 'webgpu-adapter-unavailable') {
    return 'webgpu-adapter-unavailable';
  }
  const message = getErrorMessage(error).toLowerCase();
  if (message.includes('navigator.gpu') || message.includes('webgpu api')) {
    return 'webgpu-api-unavailable';
  }
  if (message.includes('gpu adapter') || message.includes('可用 gpu')) {
    return 'webgpu-adapter-unavailable';
  }
  return 'webgpu-initialization-failed';
}

function createWebGpuFallbackDiagnostic(
  error: unknown,
  deviceRecoveryAttempts: number,
  initializationFailureCode?: ImageEditWorkerInitializationFailureCode
): WebGpuFallbackDiagnostic {
  return {
    reason: classifyWebGpuFallbackReason(
      error,
      deviceRecoveryAttempts,
      initializationFailureCode
    ),
    deviceRecoveryAttempts,
    initializationFailureCode,
  };
}

function logWebGpuFallback(
  requestId: string,
  purpose: 'preview' | 'export',
  diagnostic: WebGpuFallbackDiagnostic
): void {
  logger.warn('WebGPU 不可用，准备使用兼容执行器', {
    event: 'image_edit.execution.webgpu.unavailable',
    requestId,
    context: {
      purpose,
      fallbackReason: diagnostic.reason,
      deviceRecoveryAttempts: diagnostic.deviceRecoveryAttempts,
      initializationFailureCode: diagnostic.initializationFailureCode,
    },
  });
}

function logPreviewBudget(
  requestId: string,
  purpose: 'preview' | 'export',
  sourceSize: { width: number; height: number },
  requestedMaxPixels: number | undefined
): void {
  if (purpose !== 'preview') return;
  const maxPixels = requestedMaxPixels ?? IMAGE_EDIT_PREVIEW_MAX_PIXELS;
  if (!Number.isInteger(maxPixels) || maxPixels <= 0) return;
  const previewSize = fitWithinPixelBudget(sourceSize.width, sourceSize.height, maxPixels);
  logger.debug('预览像素预算已应用', {
    event: 'image_edit.execution.preview.budget',
    requestId,
    context: {
      sourceWidth: sourceSize.width,
      sourceHeight: sourceSize.height,
      previewWidth: previewSize.width,
      previewHeight: previewSize.height,
      maxPixels,
    },
  });
}

function mapSharpFormat(format: ImageEditEncodedFormat): 'png' | 'jpeg' | 'webp' {
  if (format === 'image/jpeg') return 'jpeg';
  if (format === 'image/webp') return 'webp';
  return 'png';
}

function mapMimeFormat(format: 'png' | 'jpeg' | 'webp'): ImageEditEncodedFormat {
  if (format === 'jpeg') return 'image/jpeg';
  if (format === 'webp') return 'image/webp';
  return 'image/png';
}

function bindAbort(signal: AbortSignal | undefined, cancel: () => void): () => void {
  if (!signal) return () => undefined;
  throwIfAborted(signal);
  signal.addEventListener('abort', cancel, { once: true });
  return () => signal.removeEventListener('abort', cancel);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('图片编辑任务已取消', 'AbortError');
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
    || error instanceof Error && error.message.includes('已取消');
}

function isRecoverableDeviceError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return message.includes('device-lost')
    || message.includes('设备丢失')
    || message.includes('device-unavailable')
    || message.includes('device unavailable');
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createRequestId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? `image-edit-${crypto.randomUUID()}`
    : `image-edit-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function assertOutputQuality(value: number | undefined): void {
  if (
    value !== undefined
    && (!Number.isFinite(value) || value < 0 || value > 1)
  ) {
    throw new Error('图片导出质量必须在 0～1 之间');
  }
}
