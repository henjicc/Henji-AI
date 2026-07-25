import { createContext, useContext } from 'react';
import type { ImageEditDocument, ImageEditOperation } from '@/core/imageEdit';

export interface ImageEditDocumentController {
  document: ImageEditDocument;
  getOperation: <TParams extends object = object>(operationId: string) => ImageEditOperation<TParams> | null;
  beginTransaction: () => void;
  updateOperation: <TParams extends object>(operationId: string, update: (params: TParams) => TParams) => void;
  setOperationEnabled: (operationId: string, enabled: boolean) => void;
  resetOperation: (operationId: string) => void;
  removeOperation: (operationId: string) => void;
  commitTransaction: () => void;
  cancelTransaction: () => void;
  previewState?: ImageEditorPreviewState;
}

export interface ImageEditorPreviewState {
  phase: 'idle' | 'compiling' | 'rendering' | 'degraded' | 'failed';
  backend?: 'webgpu-worker' | 'sharp' | 'browser-canvas';
  message?: string;
}

export const ImageEditorDocumentContext = createContext<ImageEditDocumentController | null>(null);

export function useImageEditorDocumentController(): ImageEditDocumentController {
  const controller = useContext(ImageEditorDocumentContext);
  if (!controller) throw new Error('图片编辑检查器必须位于 ImageEditorDocumentProvider 内');
  return controller;
}
