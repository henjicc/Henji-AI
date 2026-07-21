import { parseAspectRatio } from '@/features/canvas/application/imageData';
import {
  FRAME_CELL_MIN_HEIGHT_PX,
  FRAME_CELL_MIN_WIDTH_PX,
  FRAME_NOTE_MAX_FONT_SIZE_PX,
  FRAME_NOTE_MAX_HEIGHT_PX,
  FRAME_NOTE_MIN_FONT_SIZE_PX,
  FRAME_NOTE_MIN_HEIGHT_PX,
  FRAME_NOTE_SCALE_MAX_CELL_WIDTH_PX,
  FRAME_NOTE_SCALE_MIN_CELL_WIDTH_PX,
  STORYBOARD_BOTTOM_ROW_HEIGHT_PX,
  STORYBOARD_BOTTOM_ROW_MARGIN_TOP_PX,
  STORYBOARD_GRID_BASE_CELL_HEIGHT_PX,
  STORYBOARD_GRID_GAP_PX,
  STORYBOARD_GRID_MAX_WIDTH_PX,
  STORYBOARD_NODE_HORIZONTAL_PADDING_PX,
  STORYBOARD_NODE_MIN_HEIGHT_PX,
  STORYBOARD_NODE_VERTICAL_PADDING_PX,
  STORYBOARD_NODE_WIDTH_PX,
} from './shared';

export interface StoryboardSplitBaseLayout {
  nodeWidth: number;
  nodeHeight: number;
}

export interface StoryboardSplitFrameLayout {
  cellWidth: number;
  cellHeight: number;
  gridWidth: number;
  gridHeight: number;
  /** 分镜描述叠加层字号/行高/层高，随格子尺寸自适应缩放 */
  noteFontSizePx: number;
  noteLineHeightPx: number;
  noteHeightPx: number;
}

function computeNoteMetrics(cellWidth: number, cellHeight: number): {
  fontSizePx: number;
  lineHeightPx: number;
  heightPx: number;
} {
  const span = FRAME_NOTE_SCALE_MAX_CELL_WIDTH_PX - FRAME_NOTE_SCALE_MIN_CELL_WIDTH_PX;
  const ratio = Math.min(1, Math.max(0, (cellWidth - FRAME_NOTE_SCALE_MIN_CELL_WIDTH_PX) / span));
  const fontSizePx = Math.round(
    FRAME_NOTE_MIN_FONT_SIZE_PX + ratio * (FRAME_NOTE_MAX_FONT_SIZE_PX - FRAME_NOTE_MIN_FONT_SIZE_PX)
  );

  return {
    fontSizePx,
    lineHeightPx: Math.round(fontSizePx * 1.4),
    heightPx: Math.round(Math.min(FRAME_NOTE_MAX_HEIGHT_PX, Math.max(FRAME_NOTE_MIN_HEIGHT_PX, cellHeight * 0.34))),
  };
}

/** 节点创建之初/未经手动拖拽缩放时的估算尺寸，同时作为 NodeResizeHandle 的最小尺寸 */
export function computeStoryboardSplitBaseLayout(
  frameAspectRatioValue: string,
  gridCols: number,
  gridRows: number
): StoryboardSplitBaseLayout {
  const aspectRatio = Math.max(0.1, parseAspectRatio(frameAspectRatioValue));
  let cellWidth = STORYBOARD_GRID_BASE_CELL_HEIGHT_PX * aspectRatio;
  let gridWidth = gridCols * cellWidth + Math.max(0, gridCols - 1) * STORYBOARD_GRID_GAP_PX;

  if (gridWidth > STORYBOARD_GRID_MAX_WIDTH_PX) {
    const scale = STORYBOARD_GRID_MAX_WIDTH_PX / gridWidth;
    cellWidth *= scale;
    gridWidth = gridCols * cellWidth + Math.max(0, gridCols - 1) * STORYBOARD_GRID_GAP_PX;
  }

  const roundedCellWidth = Math.max(FRAME_CELL_MIN_WIDTH_PX, Math.round(cellWidth));
  const roundedCellHeight = Math.max(FRAME_CELL_MIN_HEIGHT_PX, Math.round(roundedCellWidth / aspectRatio));
  const roundedGridWidth = gridCols * roundedCellWidth + Math.max(0, gridCols - 1) * STORYBOARD_GRID_GAP_PX;
  const roundedGridHeight = gridRows * roundedCellHeight + Math.max(0, gridRows - 1) * STORYBOARD_GRID_GAP_PX;

  const nodeWidth = Math.max(STORYBOARD_NODE_WIDTH_PX, Math.round(roundedGridWidth + STORYBOARD_NODE_HORIZONTAL_PADDING_PX));
  const nodeHeight = Math.max(
    STORYBOARD_NODE_MIN_HEIGHT_PX,
    Math.round(
      STORYBOARD_NODE_VERTICAL_PADDING_PX
      + roundedGridHeight
      + STORYBOARD_BOTTOM_ROW_MARGIN_TOP_PX
      + STORYBOARD_BOTTOM_ROW_HEIGHT_PX
    )
  );

  return { nodeWidth, nodeHeight };
}

/** 按节点当前实际宽高反算格子尺寸，使格子区始终刚好填满可用空间且不出现滚动条 */
export function computeStoryboardSplitFrameLayout(
  frameAspectRatioValue: string,
  gridCols: number,
  gridRows: number,
  resolvedNodeWidth: number,
  resolvedNodeHeight: number
): StoryboardSplitFrameLayout {
  const cols = Math.max(1, gridCols);
  const rows = Math.max(1, gridRows);
  const aspectRatio = Math.max(0.1, parseAspectRatio(frameAspectRatioValue));
  const innerWidth = Math.max(80, resolvedNodeWidth - STORYBOARD_NODE_HORIZONTAL_PADDING_PX);
  const availableGridHeight = Math.max(
    60,
    resolvedNodeHeight
    - STORYBOARD_NODE_VERTICAL_PADDING_PX
    - STORYBOARD_BOTTOM_ROW_MARGIN_TOP_PX
    - STORYBOARD_BOTTOM_ROW_HEIGHT_PX
  );

  const widthLimitedCellWidth = (innerWidth - Math.max(0, cols - 1) * STORYBOARD_GRID_GAP_PX) / cols;
  const heightLimitedCellHeight = (availableGridHeight - Math.max(0, rows - 1) * STORYBOARD_GRID_GAP_PX) / rows;
  const heightLimitedCellWidth = heightLimitedCellHeight * aspectRatio;
  const resolvedCellWidth = Math.floor(Math.min(widthLimitedCellWidth, heightLimitedCellWidth));
  const cellWidth = Math.max(FRAME_CELL_MIN_WIDTH_PX, resolvedCellWidth);
  const cellHeight = Math.max(FRAME_CELL_MIN_HEIGHT_PX, Math.round(cellWidth / aspectRatio));
  const gridWidth = cols * cellWidth + Math.max(0, cols - 1) * STORYBOARD_GRID_GAP_PX;
  const gridHeight = rows * cellHeight + Math.max(0, rows - 1) * STORYBOARD_GRID_GAP_PX;
  const { fontSizePx, lineHeightPx, heightPx } = computeNoteMetrics(cellWidth, cellHeight);

  return {
    cellWidth,
    cellHeight,
    gridWidth,
    gridHeight,
    noteFontSizePx: fontSizePx,
    noteLineHeightPx: lineHeightPx,
    noteHeightPx: heightPx,
  };
}
