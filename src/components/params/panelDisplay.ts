/**
 * composite 面板（PanelTrigger）共用的纯展示工具：宽度解析与值格式化。
 * 独立成纯函数模块（非组件文件），供 ParamRenderer（对话模式）与
 * NodeParamControl（画布逐行模式）共同复用，避免同功能多份实现。
 */

import { formatAspectRatioDisplayLabel } from '@/core/params/ratioResolution'
import { getI18nText, type I18nText } from '@/core/types/I18nText'
import { getModelscopeCustomModel } from '@/models/modelscope/customModelRegistry'
import { voiceLibraryService } from '@/services/voiceLibrary/VoiceLibraryService'

export function resolvePanelWidth(config: DynamicValue, fallbackWidth: number): number {
  if (!config || typeof config !== 'object') {
    return fallbackWidth
  }
  const record = config as DynamicValueMap
  const width = typeof record.panelWidth === 'number' ? record.panelWidth : record.width
  if (typeof width === 'number' && Number.isFinite(width) && width > 0) {
    return width
  }
  return fallbackWidth
}

export function formatPanelDisplayValue(
  value: DynamicValue,
  panel: string,
  language: string,
  config?: DynamicValue
): string {
  if (value === undefined || value === null || value === '') return '未设置'

  // ResolutionPanel 的显示逻辑
  if (panel === 'resolution') {
    const record = typeof value === 'object' && value !== null
      ? (value as DynamicValueMap)
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
    return getModelscopeCustomModel(trimmed)?.name || trimmed
  }

  if (panel === 'voice-selector' && typeof value === 'string') {
    const configRecord = config && typeof config === 'object'
      ? (config as DynamicValueMap)
      : null
    const voices = configRecord?.voices
    if (Array.isArray(voices)) {
      const matched = voices.find((item) => {
        if (!item || typeof item !== 'object') {
          return false
        }
        const voice = item as DynamicValueMap
        return voice.id === value
      })
      if (matched && typeof matched === 'object') {
        const matchedRecord = matched as DynamicValueMap
        const name = matchedRecord.name
        if (typeof name === 'string' || (name && typeof name === 'object')) {
          return getI18nText(name as I18nText, language)
        }
      }
    }
    const voiceLibrary = configRecord?.voiceLibrary
    if (voiceLibrary && typeof voiceLibrary === 'object') {
      const libraryRecord = voiceLibrary as DynamicValueMap
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
