import { toDisplaySrc as convertFileSrc } from '@/platform/desktopApi'
import type { GenerateResult } from '@/core/providers/base'
import {
  AUDIO_ACCEPT_LIST,
  DEFAULT_VALUE,
  MAX_AUDIO_SIZE_MB,
  type MinimaxVoiceClonePanelValue,
} from './types'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function normalizeString(value: unknown): string {
  if (typeof value !== 'string') {
    return ''
  }
  return value.trim()
}

export function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value
  }
  return fallback
}

export function normalizeNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }
  return parsed
}

export function normalizeValue(value: unknown): MinimaxVoiceClonePanelValue {
  const record = isRecord(value) ? value : {}
  return {
    voiceName: normalizeString(record.voiceName),
    cloneAudioFilePath: normalizeString(record.cloneAudioFilePath),
    cloneAudioFileName: normalizeString(record.cloneAudioFileName),
    promptEnabled: normalizeBoolean(record.promptEnabled, DEFAULT_VALUE.promptEnabled),
    promptAudioFilePath: normalizeString(record.promptAudioFilePath),
    promptAudioFileName: normalizeString(record.promptAudioFileName),
    promptText: normalizeString(record.promptText),
    previewText: normalizeString(record.previewText),
    previewModel: normalizeString(record.previewModel) || DEFAULT_VALUE.previewModel,
    accuracy: Math.max(0, Math.min(1, normalizeNumber(record.accuracy, DEFAULT_VALUE.accuracy))),
    needNoiseReduction: normalizeBoolean(record.needNoiseReduction, DEFAULT_VALUE.needNoiseReduction),
    needVolumeNormalization: normalizeBoolean(record.needVolumeNormalization, DEFAULT_VALUE.needVolumeNormalization),
    lastPreviewAudioUrl: normalizeString(record.lastPreviewAudioUrl),
    lastPreviewAudioFilePath: normalizeString(record.lastPreviewAudioFilePath),
  }
}

export function parseAudioError(file: File): string | undefined {
  const lowerName = file.name.toLowerCase()
  const mime = file.type.toLowerCase()
  const accepted = AUDIO_ACCEPT_LIST.some((item) => {
    const normalized = item.toLowerCase()
    if (normalized.startsWith('.')) {
      return lowerName.endsWith(normalized)
    }
    return mime === normalized
  })
  if (!accepted) {
    return '仅支持 mp3 / m4a / wav 文件'
  }
  const maxBytes = MAX_AUDIO_SIZE_MB * 1024 * 1024
  if (file.size > maxBytes) {
    return `音频大小不能超过 ${MAX_AUDIO_SIZE_MB}MB`
  }
  return undefined
}

export function toDisplayAudioSrc(value: string): string {
  const source = value.trim()
  if (!source) return ''
  if (
    source.startsWith('http://') ||
    source.startsWith('https://') ||
    source.startsWith('blob:') ||
    source.startsWith('data:') ||
    source.startsWith('asset://') ||
    source.startsWith('tauri://') ||
    source.startsWith('http://asset.localhost/') ||
    source.startsWith('https://asset.localhost/') ||
    source.startsWith('http://tauri.localhost/') ||
    source.startsWith('https://tauri.localhost/')
  ) {
    return source
  }
  return convertFileSrc(source.replace(/\\/g, '/'))
}

export function extractVoiceId(metadata: unknown): string {
  if (!isRecord(metadata)) {
    return ''
  }

  const direct = normalizeString(metadata.voice_id)
  if (direct) return direct

  if (isRecord(metadata.data)) {
    const nested = normalizeString(metadata.data.voice_id)
    if (nested) return nested
  }

  if (isRecord(metadata.task) && isRecord(metadata.task.output)) {
    const nested = normalizeString(metadata.task.output.voice_id)
    if (nested) return nested
  }

  return ''
}

export function extractPreviewAudioUrl(result: GenerateResult): string {
  const metadata = result.metadata
  if (isRecord(metadata)) {
    const candidates: unknown[] = [
      metadata.demo_audio_url,
      metadata.audio_url,
      metadata.audio,
      isRecord(metadata.data) ? metadata.data.demo_audio_url : undefined,
      isRecord(metadata.data) ? metadata.data.audio_url : undefined,
      isRecord(metadata.data) ? metadata.data.audio : undefined,
      isRecord(metadata.task) && isRecord(metadata.task.output) ? metadata.task.output.demo_audio_url : undefined,
      isRecord(metadata.task) && isRecord(metadata.task.output) ? metadata.task.output.audio_url : undefined,
      isRecord(metadata.task) && isRecord(metadata.task.output) ? metadata.task.output.audio : undefined,
    ]
    for (const candidate of candidates) {
      const normalized = normalizeString(candidate)
      if (normalized) return normalized
    }
  }

  return normalizeString(result.url)
}
