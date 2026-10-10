import { useEffect, useRef, useState } from 'react';
import { createFloat32PremultipliedRgbaTile } from '@/core/imageEdit/v3/effects/contracts';
import type { ImageEditSize } from '@/core/imageEdit/v3/tileGeometry';
import type { ImageEditBrushTileLoaderV3 } from '@/core/imageEdit/v3/brush/contracts';
import { linearPreviewTileToImageDataV3 } from '../../execution/previewPixelsV3';
import { annotationMatrixToSvgV3, type AnnotationMatrixV3 } from '../../editor/annotationGeometryV3';
import { readRetouchRegion } from './source';
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes';

/** A hover-only, cancellable donor overlay; the immutable source and actual stroke stay independent. */
export function RetouchSourcePreview({ load, size, source, destination, diameter, matrix, document, onError }: {
  load: ImageEditBrushTileLoaderV3; size: (signal: AbortSignal) => Promise<ImageEditSize>;
  source: readonly [number, number]; destination: readonly [number, number]; diameter: number;
  matrix: AnnotationMatrixV3; document: ImageEditDocumentV3; onError: (error: unknown) => void;
}): JSX.Element | null {
  const canvas = useRef<HTMLCanvasElement>(null), [image, setImage] = useState<ImageData | null>(null);
  // The source preview has its own bounded display budget; it is never used as editing pixels.
  const pixels = Math.max(1, Math.min(256, Math.ceil(diameter)));
  const [sourceX, sourceY] = source;
  useEffect(() => {
    const abort = new AbortController(); setImage(null);
    const timer = setTimeout(() => { void (async () => {
      const grid = await size(abort.signal), sampled = await readRetouchRegion(load, grid,
        { x: Math.floor(sourceX - pixels / 2), y: Math.floor(sourceY - pixels / 2), width: pixels, height: pixels }, abort.signal);
      abort.signal.throwIfAborted();
      setImage(linearPreviewTileToImageDataV3(createFloat32PremultipliedRgbaTile(pixels, pixels, 'linear-light', sampled.data, document.color.workingSpace, document.color.transferFunction, document.color.hdrMetadata?.referenceWhiteNits ?? 203)));
    })().catch(error => { if (!abort.signal.aborted) onError(error); }) }, 80);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [load, size, sourceX, sourceY, pixels, document, onError]);
  useEffect(() => { if (image) canvas.current?.getContext('2d')?.putImageData(image, 0, 0); }, [image]);
  if (!image) return null;
  return <g pointerEvents="none" transform={annotationMatrixToSvgV3(matrix)} data-retouch-donor-preview>
    <foreignObject x={destination[0] - pixels / 2} y={destination[1] - pixels / 2} width={pixels} height={pixels}>
      <canvas ref={canvas} width={pixels} height={pixels} className="h-full w-full rounded-full opacity-40" />
    </foreignObject>
  </g>;
}
