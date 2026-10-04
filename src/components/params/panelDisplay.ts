/**
 * composite 面板（PanelTrigger）共用的纯展示工具：宽度解析与值格式化。
 * 独立成纯函数模块（非组件文件），供 ParamRenderer（对话模式）与
 * NodeParamControl（画布逐行模式）共同复用，避免同功能多份实现。
 */

import { getI18nText, type I18nText } from '@/core/types/I18nText'
import { getModelscopeCustomModel } from '@henjicc/ai-sdk'
import { voiceLibraryService } from '@/services/voiceLibrary/VoiceLibraryService'
import { getTtsVoiceName } from '@/services/voiceLibrary/ttsVoiceNameCache'

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
    const remoteModelId = configRecord?.remoteModelId
    if (typeof remoteModelId === 'string') {
      const remoteName = getTtsVoiceName(remoteModelId, value)
      if (remoteName) return remoteName
    }
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
