import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes';
import type { ImageEditSelectionSessionV3 } from '@/core/imageEdit/v3/selection/session';
import type { ImageEditTileCoordinate } from '@/core/imageEdit/v3/tileGeometry';
import { invertAnnotationMatrixV3, multiplyAnnotationMatricesV3, resolveAnnotationOutputGeometryV3, type AnnotationMatrixV3 } from '../../editor/annotationGeometryV3';
import { ImageEditSelectionRasterClientV3 } from '../../execution/selectionRasterClientV3';

export function createPaintSelectionClip(document: ImageEditDocumentV3, selection: ImageEditSelectionSessionV3 | null, matrix: AnnotationMatrixV3,
  storageSize: (signal: AbortSignal) => Promise<{ width: number; height: number }>): {
    read: ((coordinate: ImageEditTileCoordinate, signal: AbortSignal) => Promise<Float32Array>) | undefined; dispose: () => void;
  } {
  let raster: ImageEditSelectionRasterClientV3 | null = null;
  const sourceMatrix = multiplyAnnotationMatricesV3(invertAnnotationMatrixV3(resolveAnnotationOutputGeometryV3(document).sourceToOutput), matrix);
  return {
    read: selection ? async (coordinate, signal) => {
      const size = await storageSize(signal);
      const x = coordinate.x * 512, y = coordinate.y * 512;
      raster ??= new ImageEditSelectionRasterClientV3();
      return raster.rasterize({ selection, size: document.geometry, matrix: sourceMatrix,
        region: { x, y, width: Math.min(512, size.width - x), height: Math.min(512, size.height - y) } }, signal);
    } : undefined,
    dispose: () => raster?.dispose(),
  };
}
