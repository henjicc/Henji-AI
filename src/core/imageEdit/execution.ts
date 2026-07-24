import type { ImageEditDocument } from './types';
import type { ImageEditOperationRegistry } from './operations';

export interface ImageEditExecutionRequest {
  sourceImageUrl: string;
  document: ImageEditDocument;
  requestId?: string;
}

export interface ImageEditExecutionResult {
  outputImageUrl: string;
  document: ImageEditDocument;
  executorId: string;
}

export interface ImageEditDocumentExecutor {
  id: string;
  execute: (request: ImageEditExecutionRequest) => Promise<string>;
}

export interface ImageEditExecutionPort {
  execute: (request: ImageEditExecutionRequest) => Promise<ImageEditExecutionResult>;
}

export function createImageEditExecutionPort(
  operationRegistry: ImageEditOperationRegistry,
  executor: ImageEditDocumentExecutor
): ImageEditExecutionPort {
  return {
    execute: async (request): Promise<ImageEditExecutionResult> => {
      const document = operationRegistry.validateDocument(request.document);
      const outputImageUrl = await executor.execute({ ...request, document });
      return { outputImageUrl, document, executorId: executor.id };
    },
  };
}
