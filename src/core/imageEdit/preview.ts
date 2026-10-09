export type ImagePreviewMime = 'image/jpeg' | 'image/png' | 'image/webp';

export interface ImagePreviewPlan {
  width: number;
  height: number;
  mime: ImagePreviewMime;
  quality?: number;
}

/** 预览缩放与编码参数的唯一纯计算；只缩小，并保留至少一个像素。 */
export function createImagePreviewPlan(
  width: number,
  height: number,
  maxDimension: number,
  mime: ImagePreviewMime
): ImagePreviewPlan {
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    mime,
    ...(mime === 'image/jpeg' ? { quality: 0.86 } : {}),
  };
}

/** 无 Store/宿主依赖的共享光栅化边界；mime 由消费方决定。 */
export function renderImagePreviewDataUrl(
  image: HTMLImageElement,
  sourceDataUrl: string,
  maxDimension: number,
  mime: ImagePreviewMime
): string {
  if (Math.max(image.naturalWidth, image.naturalHeight) <= maxDimension) return sourceDataUrl;
  const { width, height, quality } = createImagePreviewPlan(image.naturalWidth, image.naturalHeight, maxDimension, mime);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return sourceDataUrl;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, width, height);
  return quality === undefined ? canvas.toDataURL(mime) : canvas.toDataURL(mime, quality);
}
