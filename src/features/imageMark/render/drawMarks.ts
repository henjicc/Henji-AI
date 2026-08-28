import { WHITE_HEX } from '@/core/theme/colorTokens';
import {
  MARK_FONT_FAMILY,
  MARK_FONT_STYLE,
  TEXT_LINE_HEIGHT,
  numberBadgeRadius,
  resolveLabelConnector,
  resolveLabelFontSize,
  resolveLabelPlacement,
  resolveMosaicBlurRadius,
  resolveMosaicPixelSize,
  resolveTextBackgroundPadding,
  resolveTextBaseSize,
  resolveTextBlockSize,
} from '../domain/metrics';
import type { LabeledMark, MarkItem } from '../domain/types';
import { resolveArrowHeadPoints } from '../domain/arrowGeometry';
import { tracePenPath } from './tracePenPath';
import { buildMosaicSource, drawBlurRegion, drawMosaicRegion } from './orientedImage';
import type { ImageEditCanvas, ImageEditCanvasContext } from './canvasAdapter';

function markFont(fontSize: number): string {
  return `${MARK_FONT_STYLE} ${fontSize}px ${MARK_FONT_FAMILY}`;
}

function drawArrowHead(context: ImageEditCanvasContext, points: number[], color: string): void {
  context.beginPath();
  context.moveTo(points[0], points[1]);
  context.lineTo(points[2], points[3]);
  context.lineTo(points[4], points[5]);
  context.closePath();
  context.fillStyle = color;
  context.fill();
}

function drawTextBlock(
  context: ImageEditCanvasContext,
  text: string,
  x: number,
  y: number,
  fontSize: number,
  color: string,
  backgroundColor?: string
): void {
  context.font = markFont(fontSize);
  context.textBaseline = 'top';
  context.textAlign = 'left';
  const lineHeight = Math.max(1, Math.round(fontSize * TEXT_LINE_HEIGHT));
  const lines = text.split('\n');
  if (backgroundColor) {
    const padding = resolveTextBackgroundPadding(fontSize);
    const size = resolveTextBlockSize(text, fontSize);
    context.fillStyle = backgroundColor;
    context.fillRect(
      x - padding,
      y - padding,
      size.width + padding * 2,
      size.height + padding * 2
    );
  }
  context.fillStyle = color;
  lines.forEach((line, index) => context.fillText(line, x, y + index * lineHeight));
}

function drawLabel(context: ImageEditCanvasContext, item: LabeledMark, imageWidth: number, imageHeight: number): void {
  if (!item.label) return;
  const fontSize = resolveLabelFontSize(item, resolveTextBaseSize(imageWidth, imageHeight));
  const placement = resolveLabelPlacement(item, imageWidth, imageHeight);
  const connector = resolveLabelConnector(item, imageWidth, imageHeight);
  if (connector) {
    context.save();
    context.strokeStyle = item.stroke;
    context.lineWidth = item.lineWidth;
    context.beginPath();
    context.moveTo(connector.x1, connector.y1);
    context.lineTo(connector.x2, connector.y2);
    context.stroke();
    context.restore();
  }
  context.save();
  drawTextBlock(
    context,
    item.label,
    placement.x,
    placement.y,
    fontSize,
    item.stroke,
    item.labelBackgroundColor
  );
  context.restore();
}

function drawNumberBadge(context: ImageEditCanvasContext, x: number, y: number, value: number, color: string, fontSize: number): void {
  const radius = numberBadgeRadius(fontSize);
  context.save();
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fillStyle = color;
  context.fill();
  context.font = markFont(fontSize);
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = WHITE_HEX;
  context.fillText(String(value), x, y);
  context.restore();
}

/** 计算每个序号项的显示数字：按 items 中同类项顺序递增。 */
export function resolveNumberValues(items: MarkItem[]): Map<string, number> {
  const values = new Map<string, number>();
  let counter = 0;
  for (const item of items) {
    if (item.type === 'number') {
      counter += 1;
      values.set(item.id, counter);
    }
  }
  return values;
}

