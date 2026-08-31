import {
  compileDiffusionRecipe,
  compileVgpuGlowRecipe,
  imageEditOperationRegistry,
  type DiffusionOperationParams,
  type ImageEditExecutionCapabilities,
  type ImageEditExecutionPort,
  type ImageEditExecutionRequest,
  type ImageEditExecutionResult,
  type ImageEditWorkerComposition,
} from '@/core/imageEdit';
import { createLogger } from '@/core/logging';
import { getPlatform } from '@/platform';
import type {
  ImageEditWorkerCapabilities,
} from '@/core/imageEdit/worker/protocol';
import { PreviewRevisionTracker } from '@/core/imageEdit/worker/previewRevisionTracker';
import { WorkerImageEditClient } from './workerImageEditClient';
import {
  MAX_DEVICE_RECOVERY_RETRIES,
  assertOutputQuality,
  assertSharpCompositionSupported,
  bindAbort,
  createCapabilities,
  createFallbackDiagnostics,
  createLogicalRequestId,
  createWebGpuFallbackDiagnostic,
  createWorkerAttemptRequestId,
  createWorkerComposition,
  getEnabledDiffusionParams,
  getEnabledVgpuGlowParams,
  isAbortError,
  isRecoverableDeviceError,
  logPreviewBudget,
  logWebGpuFallback,
  mapMimeFormat,
  mapSharpFormat,
  resolveOrientedSize,
  shouldRetryWebGpuDeviceFailure,
  shouldRetryUnavailableWorkerCapabilities,
  throwIfAborted,
  throwVgpuGlowUnavailable,
  type WebGpuFallbackDiagnostic,
} from './imageEditExecutionSupport';

const logger = createLogger('features.imageEdit.execution');

type WorkerExecutionOutcome =
  | { kind: 'completed'; result: ImageEditExecutionResult }
  | { kind: 'fallback'; diagnostic: WebGpuFallbackDiagnostic };

export class UnifiedImageEditExecution implements ImageEditExecutionPort {
  private workerClient: WorkerImageEditClient | null = null;
  private workerCapabilities: ImageEditWorkerCapabilities | null = null;
  private readonly activeWorkerRequestIds = new Map<string, string>();
  private readonly previewRevisions = new PreviewRevisionTracker();

