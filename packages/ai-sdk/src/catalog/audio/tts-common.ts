import type { JsonObject, JsonValue } from '../../types/runtime'

/** maxChars 是供应商单次请求的文本上限，按 Unicode 字符计；超过时在发请求前拒绝。 */
export function speechText(params: JsonObject, maxChars?: number): string {
  const value = typeof params.text === 'string' ? params.text : params.prompt
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('语音合成需要非空文本')
  }
  if (maxChars !== undefined && [...value].length > maxChars) {
    throw new Error(`语音合成单次最多 ${maxChars} 字，请分段生成`)
  }
  return value
}

export function speechString(value: JsonValue): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function speechNumber(value: JsonValue): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function speechCharacterPrice(params: JsonObject, perThousand: number): number {
  const value = typeof params.text === 'string' ? params.text : params.prompt
  return typeof value === 'string' ? (Array.from(value).length * perThousand) / 1000 : 0
}
