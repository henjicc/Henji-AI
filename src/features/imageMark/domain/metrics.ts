import { clamp, getPointsBounds, labelRefPoint } from './geometry';
import type { LabeledMark } from './types';

export { labelRefPoint };

/**
 * 编辑器(Konva)与光栅化导出共用的度量函数。
 * 两侧必须使用同一份计算,保证所见即所得。
 */

export const DEFAULT_TEXT_SIZE_PERCENT = 10;
export const MIN_TEXT_SIZE_PERCENT = 1;
export const MAX_TEXT_SIZE_PERCENT = 30;
export const DEFAULT_LINE_WIDTH_PERCENT = 0.4;
export const MIN_LINE_WIDTH_PERCENT = 0.1;
export const MAX_LINE_WIDTH_PERCENT = 3;
export const TEXT_LINE_HEIGHT = 1.2;
export const TEXT_BACKGROUND_PADDING_RATIO = 0.2;
export const MARK_FONT_FAMILY = 'sans-serif';
export const MARK_FONT_STYLE = '600';

export function resolveTextBaseSize(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 1000;
  }
  return Math.max(320, Math.min(width, height));
}

export function percentToFontSize(percent: number, baseSize: number): number {
  return Math.max(10, Math.round(baseSize * (percent / 100)));
}

export function fontSizeToPercent(fontSize: number, baseSize: number): number {
  if (!Number.isFinite(fontSize) || fontSize <= 0) {
    return DEFAULT_TEXT_SIZE_PERCENT;
  }
  return (fontSize / Math.max(1, baseSize)) * 100;
}

export function percentToLineWidth(percent: number, baseSize: number): number {
  return Math.max(1, Math.round(baseSize * (percent / 100)));
}

export function lineWidthToPercent(lineWidth: number, baseSize: number): number {
  if (!Number.isFinite(lineWidth) || lineWidth <= 0) {
    return DEFAULT_LINE_WIDTH_PERCENT;
  }
  return (lineWidth / Math.max(1, baseSize)) * 100;
}

// ==================== 序号徽标 ====================

export function numberBadgeRadius(fontSize: number): number {
  return Math.max(9, Math.round(fontSize * 0.78));
}

// ==================== 打码 ====================

export const DEFAULT_MOSAIC_STRENGTH_PERCENT = 2;
export const MIN_MOSAIC_STRENGTH_PERCENT = 0.5;
export const MAX_MOSAIC_STRENGTH_PERCENT = 8;

export function resolveMosaicPixelSize(
  width: number,
  height: number,
  strengthPercent: number = DEFAULT_MOSAIC_STRENGTH_PERCENT
): number {
  const base = Math.min(width, height);
  const strength = clamp(
    Number.isFinite(strengthPercent) ? strengthPercent : DEFAULT_MOSAIC_STRENGTH_PERCENT,
    MIN_MOSAIC_STRENGTH_PERCENT,
    MAX_MOSAIC_STRENGTH_PERCENT
  );
  return clamp(Math.round((base * strength) / 100), 4, 128);
}

/** 高斯模糊模式的模糊半径(图片像素) */
export function resolveMosaicBlurRadius(
  width: number,
  height: number,
  strengthPercent: number = DEFAULT_MOSAIC_STRENGTH_PERCENT
): number {
  return Math.max(2, Math.round(resolveMosaicPixelSize(width, height, strengthPercent) * 0.5));
}

// ==================== 标签(框选/箭头旁的文字) ====================

/** 粗略估算文本宽度:CJK 记 1em,其余 0.62em;仅用于边界收敛,不追求精确 */
export function estimateTextWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const char of text) {
    units += char.codePointAt(0)! > 0x2e80 ? 1 : 0.62;
  }
  return units * fontSize;
}

export function resolveTextBlockSize(
  text: string,
  fontSize: number
): { width: number; height: number } {
  const lines = text.split('\n');
  return {
    width: Math.max(...lines.map((line) => estimateTextWidth(line, fontSize)), fontSize),
    height: Math.max(1, lines.length) * fontSize * TEXT_LINE_HEIGHT,
  };
}

export function resolveTextBackgroundPadding(fontSize: number): number {
  return Math.max(2, Math.round(fontSize * TEXT_BACKGROUND_PADDING_RATIO));
}

export function resolveLabelFontSize(item: LabeledMark, baseSize: number): number {
  if (typeof item.labelFontSize === 'number' && Number.isFinite(item.labelFontSize)) {
    return Math.max(8, item.labelFontSize);
  }
  return percentToFontSize(DEFAULT_TEXT_SIZE_PERCENT / 2, baseSize);
}

export interface LabelPlacement {
  x: number;
  y: number;
}


/**
 * 标签锚点(文本块左上角):
 * - 用户拖动过标签(labelDx/Dy)时按相对偏移跟随图形
 * - 矩形/椭圆默认放在形状右下角外侧(标注工具的拖动落点),越界时向内收敛
 * - 箭头默认放在终点(箭头尖)旁,按边界自动换侧
 */
