import type { StoryboardExportOptions, StoryboardSplitNodeData } from '@/features/canvas/domain/canvasNodes';
import { CANVAS_BG_HEX, CANVAS_TEXT_HEX } from '@/core/theme/colorTokens';

export interface IncomingImageItem {
  imageUrl: string;
  previewImageUrl: string | null;
  displayUrl: string;
  label: string;
}

export interface PanelAnchor {
  left: number;
  top: number;
}

export const STORYBOARD_NODE_WIDTH_PX = 318;
export const STORYBOARD_NODE_MIN_HEIGHT_PX = 320;
export const STORYBOARD_GRID_GAP_PX = 1;
/** 节点内边距（p-2 上下/左右合计） */
export const STORYBOARD_NODE_VERTICAL_PADDING_PX = 16;
export const STORYBOARD_NODE_HORIZONTAL_PADDING_PX = 16;
/** 底部操作行（导出设置 + 合并导出）高度与上边距，对应 h-7 + mt-2 */
export const STORYBOARD_BOTTOM_ROW_HEIGHT_PX = 28;
export const STORYBOARD_BOTTOM_ROW_MARGIN_TOP_PX = 8;
/** 节点首次创建/未触发自适应缩放时，格子按该基准高度估算初始尺寸 */
export const STORYBOARD_GRID_BASE_CELL_HEIGHT_PX = 96;
export const STORYBOARD_GRID_MAX_WIDTH_PX = 480;
export const FRAME_CELL_MIN_WIDTH_PX = 32;
export const FRAME_CELL_MIN_HEIGHT_PX = 24;
/** 分镜描述叠加层文字随格子尺寸自适应缩放的取值区间 */
export const FRAME_NOTE_MIN_FONT_SIZE_PX = 8;
export const FRAME_NOTE_MAX_FONT_SIZE_PX = 11;
export const FRAME_NOTE_SCALE_MIN_CELL_WIDTH_PX = 60;
export const FRAME_NOTE_SCALE_MAX_CELL_WIDTH_PX = 220;
export const FRAME_NOTE_MIN_HEIGHT_PX = 18;
export const FRAME_NOTE_MAX_HEIGHT_PX = 56;

export function SplitResultIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M10 0c1.66 0 3 1.34 3 3v3l2.4-1.5a3.003 3.003 0 0 1 3 5.2a3.003 3.003 0 0 1-4.452-2.051l-.952.55v6.8h-2v-5.65l-4.01 2.32l-.988-1.73l5-2.94v-1.17a2.996 2.996 0 0 1-4-2.829c0-1.66 1.34-3 3-3zM9 3a1 1 0 0 0 2 0a1 1 0 0 0-2 0m7 4a1 1 0 0 0 2 0a1 1 0 0 0-2 0M2.97 19h2v-2h-2V9h3V7h-3c-1.1 0-2 .895-2 2v8c0 1.1.895 2 2 2m6 0h-2v-2h2zm4-2c0 1.1-.895 2-2 2v-2z" />
    </svg>
  );
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function toCssAspectRatio(aspectRatio: string): string {
  const [rawWidth = '1', rawHeight = '1'] = aspectRatio.split(':');
  const width = Number(rawWidth);
  const height = Number(rawHeight);

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return '1 / 1';
  }

  return `${width} / ${height}`;
}

export function resolvePanelAnchor(triggerElement: HTMLDivElement | null): PanelAnchor | null {
  if (!triggerElement) {
    return null;
  }

  const rect = triggerElement.getBoundingClientRect();
  return {
    left: rect.left + rect.width / 2,
    top: rect.top - 8,
  };
}

function createDefaultExportOptions(): StoryboardExportOptions {
  return {
    showFrameIndex: false,
    showFrameNote: false,
    notePlacement: 'overlay',
    imageFit: 'cover',
    frameIndexPrefix: 'S',
    cellGap: 8,
    outerPadding: 0,
    fontSize: 4,
    backgroundColor: CANVAS_BG_HEX,
    textColor: CANVAS_TEXT_HEX,
  };
}

export function resolveExportOptions(options: StoryboardSplitNodeData['exportOptions']): StoryboardExportOptions {
  const merged = {
    ...createDefaultExportOptions(),
    ...(options ?? {}),
  };

  const rawFontSize = Number.isFinite(merged.fontSize) ? merged.fontSize : 4;
  const normalizedFontPercent = rawFontSize > 20
    ? Math.round(rawFontSize / 6)
    : rawFontSize;

  return {
    ...merged,
    fontSize: clamp(Math.round(normalizedFontPercent), 1, 20),
  };
}
