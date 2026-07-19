import { clamp, getPointsBounds } from './geometry';
import type { LabeledMark } from './types';

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

// ==================== 马赛克 ====================

export function resolveMosaicPixelSize(width: number, height: number): number {
  const base = Math.min(width, height);
  return clamp(Math.round(base * 0.02), 6, 64);
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
 * - 矩形/椭圆:优先放在形状上方,顶部放不下时放到形状下方
 * - 箭头:放在终点(箭头尖)旁,按边界自动换侧
 */
export function resolveLabelPlacement(
  item: LabeledMark,
  imageWidth: number,
  imageHeight: number
): LabelPlacement {
  const label = item.label ?? '';
  const fontSize = resolveLabelFontSize(item, resolveTextBaseSize(imageWidth, imageHeight));
  const lines = label.split('\n');
  const blockHeight = lines.length * fontSize * TEXT_LINE_HEIGHT;
  const blockWidth = Math.max(...lines.map((line) => estimateTextWidth(line, fontSize)), fontSize);
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

  const aboveY = item.y - gap - blockHeight;
  const y = aboveY >= 0 ? aboveY : item.y + item.height + gap;
  const x = clamp(item.x, 0, Math.max(0, imageWidth - blockWidth));
  return { x, y: clamp(y, 0, Math.max(0, imageHeight - blockHeight)) };
}
