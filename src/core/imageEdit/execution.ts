import type { ImageEditDocument } from './types';
import type { ImageEditOperationRegistry } from './operations';

export type ImageEditRenderPurpose = 'preview' | 'export';
export type ImageEditRenderQuality = 'realtime' | 'high';

export interface ImageEditExecutionRequest {
  sourceImageUrl: string;
  document: ImageEditDocument;
  requestId?: string;
  purpose?: ImageEditRenderPurpose;
  quality?: ImageEditRenderQuality;
  maxDimension?: number;
  revision?: number;
}

export interface ImageEditExecutionResult {
  outputImageUrl: string;
  document: ImageEditDocument;
  executorId: string;
  backend?: 'webgpu' | 'native-gpu' | 'native-cpu' | 'browser-canvas';
  width?: number;
  height?: number;
  revision?: number;
}

export interface ImageEditDocumentExecutor {
  id: string;
  supportedOperationIds?: readonly string[];
  execute: (request: ImageEditExecutionRequest) => Promise<string>;
  cancel?: (requestId: string) => Promise<void>;
}

export interface ImageEditExecutionPort {
  execute: (request: ImageEditExecutionRequest) => Promise<ImageEditExecutionResult>;
  cancel?: (requestId: string) => Promise<void>;
  getCapabilities?: () => ImageEditExecutionCapabilities;
}

export interface ImageEditExecutionCapabilities {
  executorId: string;
  supportedOperationIds: readonly string[];
  purposes: readonly ImageEditRenderPurpose[];
}

export function createImageEditExecutionPort(
  operationRegistry: ImageEditOperationRegistry,
  executor: ImageEditDocumentExecutor
): ImageEditExecutionPort {
  return {
    execute: async (request): Promise<ImageEditExecutionResult> => {
      const document = operationRegistry.validateDocument(request.document);
      const outputImageUrl = await executor.execute({ ...request, document });
      const result: ImageEditExecutionResult = {
        outputImageUrl,
        document,
        executorId: executor.id,
      };
      if (request.revision !== undefined) result.revision = request.revision;
      if (executor.id === 'browser-canvas') result.backend = 'browser-canvas';
      return result;
    },
    cancel: executor.cancel,
    getCapabilities: (): ImageEditExecutionCapabilities => ({
      executorId: executor.id,
      supportedOperationIds: executor.supportedOperationIds ?? operationRegistry.list().map((definition) => definition.id),
      purposes: ['preview', 'export'],
    }),
  };
}
