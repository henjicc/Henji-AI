import { AiRuntimeError } from '../../runtime/AiRuntimeError'
import type { RetrievalUsage } from './types'

export function invalidInput(message: string): never {
  throw new AiRuntimeError('invalid_parameter', message)
}

export function invalidResponse(message: string): never {
  throw new AiRuntimeError('invalid_response', message)
}

export function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidResponse(`${label} must be an object`)
  return value as Record<string, unknown>
}

export function inputRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidInput('Input must be an object')
  const result = value as Record<string, unknown>
  for (const key of Object.keys(result)) if (!keys.includes(key)) invalidInput(`Unsupported input field: ${key}`)
  return result
}

export function text(value: unknown, label: string, maxCharacters?: number): string {
  if (typeof value !== 'string' || !value.trim()) invalidInput(`${label} must be non-empty text`)
  if (maxCharacters !== undefined && Array.from(value).length > maxCharacters) invalidInput(`${label} exceeds ${maxCharacters} characters`)
  return value
}

export function texts(value: unknown, label: string, maximum?: number, maxCharacters?: number): string[] {
  if (!Array.isArray(value) || value.length === 0) invalidInput(`${label} must be a non-empty array`)
  if (maximum !== undefined && value.length > maximum) invalidInput(`${label} exceeds ${maximum} items`)
  return value.map((item, index) => text(item, `${label}[${index}]`, maxCharacters))
}

export function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) invalidInput(`${label} must be a positive integer`)
  return value
}

export function responseIndex(value: unknown, count: number, seen: Set<number>): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value >= count || seen.has(value)) {
    invalidResponse('Result index is missing, duplicate or outside the input range')
  }
  seen.add(value)
  return value
}

export function usage(value: unknown): RetrievalUsage | undefined {
  if (value === undefined || value === null) return undefined
  const raw = record(value, 'usage')
  const output: RetrievalUsage = {}
  for (const [target, source] of [
    ['inputTokens', raw.prompt_tokens ?? raw.input_tokens],
    ['outputTokens', raw.completion_tokens ?? raw.output_tokens],
    ['totalTokens', raw.total_tokens],
  ] as const) {
    if (source === undefined || source === null) continue
    if (typeof source !== 'number' || !Number.isSafeInteger(source) || source < 0) invalidResponse(`Invalid usage.${target}`)
    output[target] = source
  }
  return Object.keys(output).length ? output : undefined
}
