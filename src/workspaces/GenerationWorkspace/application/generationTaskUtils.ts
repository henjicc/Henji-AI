import { toDisplaySrc } from '@/platform/desktopApi'

import type { GeneratorOptions } from '../types'
import { isRecord, isStringArray } from '../utils/typeGuards'

export function asGeneratorOptions(value: DynamicValue): GeneratorOptions {
  return isRecord(value) ? (value as GeneratorOptions) : {}
}

export function classifyMediaSourceKind(source: string): string {
  const trimmed = source.trim()
  if (!trimmed) return 'empty'
  if (trimmed.startsWith('data:')) return 'data-url'
  if (trimmed.startsWith('blob:')) return 'blob-url'
  if (trimmed.startsWith('asset://localhost/')) return 'asset-url'
  if (trimmed.startsWith('tauri://localhost/')) return 'legacy-tauri-url'
  if (trimmed.startsWith('http://asset.localhost/') || trimmed.startsWith('https://asset.localhost/')) return 'asset-http-url'
  if (trimmed.startsWith('http://tauri.localhost/') || trimmed.startsWith('https://tauri.localhost/')) return 'legacy-tauri-http-url'
  if (trimmed.startsWith('file://')) return 'file-url'
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return 'remote-url'
  if (/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(trimmed)) return 'local-path'
  return 'other'
}

export function summarizeMediaSources(values: DynamicValue): Array<DynamicValueMap> {
  if (!isStringArray(values)) return []
  return values.map((value, index) => ({
    index,
    kind: classifyMediaSourceKind(value),
    length: value.length,
    preview: value.startsWith('data:') ? value.slice(0, 48) : value.slice(0, 140),
  }))
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
