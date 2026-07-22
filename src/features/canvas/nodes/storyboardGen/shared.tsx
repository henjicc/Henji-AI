import { Minus, Plus } from 'lucide-react'
import type { StoryboardGenNodeData } from '@/features/canvas/domain/canvasNodes'
import { AUTO_REQUEST_ASPECT_RATIO } from '@/features/canvas/domain/canvasNodes'
import { parseAspectRatio } from '@/features/canvas/application/imageData'
import { UiButton } from '@/components/ui'
import { BLACK_HEX, WHITE_HEX } from '@/core/theme/colorTokens'

export interface AspectRatioChoice {
  value: string
  label: string
}

export const AUTO_ASPECT_RATIO_OPTION: AspectRatioChoice = {
  value: AUTO_REQUEST_ASPECT_RATIO,
  label: '自动',
}

const IMAGE_REFERENCE_MARKER_REGEX = /@(?:图片|图)(\d+)/g

export const STORYBOARD_NODE_HORIZONTAL_PADDING_PX = 24
export const STORYBOARD_GRID_GAP_PX = 2
export const STORYBOARD_GRID_BASE_CELL_HEIGHT_PX = 78
export const STORYBOARD_GRID_MAX_WIDTH_PX = 320
export const STORYBOARD_CONTROL_ROW_WIDTH_PX = 274
export const STORYBOARD_PARAMS_ROW_WIDTH_PX = 286
/** 逐行参数区取代旧版单行 chip 工具条后，节点不再需要为容纳工具条预留过宽空间 */
export const STORYBOARD_GEN_NODE_MIN_WIDTH_PX = 320
export const STORYBOARD_GEN_NODE_MIN_HEIGHT_PX = 320
export const STORYBOARD_GEN_ICON_ADJUST = { x: 0, y: 0, scale: 0.95 }
const GRID_CONTROL_CONTAINER_CLASS = 'flex h-5 items-center gap-0.5 rounded-full border border-[rgba(255,255,255,0.14)] bg-[rgba(255,255,255,0.04)] px-1'
const GRID_CONTROL_LABEL_CLASS = 'text-[9px] text-text-muted'
const GRID_CONTROL_BUTTON_CLASS = 'flex h-3 w-3 items-center justify-center rounded text-text-muted transition-colors hover:bg-white/10 hover:text-text-dark'
const GRID_CONTROL_ICON_CLASS = 'h-1.5 w-1.5'
const GRID_CONTROL_VALUE_CLASS = 'min-w-[14px] text-center text-[9px] font-semibold text-text-dark'
export const GRID_SUMMARY_CLASS = 'flex h-5 items-center rounded-full border border-[rgba(255,255,255,0.14)] bg-[rgba(255,255,255,0.05)] px-1.5 text-[9px] text-text-muted'
export const FRAME_GRID_GAP_PX = 2
export const CONTROL_ROW_HEIGHT_PX = 20
export const CONTROL_ROW_MARGIN_BOTTOM_PX = 10
export const FRAME_GRID_MARGIN_BOTTOM_PX = 8
/** 与 NODE_ROW_CLASS 的 min-h-10 保持一致（逐行参数区每行高度） */
export const STORYBOARD_PARAM_ROW_HEIGHT_PX = 40
/** 与 NODE_ROW_GAP_CLASS 的 gap-1.5 保持一致（逐行参数区行间距） */
export const STORYBOARD_PARAM_ROW_GAP_PX = 6
export const NODE_VERTICAL_PADDING_PX = 24
/**
 * 分镜格子描述文字随格子尺寸自适应缩放的取值区间。
 * 上限放宽到 18：旧的 10px 上限在节点略大于最小尺寸时就被顶满，导致放大节点时字号"看着没变"；
 * 放宽后从最小到放大全程都有可见的字号变化，同时仍有封顶避免无限增大。
 */
export const FRAME_TEXT_MIN_FONT_SIZE_PX = 2
export const FRAME_TEXT_MAX_FONT_SIZE_PX = 18
export const FRAME_CELL_MIN_WIDTH_PX = 24
export const FRAME_CELL_MIN_HEIGHT_PX = 16
/** 格子内文字单侧内边距，需与 StoryboardGridEditor 中 textarea 的 px-1.5 保持一致 */
export const FRAME_CELL_TEXT_PADDING_PX = 6
const GRID_LINE_THICKNESS_PERCENT = 0.4
/**
 * 占位文案"分镜 NN 描述"按字号换算的单行所需宽度（单位：字号倍数）。
 * 也会影响到实际渲染时的字号计算
 * 现在是我手动调整后觉得不错的值
 */
const FRAME_TEXT_PLACEHOLDER_WIDTH_PER_FONT_SIZE = 10

/**
 * 按格子可用文字宽度反推字号，取"能单行容纳占位文案的最大字号"。
 * 用 Math.floor 而非 round：round 会向上取整、反而超出可用宽度导致换行；
 * floor 保证算出的字号一定塞得下，再按 [最小, 最大] 区间截断。
 */
export function computeFrameTextFontSizePx(availableContentWidthPx: number): number {
  const idealFontSizePx = availableContentWidthPx / FRAME_TEXT_PLACEHOLDER_WIDTH_PER_FONT_SIZE
  return Math.min(
    FRAME_TEXT_MAX_FONT_SIZE_PX,
    Math.max(FRAME_TEXT_MIN_FONT_SIZE_PX, Math.floor(idealFontSizePx))
  )
}

