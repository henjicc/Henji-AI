import type { ImageEditDocumentV3 } from '../documentTypes';
import type { ImageEditRasterLayerV3 } from '../layerTypes';

/** Origin is a managed business identity, never a raw path or URL. */
export interface ImageEditSmartOriginV3 {
  kind: 'image_edit.document' | 'canvas.node' | 'generation.result' | 'asset';
  id: string;
  revision?: number;
}

export interface ImageEditSmartContentV3 {
  /** Shared content identity. Duplicating an instance keeps this identity. */
  id: string;
  origin: ImageEditSmartOriginV3 | null;
  document: ImageEditDocumentV3;
  /** Native, oriented/cropped presentation grid; no viewport dimensions. */
  width: number;
  height: number;
}

/** Source/tiles are a derived appearance; content.document preserves editable originals. */
export interface ImageEditSmartLayerV3 extends Omit<ImageEditRasterLayerV3, 'type'> {
  type: 'smart';
  content: ImageEditSmartContentV3;
}
