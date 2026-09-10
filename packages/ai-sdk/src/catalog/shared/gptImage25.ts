import type { JsonObject, JsonValue } from '../../types/runtime'
import { hasUploadedImage, resolveUploadedImageSources } from './mediaPresence'

export const GPT25_RATIOS = ['1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '2:1', '1:2', '21:9', '9:21', '3:1', '1:3']
export const GPT25_EXT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9']
export const GPT25_KIE_RATIOS = ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9', '27:16', '16:27', '9:8', '8:9']
export const GPT25_KIE_1K_RATIOS = ['27:16', '16:27', '9:8', '8:9']
export const GPT25_QUALITIES = ['auto', 'low', 'medium', 'high', 'xhigh', 'max']
export const GPT25_RESOLUTIONS = ['1K', '2K', '4K']
export const GPT25_BACKGROUNDS = ['auto', 'opaque', 'transparent']
export const gpt25Options = (values: readonly string[]) => values.map(value => ({ value }))

export function gpt25Choice(value: JsonValue, values: readonly string[], fallback: string): string {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || !values.includes(value)) throw new Error(`GPT Image 2.5 参数不支持：${String(value)}`)
  return value
}

export function gpt25Count(value: JsonValue, max: number): number {
  if (value === undefined) return 1
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`GPT Image 2.5 生成数量必须为 1–${max} 的整数`)
  }
  return value
}

export function gpt25Images(params: JsonObject): string[] {
  const images = resolveUploadedImageSources(params)
  if (images.length > 16) throw new Error('GPT Image 2.5 最多支持 16 张参考图')
  return images
}

export function gpt25Prompt(params: JsonObject, max?: number): string {
  if (typeof params.prompt !== 'string' || !params.prompt.trim()) throw new Error('请输入 GPT Image 2.5 提示词')
  if (max !== undefined && params.prompt.length > max) throw new Error(`GPT Image 2.5 提示词最多 ${max} 字符`)
  return params.prompt
}

export function gpt25Ratio(params: JsonObject, value: JsonValue, candidates: readonly string[]): string {
  const raw = gpt25Choice(value, ['smart', ...candidates], 'smart')
  if (raw !== 'smart') return raw
  const hint = hasUploadedImage(params) && typeof params.__firstImageRatio === 'number'
    && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0 ? params.__firstImageRatio : 1
  return candidates.reduce((best, next) => {
    const numeric = (ratio: string) => { const [w, h] = ratio.split(':').map(Number); return w / h }
    return Math.abs(numeric(next) - hint) < Math.abs(numeric(best) - hint) ? next : best
  }, '1:1')
}
