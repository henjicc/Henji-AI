/**
 * 有先后顺序的档位（质量、推理强度这类）：选项值全部来自同一套档位词时按 schema 里的顺序排成滑块，
 * “自动”这类不定档排在最右一格（在所有确定档位之后）。只认值、不认模型，新模型沿用同样的取值就自动生效。
 */
const ORDERED_LEVEL_VALUES = new Set(['auto', 'off', 'none', 'minimal', 'low', 'medium', 'regular', 'standard', 'high', 'xhigh', 'ultra', 'max', 'maximum'])
const ORDERED_LEVEL_MIN_OPTIONS = 3

export function isOrderedLevelChoice(options: readonly { value: string | number }[]): boolean {
  return options.length >= ORDERED_LEVEL_MIN_OPTIONS
    && options.every(option => typeof option.value === 'string' && ORDERED_LEVEL_VALUES.has(option.value.toLowerCase()))
}

/** “自动”不是一个确定档位：滑块上排在所有确定档位之后 */
export function orderLevelChoices<T extends { value: string | number }>(options: readonly T[]): T[] {
  const isAuto = (option: T): boolean => String(option.value).toLowerCase() === 'auto'
  return [...options.filter(option => !isAuto(option)), ...options.filter(isAuto)]
}
