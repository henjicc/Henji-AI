import type { JsonObject, JsonValue } from '../../types/runtime'

export const NANO21_RATIOS = ['1:1', '2:3', '3:2', '1:4', '4:1', '3:4', '4:3', '4:5', '5:4', '1:8', '8:1', '9:16', '16:9', '21:9'] as const
export const NANO21_RESOLUTIONS = ['1K', '2K', '4K'] as const
export const nano21Options = (values: readonly string[]) => values.map(value => ({ value }))

export function nano21Choice(value: JsonValue, choices: readonly string[], fallback: string): string {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || !choices.includes(value)) throw new Error(`Nano Banana 2.1 不支持参数值 ${String(value)}`)
  return value
}

export function nano21Count(value: JsonValue, max: number): number {
  if (value === undefined) return 1
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`Nano Banana 2.1 当前渠道每次支持 1–${max} 张输出图`)
  }
  return value
}

export function nano21Prompt(params: JsonObject, max?: number): string {
  if (typeof params.prompt !== 'string' || !params.prompt.trim()) throw new Error('请输入 Nano Banana 2.1 提示词')
  if (max !== undefined && params.prompt.length > max) throw new Error(`Nano Banana 2.1 提示词最多 ${max} 字符`)
  return params.prompt
}

/** 智能比例使用供应商原生 auto，不自行裁剪参考图或重新猜测比例。 */
export function nano21Ratio(value: JsonValue): string {
  const ratio = nano21Choice(value, ['smart', 'auto', ...NANO21_RATIOS], 'smart')
  return ratio === 'smart' ? 'auto' : ratio
}
