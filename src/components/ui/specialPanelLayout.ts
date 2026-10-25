import { useLayoutEffect, useState, type RefObject } from 'react'
import { UI_SPECIAL_PANEL_BUDGET } from './styleTokens'

/** 特殊面板网格的列数与正文宽度（重要记录 021），配合 UiSpecialPanel 的 bodyWidth 使用。 */
export type SpecialPanelColumnsOptions = {
  /** 单元宽度（px） */
  cellWidth: number
  /** 单元间距（px） */
  gap: number
  /** 正文之外占掉的宽度：左栏、留白、描边（px） */
  chrome: number
  maxColumns: number
  minColumns?: number
}

/** 网格能放几列：按特殊面板宽度上限（不超过窗口宽减 32）减去外框后能放下的整列数。 */
export function resolveSpecialPanelColumns(viewportWidth: number, { cellWidth, gap, chrome, maxColumns, minColumns = 1 }: SpecialPanelColumnsOptions): number {
  const available = Math.min(UI_SPECIAL_PANEL_BUDGET.maxWidth, viewportWidth - UI_SPECIAL_PANEL_BUDGET.viewportGutter * 2) - chrome
  const fit = Math.floor((available + gap) / (cellWidth + gap))
  return Math.max(minColumns, Math.min(maxColumns, fit))
}

/** 网格正文宽度（px）：列数 × 单元宽 + 列间距。 */
export function specialPanelGridWidth(columns: number, cellWidth: number, gap: number): number {
  return columns * cellWidth + Math.max(0, columns - 1) * gap
}

/** 随所在窗口宽度更新的网格列数；传 ownerRef 时按它所在的窗口算（剪辑的系统浮窗里也对）。 */
export function useSpecialPanelColumns(options: SpecialPanelColumnsOptions, ownerRef?: RefObject<Element>): number {
  const { cellWidth, gap, chrome, maxColumns, minColumns } = options
  const [columns, setColumns] = useState(() => resolveSpecialPanelColumns(window.innerWidth, options))
  useLayoutEffect(() => {
    const owner = ownerRef?.current?.ownerDocument.defaultView ?? window
    const update = (): void => setColumns(resolveSpecialPanelColumns(owner.innerWidth, { cellWidth, gap, chrome, maxColumns, minColumns }))
    update()
    owner.addEventListener('resize', update)
    return () => owner.removeEventListener('resize', update)
  }, [cellWidth, chrome, gap, maxColumns, minColumns, ownerRef])
  return columns
}
