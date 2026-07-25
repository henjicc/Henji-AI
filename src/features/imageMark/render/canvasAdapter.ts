export type ImageEditCanvas = HTMLCanvasElement | OffscreenCanvas;
export type ImageEditCanvasContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type ImageEditCanvasSource = CanvasImageSource & { width?: number; height?: number };
export type ImageEditCanvasKind = 'dom' | 'offscreen';

export interface ImageEditCanvasTarget {
  canvas: ImageEditCanvas;
  context: ImageEditCanvasContext;
}

export function createImageEditCanvas(
  width: number,
  height: number,
  kind: ImageEditCanvasKind = 'dom'
): ImageEditCanvasTarget {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  const canvas: ImageEditCanvas = kind === 'offscreen'
    ? new OffscreenCanvas(safeWidth, safeHeight)
    : document.createElement('canvas');
  if (kind === 'dom') {
    canvas.width = safeWidth;
    canvas.height = safeHeight;
  }
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法初始化画布');
  return { canvas, context };
}

export function getImageEditCanvasSourceSize(source: ImageEditCanvasSource): { width: number; height: number } {
  if (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement) {
    return { width: source.naturalWidth, height: source.naturalHeight };
  }
  if (typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement) {
    return { width: source.videoWidth, height: source.videoHeight };
  }
  const width = 'width' in source && typeof source.width === 'number' ? source.width : 0;
  const height = 'height' in source && typeof source.height === 'number' ? source.height : 0;
  if (width <= 0 || height <= 0) throw new Error('无法读取图片尺寸');
  return { width, height };
}
