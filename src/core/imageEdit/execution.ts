import type { ImageEditDocument } from './types';
import type { ImageEditOperationRegistry } from './operations';

export type ImageEditRenderPurpose = 'preview' | 'export';
export type ImageEditRenderQuality = 'realtime' | 'high';
export type ImageEditExecutionBackend = 'webgpu-worker' | 'sharp' | 'browser-canvas';
export type ImageEditEncodedFormat = 'image/png' | 'image/jpeg' | 'image/webp';
export type ImageEditFallbackReason =
  | 'webgpu-api-unavailable'
  | 'webgpu-adapter-unavailable'
  | 'webgpu-initialization-failed'
  | 'webgpu-device-recovery-exhausted';

export interface ImageEditExecutionRequest {
  sourceImageUrl: string;
  document: ImageEditDocument;
  requestId?: string;
  purpose?: ImageEditRenderPurpose;
  quality?: ImageEditRenderQuality;
  maxDimension?: number;
  maxPixels?: number;
  format?: ImageEditEncodedFormat;
  /** 有损编码质量，范围 0～1；PNG 会忽略该值。 */
  outputQuality?: number;
  /** 同一个编辑器实例内稳定，用于隔离不同编辑会话的预览 revision。 */
  previewScopeId?: string;
  revision?: number;
  signal?: AbortSignal;
  onProgress?: (progress: ImageEditExecutionProgress) => void;
}

export interface ImageEditExecutionProgress {
  requestId: string;
  stage: 'decode' | 'source' | 'scatter' | 'composite' | 'encode';
  completed: number;
  total: number;
}

export interface ImageEditExecutionDiagnostics {
  durationMs?: number;
  fallbackReason?: ImageEditFallbackReason;
  deviceRecoveryAttempts?: number;
  unsupportedParameters?: readonly string[];
}

interface ImageEditExecutionResultBase {
  document: ImageEditDocument;
  executorId: string;
  backend: ImageEditExecutionBackend;
  width: number;
  height: number;
  revision?: number;
  capabilities: ImageEditExecutionCapabilities;
  diagnostics?: ImageEditExecutionDiagnostics;
}

export interface ImageEditPreviewExecutionResult extends ImageEditExecutionResultBase {
  kind: 'preview-frame';
  frame: ImageBitmap | string;
  /** 旧宿主读取图片 URL 的兼容影子；新调用方应读取 frame。 */
  outputImageUrl?: string;
}

export type ImageEditEncodedOutput =
  | { kind: 'bytes'; bytes: Uint8Array; format: ImageEditEncodedFormat }
  | { kind: 'url'; url: string; format?: ImageEditEncodedFormat };

export interface ImageEditExportExecutionResult extends ImageEditExecutionResultBase {
  kind: 'encoded-export';
  output: ImageEditEncodedOutput;
  /** 旧宿主读取图片 URL 的兼容影子；编码字节结果不提供该字段。 */
  outputImageUrl?: string;
}

export type ImageEditExecutionResult =
  | ImageEditPreviewExecutionResult
  | ImageEditExportExecutionResult;

export interface ImageEditDocumentExecutor {
  id: string;
  backend?: ImageEditExecutionBackend;
  supportedOperationIds?: readonly string[];
  execute: (request: ImageEditExecutionRequest) => Promise<string>;
  cancel?: (requestId: string) => Promise<void>;
  getCapabilities?: () => ImageEditExecutionCapabilities;
}

export interface ImageEditExecutionPort {
  execute: (request: ImageEditExecutionRequest) => Promise<ImageEditExecutionResult>;
  cancel?: (requestId: string) => Promise<void>;
  getCapabilities?: () => ImageEditExecutionCapabilities;
}

export interface ImageEditExecutionCapabilities {
  executorId: string;
  backends: readonly ImageEditExecutionBackend[];
  supportedOperationIds: readonly string[];
  purposes: readonly ImageEditRenderPurpose[];
  qualities: readonly ImageEditRenderQuality[];
  exportFormats: readonly ImageEditEncodedFormat[];
  hardCancellationSupported: boolean;
  fallback?: {
    backend: Extract<ImageEditExecutionBackend, 'sharp'>;
    unsupportedParameters: readonly string[];
    hardCancellationSupported: false;
  };
}

export function createImageEditExecutionPort(
  operationRegistry: ImageEditOperationRegistry,
  executor: ImageEditDocumentExecutor
): ImageEditExecutionPort {
  const defaultCapabilities = (): ImageEditExecutionCapabilities => ({
    executorId: executor.id,
    backends: [executor.backend ?? (
      executor.id === 'browser-canvas' ? 'browser-canvas' : 'webgpu-worker'
    )],
    supportedOperationIds: executor.supportedOperationIds
      ?? operationRegistry.list().map((definition) => definition.id),
    purposes: ['preview', 'export'],
    qualities: ['realtime', 'high'],
    exportFormats: ['image/png', 'image/jpeg', 'image/webp'],
    hardCancellationSupported: Boolean(executor.cancel),
  });
  return {
    execute: async (request): Promise<ImageEditExecutionResult> => {
      const document = operationRegistry.validateDocument(request.document);
      const outputImageUrl = await executor.execute({ ...request, document });
      const backend = executor.backend ?? (
        executor.id === 'browser-canvas' ? 'browser-canvas' : 'webgpu-worker'
      );
      const capabilities = executor.getCapabilities?.() ?? defaultCapabilities();
      if (request.purpose === 'preview') {
        const result: ImageEditPreviewExecutionResult = {
          kind: 'preview-frame',
          frame: outputImageUrl,
          outputImageUrl,
          document,
          executorId: executor.id,
          backend,
          width: 0,
          height: 0,
          capabilities,
        };
        if (request.revision !== undefined) result.revision = request.revision;
        return result;
      }
      const result: ImageEditExportExecutionResult = {
        kind: 'encoded-export',
        output: { kind: 'url', url: outputImageUrl },
        outputImageUrl,
        document,
        executorId: executor.id,
        backend,
        width: 0,
        height: 0,
        capabilities,
      };
      if (request.revision !== undefined) result.revision = request.revision;
      return result;
    },
    cancel: executor.cancel,
    getCapabilities: executor.getCapabilities ?? defaultCapabilities,
  };
}
