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

const DISPLAY_TEXT = {
  unset: { zh: '未设置', en: 'Not set' },
  defaults: { zh: '默认', en: 'Default' },
  adjusted: { zh: '已调整 {n} 项', en: '{n} changed' },
  configured: { zh: '已设置', en: 'Set' },
  notCloned: { zh: '未克隆', en: 'Not cloned' },
  cloned: { zh: '已克隆', en: 'Cloned' },
  items: { zh: '{n}项', en: '{n} items' },
} as const

function displayText(key: keyof typeof DISPLAY_TEXT, language: string, count?: number): string {
  const text = getI18nText(DISPLAY_TEXT[key], language)
  return count === undefined ? text : text.replace('{n}', String(count))
}

function sameValue(left: DynamicValue, right: DynamicValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/**
 * 复合面板（高级选项这类一组字段）显示“当前值”而不是行动号召（任务 5.8，P-24）：
 * 与参数默认值逐项比较，全部未改 = “默认”，否则“已调整 N 项”；拿不到默认值时按有无内容显示“默认 / 已设置”。
 */
function describeCompositeValue(value: DynamicValueMap, language: string, defaultValue?: DynamicValue): string {
  if (defaultValue && typeof defaultValue === 'object' && !Array.isArray(defaultValue)) {
    const defaults = defaultValue as DynamicValueMap
    const keys = new Set([...Object.keys(defaults), ...Object.keys(value)])
    let changed = 0
    for (const key of keys) {
      if (value[key] === undefined) continue
      if (!sameValue(value[key], defaults[key])) changed += 1
    }
    return changed === 0 ? displayText('defaults', language) : displayText('adjusted', language, changed)
  }
  const filled = Object.values(value).some(item => item !== undefined && item !== null && item !== '' && item !== false)
  return filled ? displayText('configured', language) : displayText('defaults', language)
}

export function formatPanelDisplayValue(
  value: DynamicValue,
  panel: string,
  language: string,
  config?: DynamicValue,
  defaultValue?: DynamicValue
): string {
  if (value === undefined || value === null || value === '') {
    // 复合面板没有取值时就是全部默认
    if (panel === 'composite') return displayText('defaults', language)
    if (panel === 'minimax-voice-clone') return displayText('notCloned', language)
    return displayText('unset', language)
  }

  if (panel === 'modelscope-custom-model') {
    if (typeof value !== 'string') return displayText('unset', language)
    const trimmed = value.trim()
    if (!trimmed) return displayText('unset', language)
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
    // 当前值：克隆出的音色名；还没克隆过就是“未克隆”
    const record = typeof value === 'object' && !Array.isArray(value) ? value as DynamicValueMap : {}
    const hasResult = Boolean(record.lastPreviewAudioFilePath || record.lastPreviewAudioUrl)
    const voiceName = typeof record.voiceName === 'string' ? record.voiceName.trim() : ''
    if (!hasResult) return displayText('notCloned', language)
    return voiceName || displayText('cloned', language)
  }

  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? displayText('items', language, value.length) : displayText('unset', language)
  }
  if (typeof value === 'object') {
    if (panel === 'composite') {
      return describeCompositeValue(value as DynamicValueMap, language, defaultValue)
    }
    return displayText('configured', language)
  }

  // 默认显示
  return String(value)
}
