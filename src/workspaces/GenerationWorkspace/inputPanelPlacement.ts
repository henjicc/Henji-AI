import { useEffect, useState } from 'react'
import { APPLICATION_SETTINGS_CHANGED_EVENT } from '@/core/settings/events'
import { UI_PANEL_WIDTH } from '@/core/theme/panelSizes'

/** 生成页输入面板的位置：底部浮起的一条，或左侧竖排、参数全部摊开。 */
export type GenerationInputPanelPlacement = 'bottom' | 'left'

export const GENERATION_INPUT_PANEL_PLACEMENT_KEY = 'generation_input_panel_placement'
export const GENERATION_INPUT_PANEL_PLACEMENT_EVENT = 'generationInputPanelPlacementChanged'

export function parseGenerationInputPanelPlacement(raw: string | null): GenerationInputPanelPlacement {
  return raw === 'left' ? 'left' : 'bottom'
}

export function readGenerationInputPanelPlacement(): GenerationInputPanelPlacement {
  return parseGenerationInputPanelPlacement(localStorage.getItem(GENERATION_INPUT_PANEL_PLACEMENT_KEY))
}

export function setGenerationInputPanelPlacement(placement: GenerationInputPanelPlacement): void {
  localStorage.setItem(GENERATION_INPUT_PANEL_PLACEMENT_KEY, placement)
  window.dispatchEvent(new Event(APPLICATION_SETTINGS_CHANGED_EVENT))
  window.dispatchEvent(new Event(GENERATION_INPUT_PANEL_PLACEMENT_EVENT))
}

export function useGenerationInputPanelPlacement(): GenerationInputPanelPlacement {
  const [placement, setPlacement] = useState(readGenerationInputPanelPlacement)
  useEffect(() => {
    const reload = (): void => setPlacement(readGenerationInputPanelPlacement())
    window.addEventListener(GENERATION_INPUT_PANEL_PLACEMENT_EVENT, reload)
    return () => window.removeEventListener(GENERATION_INPUT_PANEL_PLACEMENT_EVENT, reload)
  }, [])
  return placement
}

/**
 * 左侧面板 360 宽加记录列的最小可读宽度：窗口窄于这个宽度时临时排回底部，变宽后回到左侧，
 * 用户记住的位置不变。
 */
export const GENERATION_SIDE_PANEL_MIN_WORKSPACE_WIDTH = 1100

const GENERATION_SIDE_PANEL_WIDTH_KEY = 'generation_input_panel_width'

/** 左侧输入面板拖动宽度的下限，也是默认宽度 */
export const GENERATION_SIDE_PANEL_MIN_WIDTH = UI_PANEL_WIDTH.generationInput
/** 无论窗口多窄，拖宽至少能放到这个宽度，让长提示词和多参考图有地方放 */
const GENERATION_SIDE_PANEL_MIN_MAX_WIDTH = 520
/** 拖宽后右边记录列至少保留的宽度 */
const GENERATION_HISTORY_MIN_WIDTH = 720

export function readGenerationSidePanelWidth(): number {
  const stored = Number(localStorage.getItem(GENERATION_SIDE_PANEL_WIDTH_KEY))
  return Number.isFinite(stored) && stored >= GENERATION_SIDE_PANEL_MIN_WIDTH ? stored : GENERATION_SIDE_PANEL_MIN_WIDTH
}

export function writeGenerationSidePanelWidth(width: number): void {
  localStorage.setItem(GENERATION_SIDE_PANEL_WIDTH_KEY, String(Math.round(width)))
}

/**
 * 拖宽上限：大约到面板最窄时记录列左缘的位置（面板不越过记录内容），记录列两侧留白不足时至少能拖到 520；
 * 但记录列最小宽度优先，窗口窄到连 520 都放不下时上限会更小，最低仍是 360。
 */
export function resolveGenerationSidePanelMaxWidth(workspaceWidth: number, gutter: number, historyColumnWidth: number): number {
  const remainingAtMin = workspaceWidth - GENERATION_SIDE_PANEL_MIN_WIDTH - gutter * 2
  const historyLeftAtMin = GENERATION_SIDE_PANEL_MIN_WIDTH + Math.max(0, remainingAtMin - historyColumnWidth) / 2
  const keepHistory = workspaceWidth - gutter * 2 - GENERATION_HISTORY_MIN_WIDTH
  return Math.max(GENERATION_SIDE_PANEL_MIN_WIDTH, Math.min(Math.max(GENERATION_SIDE_PANEL_MIN_MAX_WIDTH, historyLeftAtMin), keepHistory))
}