export interface DrawMarksOptions {
  /** 生成打码取样源所用的原位图(通常即被绘制的画布本身)。 */
  baseCanvas?: ImageEditCanvas;
  canvasKind?: 'dom' | 'offscreen';
}

/** 把标记项光栅化到 2D 上下文，坐标为当前朝向图片像素。 */
export function drawMarkItems(
  context: ImageEditCanvasContext,
  items: MarkItem[],
  imageWidth: number,
  imageHeight: number,
  options: DrawMarksOptions = {}
): void {
  const numberValues = resolveNumberValues(items);
  const mosaicSources = new Map<number, ImageEditCanvas>();
  const getMosaicSource = (pixelSize: number): ImageEditCanvas | null => {
    if (!options.baseCanvas) return null;
    let source = mosaicSources.get(pixelSize) ?? null;
    if (!source) {
      source = buildMosaicSource(options.baseCanvas, pixelSize, options.canvasKind ?? 'dom');
      mosaicSources.set(pixelSize, source);
    }
    return source;
  };

  for (const item of items) {
    if (item.type === 'mosaic') {
      if (item.mode === 'blur') {
        if (options.baseCanvas) drawBlurRegion(context, options.baseCanvas, resolveMosaicBlurRadius(imageWidth, imageHeight, item.strengthPercent), item);
        continue;
      }
      const mosaicSource = getMosaicSource(resolveMosaicPixelSize(imageWidth, imageHeight, item.strengthPercent));
      if (mosaicSource) {
        context.save();
        drawMosaicRegion(context, mosaicSource, resolveMosaicPixelSize(imageWidth, imageHeight, item.strengthPercent), item);
        context.restore();
      }
      continue;
    }
    if (item.type === 'rect') {
      context.save(); context.strokeStyle = item.stroke; context.lineWidth = item.lineWidth;
      context.strokeRect(item.x, item.y, item.width, item.height); context.restore();
      drawLabel(context, item, imageWidth, imageHeight); continue;
    }
    if (item.type === 'ellipse') {
      context.save(); context.strokeStyle = item.stroke; context.lineWidth = item.lineWidth;
      context.beginPath(); context.ellipse(item.x + item.width / 2, item.y + item.height / 2, Math.max(1, item.width / 2), Math.max(1, item.height / 2), 0, 0, Math.PI * 2);
      context.stroke(); context.restore(); drawLabel(context, item, imageWidth, imageHeight); continue;
    }
    if (item.type === 'arrow') {
      const [x1, y1, x2, y2] = item.points;
      context.save(); context.strokeStyle = item.stroke; context.lineWidth = item.lineWidth;
      context.lineCap = 'round'; context.lineJoin = 'round';
      context.beginPath(); context.moveTo(x1, y1);
      if (item.curveControl) {
        context.quadraticCurveTo(item.curveControl[0], item.curveControl[1], x2, y2);
      } else {
        context.lineTo(x2, y2);
      }
      context.stroke();
      drawArrowHead(context, resolveArrowHeadPoints(item), item.stroke); context.restore(); drawLabel(context, item, imageWidth, imageHeight); continue;
    }
    if (item.type === 'pen') {
      context.save(); context.strokeStyle = item.stroke; context.lineWidth = item.lineWidth; context.lineJoin = 'round'; context.lineCap = 'round';
      tracePenPath(context, item.points);
      context.stroke(); context.restore(); continue;
    }
    if (item.type === 'text') {
      context.save(); drawTextBlock(
        context,
        item.text,
        item.x,
        item.y,
        item.fontSize,
        item.color,
        item.backgroundColor
      ); context.restore(); continue;
    }
    if (item.type === 'number') drawNumberBadge(context, item.x, item.y, numberValues.get(item.id) ?? 0, item.color, item.fontSize);
  }
}
