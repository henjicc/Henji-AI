import { useEffect, useState } from 'react'
import { APPLICATION_SETTINGS_CHANGED_EVENT } from '@/core/settings/events'

/**
 * 生成记录里最新结果的位置：`auto` 跟着输入面板走（面板在底部时最新在下、贴着输入框；
 * 在左侧时最新在上，眼睛从顶部开始读），`bottom` / `top` 固定。
 */
export type GenerationHistoryOrder = 'auto' | 'bottom' | 'top'

export const GENERATION_HISTORY_ORDER_KEY = 'generation_history_order'
export const GENERATION_HISTORY_ORDER_EVENT = 'generationHistoryOrderChanged'

export function parseGenerationHistoryOrder(raw: string | null): GenerationHistoryOrder {
  return raw === 'bottom' || raw === 'top' ? raw : 'auto'
}

export function setGenerationHistoryOrder(order: GenerationHistoryOrder): void {
  localStorage.setItem(GENERATION_HISTORY_ORDER_KEY, order)
  window.dispatchEvent(new Event(APPLICATION_SETTINGS_CHANGED_EVENT))
  window.dispatchEvent(new Event(GENERATION_HISTORY_ORDER_EVENT))
}

export function useGenerationHistoryOrder(): GenerationHistoryOrder {
  const read = (): GenerationHistoryOrder => parseGenerationHistoryOrder(localStorage.getItem(GENERATION_HISTORY_ORDER_KEY))
  const [order, setOrder] = useState(read)
  useEffect(() => {
    const reload = (): void => setOrder(read())
    window.addEventListener(GENERATION_HISTORY_ORDER_EVENT, reload)
    return () => window.removeEventListener(GENERATION_HISTORY_ORDER_EVENT, reload)
  }, [])
  return order
}

/** 最新结果是否排在列表顶部。`sideDocked` 是输入面板实际停在左侧（窗口太窄临时回到底部时按底部算）。 */
export function resolveNewestFirst(order: GenerationHistoryOrder, sideDocked: boolean): boolean {
  return order === 'auto' ? sideDocked : order === 'top'
}
