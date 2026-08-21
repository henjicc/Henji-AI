export const UI_SCALE_MODES = ['auto', '90', '100', '110'] as const

export type UiScaleMode = (typeof UI_SCALE_MODES)[number]
export type UiScaleFactor = 0.9 | 1 | 1.1

export interface WindowContentSize {
  width: number
  height: number
}

export const DEFAULT_UI_SCALE_MODE: UiScaleMode = 'auto'

const AUTO_COMPACT_MAX_WIDTH = 1439
const AUTO_COMPACT_MAX_HEIGHT = 999

export function normalizeUiScaleMode(value: unknown): UiScaleMode {
  return typeof value === 'string' && UI_SCALE_MODES.includes(value as UiScaleMode)
    ? value as UiScaleMode
    : DEFAULT_UI_SCALE_MODE
}

export function isUiScaleFactor(value: unknown): value is UiScaleFactor {
  return value === 0.9 || value === 1 || value === 1.1
}

export function resolveUiScaleFactor(
  mode: unknown,
  contentSize: WindowContentSize,
): UiScaleFactor {
  const normalizedMode = normalizeUiScaleMode(mode)
  if (normalizedMode === '90') return 0.9
  if (normalizedMode === '100') return 1
  if (normalizedMode === '110') return 1.1

  const { width, height } = contentSize
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 1
  }

  return width <= AUTO_COMPACT_MAX_WIDTH || height <= AUTO_COMPACT_MAX_HEIGHT ? 0.9 : 1
}

export function uiScaleFactorPercent(factor: UiScaleFactor): 90 | 100 | 110 {
  if (factor === 0.9) return 90
  if (factor === 1.1) return 110
  return 100
}
