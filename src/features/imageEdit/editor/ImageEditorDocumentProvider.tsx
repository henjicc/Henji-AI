import type { ReactNode } from 'react';
import { ImageEditorDocumentContext, type ImageEditDocumentController } from './ImageEditorDocumentContext';

export interface ImageEditorDocumentProviderProps {
  controller: ImageEditDocumentController;
  children: ReactNode;
}

export function ImageEditorDocumentProvider({ controller, children }: ImageEditorDocumentProviderProps): JSX.Element {
  return <ImageEditorDocumentContext.Provider value={controller}>{children}</ImageEditorDocumentContext.Provider>;
}