interface GridStepperControlProps {
  label: string
  value: number
  onDecrease: () => void
  onIncrease: () => void
}

export function GridStepperControl({
  label,
  value,
  onDecrease,
  onIncrease,
}: GridStepperControlProps): JSX.Element {
  return (
    <div className={GRID_CONTROL_CONTAINER_CLASS}>
      <span className={GRID_CONTROL_LABEL_CLASS}>{label}</span>
      <UiButton
        type="button"
        variant="ghost"
        size="sm"
        className={`${GRID_CONTROL_BUTTON_CLASS} !h-3 !w-3 !rounded !px-0`}
        onClick={(event) => {
          event.stopPropagation()
          onDecrease()
        }}
      >
        <Minus className={GRID_CONTROL_ICON_CLASS} />
      </UiButton>
      <span className={GRID_CONTROL_VALUE_CLASS}>{value}</span>
      <UiButton
        type="button"
        variant="ghost"
        size="sm"
        className={`${GRID_CONTROL_BUTTON_CLASS} !h-3 !w-3 !rounded !px-0`}
        onClick={(event) => {
          event.stopPropagation()
          onIncrease()
        }}
      >
        <Plus className={GRID_CONTROL_ICON_CLASS} />
      </UiButton>
    </div>
  )
}

export function resolveReferenceIndexFromDescription(
  description: string,
  maxImageCount: number
): number | null {
  IMAGE_REFERENCE_MARKER_REGEX.lastIndex = 0
  const match = IMAGE_REFERENCE_MARKER_REGEX.exec(description)
  if (!match) {
    return null
  }

  const rawIndex = Number(match[1])
  if (!Number.isFinite(rawIndex)) {
    return null
  }

  const zeroBasedIndex = rawIndex - 1
  if (zeroBasedIndex < 0 || zeroBasedIndex >= maxImageCount) {
    return null
  }

  return zeroBasedIndex
}

export function buildFrameDescriptionDrafts(
  frames: StoryboardGenNodeData['frames']
): Record<string, string> {
  const drafts: Record<string, string> = {}
  for (const frame of frames) {
    drafts[frame.id] = frame.description
  }
  return drafts
}

export function areFrameDescriptionDraftsEqual(
  left: Record<string, string>,
  right: Record<string, string>
): boolean {
  const leftEntries = Object.entries(left)
  const rightEntries = Object.entries(right)
  if (leftEntries.length !== rightEntries.length) {
    return false
  }

  for (const [key, value] of leftEntries) {
    if (right[key] !== value) {
      return false
    }
  }

  return true
}

export function pickClosestAspectRatio(
  targetRatio: number,
  supportedAspectRatios: string[]
): string {
  const supported = supportedAspectRatios.length > 0 ? supportedAspectRatios : ['1:1']
  let bestValue = supported[0]
  let bestDistance = Number.POSITIVE_INFINITY

  for (const aspectRatio of supported) {
    const ratio = parseAspectRatio(aspectRatio)
    const distance = Math.abs(Math.log(ratio / targetRatio))
    if (distance < bestDistance) {
      bestDistance = distance
      bestValue = aspectRatio
    }
  }

  return bestValue
}

export function generateFrameId(): string {
  return `frame-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

export function toCssAspectRatio(aspectRatio: string): string {
  const [width = '1', height = '1'] = aspectRatio.split(':')
  return `${width} / ${height}`
}

function resolveSizeToPixels(size: string): number {
  const sizeMap: Record<string, number> = {
    '0.5K': 512,
    '1K': 1024,
    '2K': 2048,
    '4K': 4096,
  }
  return sizeMap[size] ?? 1024
}

export function generateGridImageDataUrl(
  aspectRatio: string,
  rows: number,
  cols: number,
  resolution: string,
  lineThicknessPercent: number = GRID_LINE_THICKNESS_PERCENT
): string {
  const [ratioW = '16', ratioH = '9'] = aspectRatio.split(':')
  const ratioWNum = parseFloat(ratioW)
  const ratioHNum = parseFloat(ratioH)
  const totalPixels = resolveSizeToPixels(resolution)
  const canvasWidth = totalPixels
  const canvasHeight = Math.round(totalPixels * (ratioHNum / ratioWNum))
  const thickness = Math.max(
    1,
    Math.round((Math.min(canvasWidth, canvasHeight) * lineThicknessPercent) / 100)
  )
  const cellWidth = canvasWidth / cols
  const cellHeight = canvasHeight / rows
  const canvas = document.createElement('canvas')
  canvas.width = canvasWidth
  canvas.height = canvasHeight
  const ctx = canvas.getContext('2d')

  if (!ctx) {
    throw new Error('Failed to create canvas context')
  }

  ctx.fillStyle = WHITE_HEX
  ctx.fillRect(0, 0, canvasWidth, canvasHeight)
  ctx.strokeStyle = BLACK_HEX
  ctx.lineWidth = thickness

  for (let i = 1; i < cols; i++) {
    const x = i * cellWidth
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, canvasHeight)
    ctx.stroke()
  }

  for (let i = 1; i < rows; i++) {
    const y = i * cellHeight
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(canvasWidth, y)
    ctx.stroke()
  }

  return canvas.toDataURL('image/png')
}