export function resolveLabelPlacement(
  item: LabeledMark,
  imageWidth: number,
  imageHeight: number
): LabelPlacement {
  if (typeof item.labelDx === 'number' && typeof item.labelDy === 'number') {
    const ref = labelRefPoint(item);
    return { x: ref.x + item.labelDx, y: ref.y + item.labelDy };
  }

  const label = item.label ?? '';
  const fontSize = resolveLabelFontSize(item, resolveTextBaseSize(imageWidth, imageHeight));
  const block = resolveTextBlockSize(label, fontSize);
  const blockHeight = block.height;
  const blockWidth = block.width;
  const gap = Math.max(4, Math.round(fontSize * 0.35));

  if (item.type === 'arrow') {
    const [, , tipX, tipY] = item.points;
    const { minX, minY } = getPointsBounds(item.points);
    const preferRight = tipX >= minX;
    const preferBelow = tipY >= minY;
    let x = preferRight ? tipX + gap : tipX - gap - blockWidth;
    let y = preferBelow ? tipY + gap : tipY - gap - blockHeight;
    x = clamp(x, 0, Math.max(0, imageWidth - blockWidth));
    y = clamp(y, 0, Math.max(0, imageHeight - blockHeight));
    return { x, y };
  }

  // 右下角外侧;右侧放不下时贴框内右缘,下方放不下时翻到框上方
  const rightX = item.x + item.width + gap;
  const x = rightX + blockWidth <= imageWidth
    ? rightX
    : clamp(item.x + item.width - blockWidth, 0, Math.max(0, imageWidth - blockWidth));
  const belowY = item.y + item.height + gap;
  const y = belowY + blockHeight <= imageHeight
    ? belowY
    : clamp(item.y - gap - blockHeight, 0, Math.max(0, imageHeight - blockHeight));
  return { x, y };
}

/** 标签文本块的外接矩形(含估算宽高) */
export function resolveLabelBlockRect(
  item: LabeledMark,
  imageWidth: number,
  imageHeight: number
): { x: number; y: number; width: number; height: number; fontSize: number } {
  const fontSize = resolveLabelFontSize(item, resolveTextBaseSize(imageWidth, imageHeight));
  const placement = resolveLabelPlacement(item, imageWidth, imageHeight);
  const size = resolveTextBlockSize(item.label ?? '', fontSize);
  const padding = item.labelBackgroundColor ? resolveTextBackgroundPadding(fontSize) : 0;
  return {
    x: placement.x - padding,
    y: placement.y - padding,
    width: size.width + padding * 2,
    height: size.height + padding * 2,
    fontSize,
  };
}

function closestPointOnRect(
  px: number,
  py: number,
  rect: { x: number; y: number; width: number; height: number }
): { x: number; y: number } {
  return {
    x: clamp(px, rect.x, rect.x + rect.width),
    y: clamp(py, rect.y, rect.y + rect.height),
  };
}

export interface LabelConnectorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 图形侧的引导线锚点区域:矩形/椭圆为自身外框,箭头为箭头尖(零尺寸点) */
export function resolveShapeAnchorRect(item: LabeledMark): LabelConnectorRect {
  if (item.type === 'arrow') {
    return { x: item.points[2], y: item.points[3], width: 0, height: 0 };
  }
  return { x: item.x, y: item.y, width: item.width, height: item.height };
}

function rectsOverlap(a: LabelConnectorRect, b: LabelConnectorRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * 两个矩形间的引导线(图形侧最近点 → 文本侧最近点)。
 * 文本块落在图形范围内(视为"在框内")时不需要引导线,返回 null。
 * 编辑器实时拖拽预览与光栅化导出共用此函数,保证行为一致。
 */
export function resolveConnectorLine(
  shapeRect: LabelConnectorRect,
  block: LabelConnectorRect
): { x1: number; y1: number; x2: number; y2: number } | null {
  if (rectsOverlap(shapeRect, block)) {
    return null;
  }
  const shapeCenter = { x: shapeRect.x + shapeRect.width / 2, y: shapeRect.y + shapeRect.height / 2 };
  const blockCenter = { x: block.x + block.width / 2, y: block.y + block.height / 2 };
  const start = closestPointOnRect(shapeCenter.x, shapeCenter.y, block);
  const end = closestPointOnRect(blockCenter.x, blockCenter.y, shapeRect);
  if (Math.hypot(end.x - start.x, end.y - start.y) < 2) {
    return null;
  }
  return { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
}

/**
 * 标签引导线:标签文本块与图形分离时,画一条从标签指向图形的细线。
 * 标签落在图形范围内时不需要引导线(返回 null)。
 */
export function resolveLabelConnector(
  item: LabeledMark,
  imageWidth: number,
  imageHeight: number
): { x1: number; y1: number; x2: number; y2: number } | null {
  if (!item.label) {
    return null;
  }
  const block = resolveLabelBlockRect(item, imageWidth, imageHeight);
  return resolveConnectorLine(resolveShapeAnchorRect(item), block);
}
