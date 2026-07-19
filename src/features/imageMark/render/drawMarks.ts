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
  resolveTextBaseSize,
} from '../domain/metrics';
import type { LabeledMark, MarkItem } from '../domain/types';
import { buildMosaicSourceCanvas, drawBlurRegion, drawMosaicRegion } from './orientedImage';

function markFont(fontSize: number): string {
  return `${MARK_FONT_STYLE} ${fontSize}px ${MARK_FONT_FAMILY}`;
}

function drawArrowHead(
  context: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  lineWidth: number
): void {
  const headLength = Math.max(10, lineWidth * 4);
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const leftX = x2 - headLength * Math.cos(angle - Math.PI / 6);
  const leftY = y2 - headLength * Math.sin(angle - Math.PI / 6);
  const rightX = x2 - headLength * Math.cos(angle + Math.PI / 6);
  const rightY = y2 - headLength * Math.sin(angle + Math.PI / 6);

  context.beginPath();
  context.moveTo(x2, y2);
  context.lineTo(leftX, leftY);
  context.lineTo(rightX, rightY);
  context.closePath();
  context.fillStyle = color;
  context.fill();
}

function drawTextBlock(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fontSize: number,
  color: string
): void {
  context.font = markFont(fontSize);
  context.textBaseline = 'top';
  context.textAlign = 'left';
  const lines = text.split('\n');
  const lineHeight = Math.max(1, Math.round(fontSize * TEXT_LINE_HEIGHT));
  // 轻微投影提升亮背景上的可读性(像素绘制例外区)
  context.shadowColor = 'rgba(0, 0, 0, 0.55)';
  context.shadowBlur = Math.max(1, fontSize * 0.08);
  context.shadowOffsetY = Math.max(1, Math.round(fontSize * 0.04));
  context.fillStyle = color;
  lines.forEach((line, index) => {
    context.fillText(line, x, y + index * lineHeight);
  });
}

function drawLabel(
  context: CanvasRenderingContext2D,
  item: LabeledMark,
  imageWidth: number,
  imageHeight: number
): void {
  if (!item.label) {
    return;
  }
  const baseSize = resolveTextBaseSize(imageWidth, imageHeight);
  const fontSize = resolveLabelFontSize(item, baseSize);
  const placement = resolveLabelPlacement(item, imageWidth, imageHeight);

  // 标签被拖离图形后画引导线
  const connector = resolveLabelConnector(item, imageWidth, imageHeight);
  if (connector) {
    context.save();
    context.strokeStyle = item.stroke;
    context.lineWidth = Math.max(1, item.lineWidth * 0.5);
    context.beginPath();
    context.moveTo(connector.x1, connector.y1);
    context.lineTo(connector.x2, connector.y2);
    context.stroke();
    context.restore();
  }

  context.save();
  drawTextBlock(context, item.label, placement.x, placement.y, fontSize, item.stroke);
  context.restore();
}

function drawNumberBadge(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  value: number,
  color: string,
  fontSize: number
): void {
  const radius = numberBadgeRadius(fontSize);
  context.save();
  context.shadowColor = 'rgba(0, 0, 0, 0.4)';
  context.shadowBlur = Math.max(2, radius * 0.25);
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fillStyle = color;
  context.fill();
  context.shadowColor = 'transparent';
  context.shadowBlur = 0;
  context.font = markFont(fontSize);
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = WHITE_HEX;
  context.fillText(String(value), x, y);
  context.restore();
}

/** 计算每个序号项的显示数字:按 items 中同类项顺序递增 */
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
  /** 生成打码取样源所用的原位图(通常即被绘制的画布本身) */
  baseCanvas?: HTMLCanvasElement;
}

/**
 * 把标记项光栅化到 2D 上下文,坐标为当前朝向图片像素。
 * 编辑器所见与此实现一一对应。
 */
export function drawMarkItems(
  context: CanvasRenderingContext2D,
  items: MarkItem[],
  imageWidth: number,
  imageHeight: number,
  options: DrawMarksOptions = {}
): void {
  const numberValues = resolveNumberValues(items);
  // 打码取样源按像素块尺寸缓存,同强度的块共用一份
  const mosaicSources = new Map<number, HTMLCanvasElement>();
  const getMosaicSource = (pixelSize: number): HTMLCanvasElement | null => {
    if (!options.baseCanvas) {
      return null;
    }
    let source = mosaicSources.get(pixelSize) ?? null;
    if (!source) {
      source = buildMosaicSourceCanvas(options.baseCanvas, pixelSize);
      mosaicSources.set(pixelSize, source);
    }
    return source;
  };

  for (const item of items) {
    if (item.type === 'mosaic') {
      if (item.mode === 'blur') {
        if (options.baseCanvas) {
          drawBlurRegion(
            context,
            options.baseCanvas,
            resolveMosaicBlurRadius(imageWidth, imageHeight, item.strengthPercent),
            item
          );
        }
        continue;
      }
      const pixelSize = resolveMosaicPixelSize(imageWidth, imageHeight, item.strengthPercent);
      const mosaicSource = getMosaicSource(pixelSize);
      if (mosaicSource) {
        context.save();
        drawMosaicRegion(context, mosaicSource, pixelSize, item);
        context.restore();
      }
      continue;
    }

    if (item.type === 'rect') {
      context.save();
      context.strokeStyle = item.stroke;
      context.lineWidth = item.lineWidth;
      context.strokeRect(item.x, item.y, item.width, item.height);
      context.restore();
      drawLabel(context, item, imageWidth, imageHeight);
      continue;
    }

    if (item.type === 'ellipse') {
      context.save();
      context.strokeStyle = item.stroke;
      context.lineWidth = item.lineWidth;
      context.beginPath();
      context.ellipse(
        item.x + item.width / 2,
        item.y + item.height / 2,
        Math.max(1, item.width / 2),
        Math.max(1, item.height / 2),
        0,
        0,
        Math.PI * 2
      );
      context.stroke();
      context.restore();
      drawLabel(context, item, imageWidth, imageHeight);
      continue;
    }

    if (item.type === 'arrow') {
      const [x1, y1, x2, y2] = item.points;
      context.save();
      context.strokeStyle = item.stroke;
      context.lineWidth = item.lineWidth;
      context.beginPath();
      context.moveTo(x1, y1);
      context.lineTo(x2, y2);
      context.stroke();
      drawArrowHead(context, x1, y1, x2, y2, item.stroke, item.lineWidth);
      context.restore();
      drawLabel(context, item, imageWidth, imageHeight);
      continue;
    }

    if (item.type === 'pen') {
      context.save();
      context.strokeStyle = item.stroke;
      context.lineWidth = item.lineWidth;
      context.lineJoin = 'round';
      context.lineCap = 'round';
      context.beginPath();
      context.moveTo(item.points[0], item.points[1]);
      for (let index = 2; index < item.points.length; index += 2) {
        context.lineTo(item.points[index], item.points[index + 1]);
      }
      context.stroke();
      context.restore();
      continue;
    }

    if (item.type === 'text') {
      context.save();
      drawTextBlock(context, item.text, item.x, item.y, item.fontSize, item.color);
      context.restore();
      continue;
    }

    if (item.type === 'number') {
      drawNumberBadge(
        context,
        item.x,
        item.y,
        numberValues.get(item.id) ?? 0,
        item.color,
        item.fontSize
      );
    }
  }
}
