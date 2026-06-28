import { parseAspectRatio } from '@/features/canvas/application/imageData'
import {
  CONTROL_ROW_HEIGHT_PX,
  CONTROL_ROW_MARGIN_BOTTOM_PX,
  computeFrameTextFontSizePx,
  FRAME_CELL_MIN_HEIGHT_PX,
  FRAME_CELL_MIN_WIDTH_PX,
  FRAME_CELL_TEXT_PADDING_PX,
  FRAME_GRID_GAP_PX,
  FRAME_GRID_MARGIN_BOTTOM_PX,
  NODE_VERTICAL_PADDING_PX,
  STORYBOARD_PARAM_ROW_HEIGHT_PX,
  STORYBOARD_PARAM_ROW_GAP_PX,
  STORYBOARD_GEN_NODE_MIN_HEIGHT_PX,
  STORYBOARD_GEN_NODE_MIN_WIDTH_PX,
  STORYBOARD_GRID_BASE_CELL_HEIGHT_PX,
  STORYBOARD_GRID_GAP_PX,
  STORYBOARD_GRID_MAX_WIDTH_PX,
  STORYBOARD_NODE_HORIZONTAL_PADDING_PX,
  STORYBOARD_CONTROL_ROW_WIDTH_PX,
  STORYBOARD_PARAMS_ROW_WIDTH_PX,
  toCssAspectRatio,
} from './shared'

export interface StoryboardBaseFrameLayout {
  nodeWidth: number
  nodeHeight: number
}

export interface StoryboardFrameLayout {
  cellWidth: number
  gridWidth: number
  cellAspectRatio: string
  /** 格子描述文字字号，随格子尺寸自适应缩放 */
  cellFontSizePx: number
  cellLineHeightPx: number
}

/** 逐行参数区（模型行 + N 个标量参数行）总高度，行数随所选模型 schema 变化 */
function computeParamsSectionHeight(rowCount: number): number {
  if (rowCount <= 0) {
    return 0
  }
  return rowCount * STORYBOARD_PARAM_ROW_HEIGHT_PX + (rowCount - 1) * STORYBOARD_PARAM_ROW_GAP_PX
}

/** 按格子可用宽度反推字号，使占位文案尽量单行显示，同时在 [最小字号, 最大字号] 区间内截断 */
function computeCellFontMetricsPx(cellWidth: number): { fontSizePx: number; lineHeightPx: number } {
  const contentWidth = Math.max(0, cellWidth - FRAME_CELL_TEXT_PADDING_PX * 2)
  const fontSizePx = computeFrameTextFontSizePx(contentWidth)
  return {
    fontSizePx,
    lineHeightPx: Math.round(fontSizePx * 1.4),
  }
}

export function computeStoryboardBaseFrameLayout(
  frameAspectRatioValue: string,
  gridCols: number,
  gridRows: number,
  paramsRowCount: number
): StoryboardBaseFrameLayout {
  const aspectRatio = Math.max(0.1, parseAspectRatio(frameAspectRatioValue))
  let cellWidth = STORYBOARD_GRID_BASE_CELL_HEIGHT_PX * aspectRatio
  let gridWidth = gridCols * cellWidth + Math.max(0, gridCols - 1) * STORYBOARD_GRID_GAP_PX

  if (gridWidth > STORYBOARD_GRID_MAX_WIDTH_PX) {
    const scale = STORYBOARD_GRID_MAX_WIDTH_PX / gridWidth
    cellWidth *= scale
    gridWidth = gridCols * cellWidth + Math.max(0, gridCols - 1) * STORYBOARD_GRID_GAP_PX
  }

  const roundedCellWidth = Math.max(FRAME_CELL_MIN_WIDTH_PX, Math.round(cellWidth))
  const roundedCellHeight = Math.max(FRAME_CELL_MIN_HEIGHT_PX, Math.round(roundedCellWidth / aspectRatio))
  const roundedGridWidth = gridCols * roundedCellWidth + Math.max(0, gridCols - 1) * STORYBOARD_GRID_GAP_PX
  const roundedGridHeight = gridRows * roundedCellHeight + Math.max(0, gridRows - 1) * FRAME_GRID_GAP_PX
  const nodeInnerWidth = Math.max(STORYBOARD_CONTROL_ROW_WIDTH_PX, STORYBOARD_PARAMS_ROW_WIDTH_PX, roundedGridWidth)
  const nodeWidth = Math.max(STORYBOARD_GEN_NODE_MIN_WIDTH_PX, Math.round(nodeInnerWidth + STORYBOARD_NODE_HORIZONTAL_PADDING_PX))
  const nodeHeight = Math.max(
    STORYBOARD_GEN_NODE_MIN_HEIGHT_PX,
    Math.round(
      NODE_VERTICAL_PADDING_PX
      + CONTROL_ROW_HEIGHT_PX
      + CONTROL_ROW_MARGIN_BOTTOM_PX
      + roundedGridHeight
      + FRAME_GRID_MARGIN_BOTTOM_PX
      + computeParamsSectionHeight(paramsRowCount)
    )
  )

  return {
    nodeWidth,
    nodeHeight,
  }
}

export function computeStoryboardFrameLayout(
  frameAspectRatioValue: string,
  gridCols: number,
  gridRows: number,
  resolvedNodeHeight: number,
  resolvedNodeWidth: number,
  paramsRowCount: number
): StoryboardFrameLayout {
  const cols = Math.max(1, gridCols)
  const rows = Math.max(1, gridRows)
  const aspectRatio = Math.max(0.1, parseAspectRatio(frameAspectRatioValue))
  const innerWidth = Math.max(120, resolvedNodeWidth - STORYBOARD_NODE_HORIZONTAL_PADDING_PX)
  const availableGridHeight = Math.max(
    72,
    resolvedNodeHeight
    - NODE_VERTICAL_PADDING_PX
    - CONTROL_ROW_HEIGHT_PX
    - CONTROL_ROW_MARGIN_BOTTOM_PX
    - FRAME_GRID_MARGIN_BOTTOM_PX
    - computeParamsSectionHeight(paramsRowCount)
  )
  const widthLimitedCellWidth = (innerWidth - Math.max(0, cols - 1) * STORYBOARD_GRID_GAP_PX) / cols
  const heightLimitedCellHeight = (availableGridHeight - Math.max(0, rows - 1) * FRAME_GRID_GAP_PX) / rows
  const heightLimitedCellWidth = heightLimitedCellHeight * aspectRatio
  const resolvedCellWidth = Math.floor(Math.min(widthLimitedCellWidth, heightLimitedCellWidth))
  const cellWidth = Math.max(FRAME_CELL_MIN_WIDTH_PX, resolvedCellWidth)
  const gridWidth = cols * cellWidth + Math.max(0, cols - 1) * STORYBOARD_GRID_GAP_PX
  const { fontSizePx, lineHeightPx } = computeCellFontMetricsPx(cellWidth)

  return {
    cellWidth,
    gridWidth,
    cellAspectRatio: toCssAspectRatio(frameAspectRatioValue),
    cellFontSizePx: fontSizePx,
    cellLineHeightPx: lineHeightPx,
  }
}
