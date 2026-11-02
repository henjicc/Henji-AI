import { toDisplaySrc } from '@/platform/desktopApi'

import type { GeneratorOptions } from '../types'
import { isRecord } from '../utils/typeGuards'

export function asGeneratorOptions(value: DynamicValue): GeneratorOptions {
  return isRecord(value) ? (value as GeneratorOptions) : {}
}

export function isFileValue(value: DynamicValue): value is File {
  return typeof File !== 'undefined' && value instanceof File
}

export function toVideoDisplayUrl(path: string): string {
  return toDisplaySrc(path.replace(/\\/g, '/'))
}

export function isLikelyVideoSource(value: string): boolean {
  const source = value.trim()
  if (!source) return false
  if (source.startsWith('data:video/') || source.startsWith('blob:')) return true
  if (source.startsWith('asset://localhost/') || source.startsWith('tauri://localhost/')) return true
  if (source.startsWith('file://') || source.startsWith('http://') || source.startsWith('https://')) return true
  return /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(source)
}

export function normalizeNonEmptyString(value: DynamicValue): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function isMinimaxVoiceCloneMode(options: GeneratorOptions): boolean {
  return options.minimaxMode === 'voice-clone'
}

export function asMutableRecord(value: DynamicValue): DynamicValueMap {
  return isRecord(value) ? { ...value } : {}
}
