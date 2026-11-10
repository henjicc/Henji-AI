import { useEffect, useState } from 'react'
import { APPLICATION_SETTINGS_CHANGED_EVENT } from '@/core/settings/events'

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
