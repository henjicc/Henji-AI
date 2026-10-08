import { MAX_ENTRY_NAME_LENGTH } from './naming'

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** 自动产物名使用短摘要；预算沿名称校验的 UTF-16 长度，切点始终在完整字素边界。 */
export function generatedMediaName(text: string | null | undefined, fallback = '生成结果', maxLength = 80): string {
  const budget = Math.max(1, Math.min(MAX_ENTRY_NAME_LENGTH, maxLength))
  const normalized = text?.trim().replace(/\s+/gu, ' ') || fallback.trim() || '生成结果'
  if (normalized.length <= budget) return normalized
  let stem = ''
  for (const { segment } of graphemes.segment(normalized)) {
    if (stem.length + segment.length > budget - 1) break
    stem += segment
  }
  return `${stem.trimEnd()}…`
}
