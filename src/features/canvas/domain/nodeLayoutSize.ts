import type { CanvasNodeData } from './canvasNodes';
import {
  DEFAULT_ASPECT_RATIO,
  EXPORT_RESULT_NODE_DEFAULT_WIDTH,
  EXPORT_RESULT_NODE_LAYOUT_HEIGHT,
} from './canvasNodeConstants';

export interface CanvasNodeLayoutSize {
  width: number;
  height: number;
}

/**
 * 节点尚未测量时的占位估值。落点避让与整理在同一回合连续建节点时读不到 DOM 测量，
 * 估值偏小就会把下一个节点压到刚建的大节点上，所以按各类节点的常见展开尺寸取偏大值。
 */
export const GENERATION_NODE_LAYOUT_SIZE: CanvasNodeLayoutSize = { width: 320, height: 420 };
export const FALLBACK_NODE_LAYOUT_SIZE: CanvasNodeLayoutSize = { width: 220, height: 200 };

function aspectRatioValue(value: unknown, fallback: string): number {
  const [width, height] = (typeof value === 'string' ? value : fallback).split(':').map(Number);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? width / height : 1;
}

/** 媒体结果节点按画面比例装进结果节点的默认展示框，与出图后自动调整的尺寸同一口径。 */
export function mediaResultLayoutSize(defaultAspectRatio = DEFAULT_ASPECT_RATIO) {
  return (data: CanvasNodeData): CanvasNodeLayoutSize => {
    const ratio = Math.max(0.1, aspectRatioValue((data as { aspectRatio?: unknown }).aspectRatio, defaultAspectRatio));
    const width = Math.min(EXPORT_RESULT_NODE_DEFAULT_WIDTH, EXPORT_RESULT_NODE_LAYOUT_HEIGHT * ratio);
    return { width: Math.round(width), height: Math.round(width / ratio) };
  };
}

export const fixedLayoutSize = (size: CanvasNodeLayoutSize) => (): CanvasNodeLayoutSize => size;

function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** 实测 → 节点显式尺寸 → 类型声明估值，逐维回退。 */
export function pickCanvasNodeLayoutSize(
  node: { measured?: { width?: number; height?: number }; width?: number; height?: number; style?: { width?: unknown; height?: unknown } },
  declared: CanvasNodeLayoutSize,
): CanvasNodeLayoutSize {
  return {
    width: positive(node.measured?.width) ?? positive(node.width) ?? positive(node.style?.width) ?? declared.width,
    height: positive(node.measured?.height) ?? positive(node.height) ?? positive(node.style?.height) ?? declared.height,
  };
}
