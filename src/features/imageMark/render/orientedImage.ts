import type { MarkOrientation } from '../domain/types';
import { orientedSize } from '../domain/geometry';
import {
  createImageEditCanvas,
  getImageEditCanvasSourceSize,
  type ImageEditCanvas,
  type ImageEditCanvasContext,
  type ImageEditCanvasKind,
  type ImageEditCanvasSource,
} from './canvasAdapter';

/** 按朝向(先镜像后旋转)渲染 DOM 图片，保留旧调用签名。 */
export function renderOrientedCanvas(
  image: HTMLImageElement | HTMLCanvasElement,
  orientation: MarkOrientation
): HTMLCanvasElement {
  return renderOrientedImage(image, orientation, 'dom') as HTMLCanvasElement;
}

/** DOM 与 Worker 共用的朝向光栅化实现。 */
export function renderOrientedImage(
  image: ImageEditCanvasSource,
  orientation: MarkOrientation,
  canvasKind: ImageEditCanvasKind
): ImageEditCanvas {
  const { width: sourceWidth, height: sourceHeight } = getImageEditCanvasSourceSize(image);
  const { width, height } = orientedSize(sourceWidth, sourceHeight, orientation);
  const { canvas, context } = createImageEditCanvas(width, height, canvasKind);
  context.save();
  context.translate(width / 2, height / 2);
  context.rotate((orientation.rotate * Math.PI) / 180);
  if (orientation.mirrored) context.scale(-1, 1);
  context.drawImage(image, -sourceWidth / 2, -sourceHeight / 2, sourceWidth, sourceHeight);
  context.restore();
  return canvas;
}

/** 生成马赛克取样源，保留 DOM 旧调用签名。 */
export function buildMosaicSourceCanvas(
  oriented: HTMLCanvasElement,
  pixelSize: number
): HTMLCanvasElement {
  return buildMosaicSource(oriented, pixelSize, 'dom') as HTMLCanvasElement;
}

export function buildMosaicSource(
  oriented: ImageEditCanvas,
  pixelSize: number,
  canvasKind: ImageEditCanvasKind
): ImageEditCanvas {
  const factor = Math.max(1, pixelSize);
  const { canvas, context } = createImageEditCanvas(
    Math.max(1, Math.ceil(oriented.width / factor)),
    Math.max(1, Math.ceil(oriented.height / factor)),
    canvasKind
  );
  context.imageSmoothingEnabled = true;
  context.drawImage(oriented, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** 高斯模糊模式：从原位图取区域，经 Canvas filter 模糊后绘制。 */
export function drawBlurRegion(
  context: ImageEditCanvasContext,
  source: ImageEditCanvas,
  blurRadius: number,
  rect: { x: number; y: number; width: number; height: number },
  destX = rect.x,
  destY = rect.y
): void {
  if (rect.width < 1 || rect.height < 1) return;
  context.save();
  context.beginPath();
  context.rect(destX, destY, rect.width, rect.height);
  context.clip();
  context.filter = `blur(${Math.max(1, blurRadius)}px)`;
  const pad = blurRadius * 2;
  context.drawImage(
    source,
    rect.x - pad,
    rect.y - pad,
    rect.width + pad * 2,
    rect.height + pad * 2,
    destX - pad,
    destY - pad,
    rect.width + pad * 2,
    rect.height + pad * 2
  );
  context.restore();
}

/** 从马赛克取样源绘制一块区域到目标上下文。 */
export function drawMosaicRegion(
  context: ImageEditCanvasContext,
  mosaicSource: ImageEditCanvas,
  pixelSize: number,
  rect: { x: number; y: number; width: number; height: number },
  destX = rect.x,
  destY = rect.y
): void {
  const factor = Math.max(1, pixelSize);
  const previousSmoothing = context.imageSmoothingEnabled;
  context.imageSmoothingEnabled = false;
  context.drawImage(
    mosaicSource,
    rect.x / factor,
    rect.y / factor,
    Math.max(1, rect.width / factor),
    Math.max(1, rect.height / factor),
    destX,
    destY,
    rect.width,
    rect.height
  );
  context.imageSmoothingEnabled = previousSmoothing;
}
