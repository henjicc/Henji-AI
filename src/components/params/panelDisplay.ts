/**
 * composite 面板（PanelTrigger）共用的纯展示工具：宽度解析与值格式化。
 * 独立成纯函数模块（非组件文件），供 ParamRenderer（对话模式）与
 * NodeParamControl（画布逐行模式）共同复用，避免同功能多份实现。
 */

import { formatAspectRatioDisplayLabel } from '@/core/params/ratioResolution'
import { getI18nText, type I18nText } from '@/core/types/I18nText'
import { voiceLibraryService } from '@/services/voiceLibrary/VoiceLibraryService'

export function resolvePanelWidth(config: unknown, fallbackWidth: number): number {
  if (!config || typeof config !== 'object') {
    return fallbackWidth
  }
  const record = config as Record<string, unknown>
  const width = typeof record.panelWidth === 'number' ? record.panelWidth : record.width
  if (typeof width === 'number' && Number.isFinite(width) && width > 0) {
    return width
  }
  return fallbackWidth
}

export function formatPanelDisplayValue(
  value: unknown,
  panel: string,
  language: string,
  config?: unknown
): string {
  if (value === undefined || value === null || value === '') return '未设置'

  // ResolutionPanel 的显示逻辑
  if (panel === 'resolution') {
    const record = typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : null
    if (!record) {
      return '未设置'
    }
    const quality = typeof record.quality === 'string' ? record.quality : ''
    const joinQuality = (label: string): string => quality ? `${label} / ${quality}` : label
    if (record.aspectRatio === 'smart') return joinQuality('智能')
    if (record.aspectRatio) {
      return joinQuality(formatAspectRatioDisplayLabel(String(record.aspectRatio), String(record.aspectRatio)))
    }
    if (typeof record.preset === 'string') return joinQuality(record.preset)
    if (typeof record.width === 'number' && typeof record.height === 'number') {
      return `${record.width}×${record.height}`
    }
  }

  if (panel === 'modelscope-custom-model') {
    if (typeof value !== 'string') return '未设置'
    const trimmed = value.trim()
    if (!trimmed) return '未设置'

    try {
      const stored = localStorage.getItem('modelscope_custom_models')
      if (!stored) return trimmed
      const parsed = JSON.parse(stored) as unknown
      if (!Array.isArray(parsed)) return trimmed
      const match = parsed.find((item) => {
        if (!item || typeof item !== 'object') return false
        const record = item as Record<string, unknown>
        return record.id === trimmed
      }) as Record<string, unknown> | undefined
      if (!match) return trimmed
      const name = typeof match.name === 'string' ? match.name.trim() : ''
      return name || trimmed
    } catch {
      return trimmed
    }
  }

  if (panel === 'voice-selector' && typeof value === 'string') {
    const configRecord = config && typeof config === 'object'
      ? (config as Record<string, unknown>)
      : null
    const voices = configRecord?.voices
    if (Array.isArray(voices)) {
      const matched = voices.find((item) => {
        if (!item || typeof item !== 'object') {
          return false
        }
        const voice = item as Record<string, unknown>
        return voice.id === value
      })
      if (matched && typeof matched === 'object') {
        const matchedRecord = matched as Record<string, unknown>
        const name = matchedRecord.name
        if (typeof name === 'string' || (name && typeof name === 'object')) {
          return getI18nText(name as I18nText, language)
        }
      }
    }
    const voiceLibrary = configRecord?.voiceLibrary
    if (voiceLibrary && typeof voiceLibrary === 'object') {
      const libraryRecord = voiceLibrary as Record<string, unknown>
      const providerId = typeof libraryRecord.providerId === 'string' ? libraryRecord.providerId : undefined
      const modelId = typeof libraryRecord.modelId === 'string' ? libraryRecord.modelId : undefined
      const cachedName = voiceLibraryService.getCachedVoiceName(value, { providerId, modelId })
      if (cachedName) {
        return cachedName
      }
    }
    return value
  }

  if (panel === 'minimax-voice-clone') {
    return '点击设置'
  }

  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? `${value.length}项` : '未设置'
  }
  if (typeof value === 'object') {
    if (panel === 'composite' || panel === 'minimax-voice-clone') {
      return '点击设置'
    }
    return '已配置'
  }

  // 默认显示
  return String(value)
}
