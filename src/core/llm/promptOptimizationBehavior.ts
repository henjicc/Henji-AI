export type PromptOptimizationButtonBehavior = 'select-profile' | 'direct-optimize'

export const PROMPT_OPTIMIZATION_BUTTON_BEHAVIOR_STORAGE_KEY = 'prompt_optimization_button_behavior'
export const PROMPT_OPTIMIZATION_BUTTON_BEHAVIOR_CHANGED_EVENT = 'prompt-optimization-button-behavior-changed'

export function normalizePromptOptimizationButtonBehavior(
  value: unknown
): PromptOptimizationButtonBehavior {
  return value === 'direct-optimize' ? value : 'select-profile'
}

export function readPromptOptimizationButtonBehavior(): PromptOptimizationButtonBehavior {
  if (typeof window === 'undefined') {
    return 'select-profile'
  }

  return normalizePromptOptimizationButtonBehavior(
    window.localStorage.getItem(PROMPT_OPTIMIZATION_BUTTON_BEHAVIOR_STORAGE_KEY)
  )
}

export function writePromptOptimizationButtonBehavior(
  value: PromptOptimizationButtonBehavior
): void {
  if (typeof window === 'undefined') {
    return
  }

  const normalizedValue = normalizePromptOptimizationButtonBehavior(value)
  window.localStorage.setItem(
    PROMPT_OPTIMIZATION_BUTTON_BEHAVIOR_STORAGE_KEY,
    normalizedValue
  )
  window.dispatchEvent(new CustomEvent(PROMPT_OPTIMIZATION_BUTTON_BEHAVIOR_CHANGED_EVENT, {
    detail: normalizedValue,
  }))
}
