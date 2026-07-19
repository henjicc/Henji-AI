import type { MarkOrientation } from '../domain/types';
import { orientedSize } from '../domain/geometry';

function create2dCanvas(width: number, height: number): {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
} {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('无法初始化画布');
  }
  return { canvas, context };
}

/**
 * 按朝向(先镜像后旋转)把原图渲染到离屏画布。
 * 返回的画布即"当前朝向坐标系"的位图,编辑器显示与导出共用。
 */
export function renderOrientedCanvas(
  image: HTMLImageElement | HTMLCanvasElement,
  orientation: MarkOrientation
): HTMLCanvasElement {
  const sourceWidth = image instanceof HTMLImageElement ? image.naturalWidth : image.width;
  const sourceHeight = image instanceof HTMLImageElement ? image.naturalHeight : image.height;
  const { width, height } = orientedSize(sourceWidth, sourceHeight, orientation);
  const { canvas, context } = create2dCanvas(width, height);

  context.save();
  context.translate(width / 2, height / 2);
  context.rotate((orientation.rotate * Math.PI) / 180);
  if (orientation.mirrored) {
    context.scale(-1, 1);
  }
  context.drawImage(image, -sourceWidth / 2, -sourceHeight / 2, sourceWidth, sourceHeight);
  context.restore();

  return canvas;
}

/**
 * 生成马赛克取样源:整图按 pixelSize 缩小一次。
 * 绘制马赛克区域时从这里放大取样(关闭平滑),避免逐块计算。
 */
export function buildMosaicSourceCanvas(
  oriented: HTMLCanvasElement,
  pixelSize: number
): HTMLCanvasElement {
  const factor = Math.max(1, pixelSize);
  const { canvas, context } = create2dCanvas(
    Math.max(1, Math.ceil(oriented.width / factor)),
    Math.max(1, Math.ceil(oriented.height / factor))
  );
  context.imageSmoothingEnabled = true;
  context.drawImage(oriented, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** 从马赛克取样源绘制一块区域到目标上下文(目标坐标 = 朝向坐标) */
export function drawMosaicRegion(
  context: CanvasRenderingContext2D,
  mosaicSource: HTMLCanvasElement,
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