  async execute(request: ImageEditExecutionRequest): Promise<ImageEditExecutionResult> {
    const requestId = request.requestId ?? createLogicalRequestId();
    const purpose = request.purpose ?? 'export';
    const previewScopeId = purpose === 'preview'
      ? request.previewScopeId ?? requestId
      : null;
    if (previewScopeId) {
      this.previewRevisions.register(previewScopeId, request.revision ?? 0);
    }
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
      let result: ImageEditExecutionResult;
      if (workerResult.kind === 'completed') {
        result = workerResult.result;
        this.assertLatestPreviewResult(requestId, request, previewScopeId, result);
      } else {
        // Sharp 会创建新的位图，先拒绝已经过期的预览，避免无意义解码和分配。
        this.assertLatestPreview(requestId, request, previewScopeId);
        result = vgpuGlowParams
          ? throwVgpuGlowUnavailable(workerResult.diagnostic)
          : await this.executeSharpFallback(
            normalizedRequest,
            params as DiffusionOperationParams,
            composition,
            workerResult.diagnostic
          );
        this.assertLatestPreviewResult(requestId, request, previewScopeId, result);
      }
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
    } finally {
      if (previewScopeId) this.previewRevisions.complete(previewScopeId);
    }
  }

  async cancel(requestId: string): Promise<void> {
    const workerRequestId = this.activeWorkerRequestIds.get(requestId);
    if (workerRequestId) this.workerClient?.cancel(workerRequestId);
  }

  getCapabilities(): ImageEditExecutionCapabilities {
    return createCapabilities('webgpu-worker');
  }

  destroy(): void {
    this.workerClient?.destroy();
    this.workerClient = null;
    this.workerCapabilities = null;
    this.activeWorkerRequestIds.clear();
    this.previewRevisions.clear();
  }

  private async tryWorkerExecution(
    request: ImageEditExecutionRequest & { requestId: string },
    recipe: ReturnType<typeof compileDiffusionRecipe> | undefined,
    vgpuGlowRecipe: ReturnType<typeof compileVgpuGlowRecipe> | undefined,
    composition: ImageEditWorkerComposition
  ): Promise<WorkerExecutionOutcome> {
    const client = this.workerClient ?? new WorkerImageEditClient();
    this.workerClient = client;
    for (let attempt = 0; attempt <= MAX_DEVICE_RECOVERY_RETRIES; attempt += 1) {
      this.assertLatestPreview(
        request.requestId,
        request,
        (request.purpose ?? 'export') === 'preview'
          ? request.previewScopeId ?? request.requestId
          : null
      );
      let capabilities: ImageEditWorkerCapabilities;
      try {
        capabilities = this.workerCapabilities ?? await client.initialize(attempt > 0);
      } catch (error) {
        this.workerCapabilities = null;
        if (shouldRetryWebGpuDeviceFailure(error, attempt)) {
          this.logDeviceRecovery(request.requestId, attempt + 1, 'initialize-rejected');
          continue;
        }
        const diagnostic = createWebGpuFallbackDiagnostic(error, attempt);
        logWebGpuFallback(request.requestId, request.purpose ?? 'export', diagnostic);
        return { kind: 'fallback', diagnostic };
      }
      if (!capabilities.available) {
        this.workerCapabilities = null;
        if (shouldRetryUnavailableWorkerCapabilities(capabilities, attempt)) {
          this.logDeviceRecovery(request.requestId, attempt + 1, 'initialize-unavailable');
          continue;
        }
        const initializationDetail = capabilities.initializationFailure?.detail
          ?? capabilities.reason
          ?? 'Worker WebGPU 初始化未返回可用设备';
        const diagnostic = createWebGpuFallbackDiagnostic(
          initializationDetail,
          attempt,
          capabilities.initializationFailure?.code
        );
        logWebGpuFallback(request.requestId, request.purpose ?? 'export', diagnostic);
        return { kind: 'fallback', diagnostic };
      }
      this.workerCapabilities = capabilities;
      const workerRequestId = createWorkerAttemptRequestId(request.requestId, attempt);
      try {
        this.activeWorkerRequestIds.set(request.requestId, workerRequestId);
        let removeAbortListener = (): void => undefined;
        try {
          removeAbortListener = bindAbort(
            request.signal,
            () => client.cancel(workerRequestId)
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
                requestId: workerRequestId,
                previewScopeId: request.previewScopeId ?? request.requestId,
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
              requestId: workerRequestId,
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
          if (this.activeWorkerRequestIds.get(request.requestId) === workerRequestId) {
            this.activeWorkerRequestIds.delete(request.requestId);
          }
        }
      } catch (error) {
        if (isAbortError(error)) throw error;
        if (!isRecoverableDeviceError(error)) {
          throw error;
        }
        if (!shouldRetryWebGpuDeviceFailure(error, attempt)) {
          this.workerCapabilities = null;
          const diagnostic: WebGpuFallbackDiagnostic = {
            reason: 'webgpu-device-recovery-exhausted',
            deviceRecoveryAttempts: attempt,
          };
          logWebGpuFallback(request.requestId, request.purpose ?? 'export', diagnostic);
          return { kind: 'fallback', diagnostic };
        }
        this.logDeviceRecovery(request.requestId, attempt + 1, 'request-failed');
        this.workerCapabilities = null;
      }
    }
    return {
      kind: 'fallback',
      diagnostic: {
        reason: 'webgpu-device-recovery-exhausted',
        deviceRecoveryAttempts: MAX_DEVICE_RECOVERY_RETRIES,
      },
    };
  }

  private assertLatestPreview(
    requestId: string,
    request: ImageEditExecutionRequest,
    previewScopeId: string | null
  ): void {
    if (this.isStalePreview(request, previewScopeId)) {
      throw new DOMException(
        `预览 ${requestId} 的 revision ${request.revision ?? 0} 已过期`,
        'AbortError'
      );
    }
  }

  private assertLatestPreviewResult(
    requestId: string,
    request: ImageEditExecutionRequest,
    previewScopeId: string | null,
    result: ImageEditExecutionResult
  ): void {
    if (!this.isStalePreview(request, previewScopeId)) return;
    if (result.kind === 'preview-frame' && typeof result.frame !== 'string') {
      result.frame.close();
    }
    throw new DOMException(
      `预览 ${requestId} 的 revision ${request.revision ?? 0} 已过期`,
      'AbortError'
    );
  }

  private logDeviceRecovery(
    requestId: string,
    recoveryAttempt: number,
    phase: 'initialize-rejected' | 'initialize-unavailable' | 'request-failed'
  ): void {
    logger.warn('WebGPU 设备异常，准备重建后重试', {
      event: 'image_edit.execution.webgpu.recovery.start',
      requestId,
      context: { recoveryAttempt, phase },
    });
  }

  private isStalePreview(
    request: ImageEditExecutionRequest,
    previewScopeId: string | null
  ): boolean {
    return previewScopeId !== null
      && this.previewRevisions.isStale(previewScopeId, request.revision ?? 0);
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

export const imageEditExecutionPort = new UnifiedImageEditExecution();

export { classifyWebGpuFallbackReason } from './imageEditExecutionSupport';
