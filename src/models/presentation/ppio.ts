/** 派欧云（ppio）模型的展示补丁：i18n 文案、联动、面板布局。按模型 id 关联运行时定义。 */

import { modelScopedText, sharedFieldText, sharedModeText, sharedOptionText } from '@/core/i18n/modelText'
import type { ModelPresentation } from '@/core/types/ModelPresentation'
import type { VoiceSelectorConfig } from '@/core/types/PanelTypes'
import type { CompositePanelConfig } from '@/core/types/CompositePanel'
import { buildVoiceFeatureTags } from '@/core/voice/voiceFeatureTags'
import minimaxSpeechVoicesCatalog from './data/minimax-speech-voices.json'

interface MinimaxVoiceCatalogItem {
  voice_id?: unknown
  description?: unknown
  voice_name?: unknown
}

interface MinimaxVoiceCatalog {
  system_voice?: MinimaxVoiceCatalogItem[]
}

function normalizeVoiceText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeVoiceDescription(value: unknown): string | null {
  if (typeof value === 'string') {
    return normalizeVoiceText(value)
  }
  if (!Array.isArray(value)) {
    return null
  }
  for (const item of value) {
    const description = normalizeVoiceText(item)
    if (description) {
      return description
    }
  }
  return null
}

function buildVoiceSelectorVoices(source: unknown): VoiceSelectorConfig['voices'] {
  if (!source || typeof source !== 'object') {
    return []
  }
  const catalog = source as MinimaxVoiceCatalog
  const systemVoices = Array.isArray(catalog.system_voice) ? catalog.system_voice : []
  const seenIds = new Set<string>()
  const voices: VoiceSelectorConfig['voices'] = []

  for (const voice of systemVoices) {
    const voiceId = normalizeVoiceText(voice.voice_id)
    const voiceName = normalizeVoiceText(voice.voice_name)
    if (!voiceId || !voiceName || seenIds.has(voiceId)) {
      continue
    }
    seenIds.add(voiceId)
    const description = normalizeVoiceDescription(voice.description)
    voices.push({
      id: voiceId,
      name: voiceName,
      description: description ?? undefined,
      tags: buildVoiceFeatureTags({
        voiceId,
        voiceName,
        description: description ?? undefined,
        source: 'system',
      }),
    })
  }

  return voices
}

// 系统音色目录第一项的 voice_id 恰好是 'male-qn-qingse'，与运行时定义里
// `minimaxVoiceId.default` 的硬编码值一致（见 packages/ai-sdk/src/catalog/ppio/minimax-speech.model.ts
// 的注释）——运行时侧不需要引入整份音色目录，只需要这一个已经确认过的默认值字符串。
const MINIMAX_SELECTOR_VOICES = buildVoiceSelectorVoices(minimaxSpeechVoicesCatalog)

const VOICE_SELECTOR_CONFIG: VoiceSelectorConfig = {
  allowSearch: true,
  voices: MINIMAX_SELECTOR_VOICES,
  voiceLibrary: {
    providerId: 'ppio',
    modelId: 'ppio-minimax-speech',
    allowDelete: true,
  },
}

const CLONE_PREVIEW_MODEL_OPTIONS = [
  { value: 'speech-2.6-hd', label: 'speech-2.6-hd' },
  { value: 'speech-2.6-turbo', label: 'speech-2.6-turbo' },
  { value: 'speech-2.8-hd', label: 'speech-2.8-hd' },
  { value: 'speech-2.8-turbo', label: 'speech-2.8-turbo' },
]

const ADVANCED_PANEL_CONFIG: CompositePanelConfig = {
  layout: 'grid',
  gap: 12,
  gridColumns: 3,
  components: [
    { id: 'audioVol', type: 'number-input', label: sharedFieldText('volume'), config: { min: 0.1, max: 10, step: 0.1 } },
    { id: 'audioPitch', type: 'number-input', label: sharedFieldText('pitch'), config: { min: -12, max: 12, step: 1 } },
    { id: 'audioSpeed', type: 'number-input', label: sharedFieldText('speed'), config: { min: 0.5, max: 2, step: 0.1 } },
    {
      id: 'audioSampleRate',
      type: 'dropdown',
      label: sharedFieldText('sampleRate'),
      config: {
        options: [
          { value: 8000, label: '8000 Hz' },
          { value: 16000, label: '16000 Hz' },
          { value: 22050, label: '22050 Hz' },
          { value: 24000, label: '24000 Hz' },
          { value: 32000, label: '32000 Hz' },
          { value: 44100, label: '44100 Hz' },
        ],
      },
    },
    {
      id: 'bitrate',
      type: 'dropdown',
      label: sharedFieldText('bitrate'),
      config: {
        options: [
          { value: 32000, label: '32 kbps' },
          { value: 64000, label: '64 kbps' },
          { value: 128000, label: '128 kbps' },
          { value: 256000, label: '256 kbps' },
        ],
      },
    },
    {
      id: 'format',
      type: 'dropdown',
      label: sharedFieldText('audioFormat'),
      config: {
        options: [
          { value: 'mp3', label: 'MP3' },
          { value: 'pcm', label: 'PCM' },
          { value: 'flac', label: 'FLAC' },
        ],
      },
    },
    {
      id: 'channel',
      type: 'dropdown',
      label: sharedFieldText('channel'),
      config: {
        options: [
          { value: 1, label: { zh: '单声道', en: 'Mono' } },
          { value: 2, label: { zh: '立体声', en: 'Stereo' } },
        ],
      },
    },
    {
      id: 'englishNormalization',
      type: 'switch',
      label: { zh: '英文规范化', en: 'English Normalization' },
      config: {},
    },
    {
      id: 'continuousSound',
      type: 'switch',
      label: { zh: '自然衔接', en: 'Continuous Sound' },
      config: {},
    },
  ],
}

const MINIMAX_VOICE_CLONE_PANEL_CONFIG = {
  providerId: 'ppio',
  modelId: 'ppio-minimax-speech',
  previewModels: CLONE_PREVIEW_MODEL_OPTIONS,
}

const ratioLabel = (ratio: string) => ({ label: ratio })

export const ppioPresentation: Record<string, ModelPresentation> = {
  'ppio-kling-3.0': {
    meta: {
      name: { key: 'meta.name', fallback: 'Kling 3.0' },
      i18nScope: 'models.defs.ppio-kling-3.0',
    },
    params: {
      ppioKling30Mode: {
        name: sharedFieldText('mode'),
        optionLabels: {
          'text-image-to-video': { label: sharedModeText('textImageToVideo') },
          'motion-control': { label: sharedModeText('motionControl') },
        },
      },
      ppioKling30Resolution: {
        name: sharedFieldText('resolution'),
        optionLabels: { '720P': ratioLabel('720P'), '1080P': ratioLabel('1080P'), '4K': ratioLabel('4K') },
      },
      ppioKling30Duration: {
        name: sharedFieldText('duration'),
        optionLabels: Object.fromEntries(
          Array.from({ length: 13 }, (_, index) => index + 3).map((value) => [String(value), { label: `${value}s` }])
        ),
      },
      ppioKling30AspectRatio: {
        name: sharedFieldText('aspectRatio'),
        optionLabels: { '16:9': ratioLabel('16:9'), '9:16': ratioLabel('9:16'), '1:1': ratioLabel('1:1') },
      },
      ppioKling30CfgScale: {
        name: sharedFieldText('cfgScale'),
      },
      ppioKling30Sound: {
        name: sharedFieldText('generateAudio'),
      },
      ppioKling30CharacterOrientation: {
        name: sharedFieldText('characterOrientation'),
        tooltip: modelScopedText(
          'params.ppioKling30CharacterOrientation.tooltip',
          'Video: follow the reference video pose and composition, output duration follows the reference video up to 30s. Image: keep the reference image pose and composition, output 5s.'
        ),
        optionLabels: {
          video: { label: sharedOptionText('consistentWithVideo') },
          image: { label: sharedOptionText('consistentWithImage') },
        },
      },
      ppioKling30KeepOriginalSound: {
        name: sharedFieldText('keepOriginalSound'),
      },
    },
    linkages: [
      {
        trigger: 'ppioKling30Mode',
        effect: 'filterOptions',
        target: 'ppioKling30Resolution',
        filter: (mode, options) => {
          if (mode === 'motion-control') {
            return options.filter((option) => option.value !== '4K')
          }
          return options
        }
      },
      {
        trigger: 'ppioKling30Mode',
        effect: 'autoSwitch',
        target: 'ppioKling30Resolution',
        condition: (mode, allParams) => mode === 'motion-control' && allParams.ppioKling30Resolution === '4K',
        value: '1080P'
      }
    ],
  },

  'ppio-minimax-hailuo-2.3': {
    meta: {
      name: { key: 'meta.name', fallback: 'Minimax Hailuo 2.3' },
      i18nScope: 'models.defs.ppio-minimax-hailuo-2.3',
    },
    params: {
      ppioHailuo23VideoDuration: {
        name: sharedFieldText('duration'),
        optionLabels: { '6': { label: '6s' }, '10': { label: '10s' } },
      },
      ppioHailuo23VideoResolution: {
        name: sharedFieldText('resolution'),
        optionLabels: { '768P': ratioLabel('768P'), '1080P': ratioLabel('1080P') },
      },
      ppioHailuo23FastMode: {
        name: sharedFieldText('fastMode'),
      },
      ppioHailuo23PromptExtend: {
        name: sharedFieldText('promptExtension'),
      },
    },
    linkages: [
      {
        trigger: 'uploadedImages',
        effect: 'hide',
        targets: ['ppioHailuo23FastMode'],
        condition: (images) => (images?.length || 0) === 0
      },
      {
        trigger: 'ppioHailuo23VideoDuration',
        effect: 'filterOptions',
        target: 'ppioHailuo23VideoResolution',
        filter: (duration, options) => {
          if (duration === 10) {
            return options.filter(opt => opt.value !== '1080P')
          }
          return options
        }
      },
      {
        trigger: 'ppioHailuo23VideoDuration',
        effect: 'autoSwitch',
        target: 'ppioHailuo23VideoResolution',
        condition: (duration, allParams) => {
          const resolution = allParams.ppioHailuo23VideoResolution
          return duration === 10 && resolution === '1080P'
        },
        value: '768P'
      }
    ],
  },

  'ppio-wan-2.5-preview': {
    meta: {
      name: { key: 'meta.name', fallback: 'Wan 2.5 Preview' },
      i18nScope: 'models.defs.ppio-wan-2.5-preview',
    },
    params: {
      ppioWan25VideoDuration: {
        name: sharedFieldText('duration'),
        optionLabels: { '5': { label: '5s' }, '10': { label: '10s' } },
      },
      ppioWan25Size: {
        name: sharedFieldText('size'),
        optionLabels: {
          '832*480': { label: '832×480' },
          '480*832': { label: '480×832' },
          '624*624': { label: '624×624' },
          '1280*720': { label: '1280×720' },
          '720*1280': { label: '720×1280' },
          '960*960': { label: '960×960' },
          '1088*832': { label: '1088×832' },
          '832*1088': { label: '832×1088' },
          '1920*1080': { label: '1920×1080' },
          '1080*1920': { label: '1080×1920' },
          '1440*1440': { label: '1440×1440' },
          '1632*1248': { label: '1632×1248' },
          '1248*1632': { label: '1248×1632' },
        },
      },
      ppioWan25Resolution: {
        name: sharedFieldText('resolution'),
        optionLabels: { '480P': ratioLabel('480P'), '720P': ratioLabel('720P'), '1080P': ratioLabel('1080P') },
      },
      ppioWan25PromptExtend: {
        name: sharedFieldText('promptRewrite'),
      },
      ppioWan25Audio: {
        name: sharedFieldText('generateAudio'),
      },
    },
    linkages: [
      {
        trigger: 'uploadedImages',
        effect: 'hide',
        targets: ['ppioWan25Size'],
        condition: (images) => (images?.length || 0) > 0
      },
      {
        trigger: 'uploadedImages',
        effect: 'hide',
        targets: ['ppioWan25Resolution'],
        condition: (images) => (images?.length || 0) === 0
      }
    ],
  },

  'ppio-wan-2.6': {
    meta: {
      name: { key: 'meta.name', fallback: 'Wan 2.6' },
      i18nScope: 'models.defs.ppio-wan-2.6',
    },
    params: {
      ppioWan26Mode: {
        name: sharedFieldText('mode'),
        optionLabels: {
          'text-image-to-video': { label: sharedModeText('textImageToVideo') },
          'reference-to-video': { label: sharedModeText('referenceToVideo') },
        },
      },
      ppioWan26AspectRatio: {
        name: sharedFieldText('resolution'),
        optionLabels: {
          '16:9': ratioLabel('16:9'), '9:16': ratioLabel('9:16'), '1:1': ratioLabel('1:1'),
          '4:3': ratioLabel('4:3'), '3:4': ratioLabel('3:4'),
        },
      },
      ppioWan26Quality: {
        name: sharedFieldText('quality'),
        optionLabels: { '720P': ratioLabel('720P'), '1080P': ratioLabel('1080P') },
      },
      ppioWan26VideoDuration: {
        name: sharedFieldText('duration'),
        optionLabels: { '5': { label: '5s' }, '10': { label: '10s' }, '15': { label: '15s' } },
      },
      ppioWan26ShotType: {
        name: sharedFieldText('shotType'),
        optionLabels: {
          multi: { label: sharedOptionText('multiShot') },
          single: { label: sharedOptionText('singleShot') },
        },
      },
      ppioWan26Audio: {
        name: sharedFieldText('generateAudio'),
      },
      ppioWan26PromptExtend: {
        name: sharedFieldText('promptExtension'),
      },
    },
    linkages: [
      {
        trigger: 'ppioWan26Mode',
        effect: 'autoSwitch',
        target: 'ppioWan26VideoDuration',
        condition: (mode: string, allParams: Record<string, unknown>) => {
          const duration = allParams.ppioWan26VideoDuration || 5
          return mode === 'reference-to-video' && duration === 15
        },
        value: 10
      }
    ],
  },

  'ppio-wan-2.7': {
    meta: {
      name: { key: 'meta.name', fallback: 'Wan 2.7' },
      i18nScope: 'models.defs.ppio-wan-2.7',
    },
    params: {
      ppioWan27Mode: {
        name: sharedFieldText('mode'),
        optionLabels: {
          'text-image-to-video': { label: sharedModeText('textImageToVideo') },
          'reference-to-video': { label: sharedModeText('referenceToVideo') },
          'video-edit': { label: sharedModeText('videoEdit') },
        },
      },
      ppioWan27AspectRatio: {
        name: sharedFieldText('aspectRatio'),
        optionLabels: {
          '16:9': ratioLabel('16:9'), '9:16': ratioLabel('9:16'), '1:1': ratioLabel('1:1'),
          '4:3': ratioLabel('4:3'), '3:4': ratioLabel('3:4'),
        },
      },
      ppioWan27EditRatio: {
        name: sharedFieldText('aspectRatio'),
        optionLabels: {
          auto: { label: sharedOptionText('smart') },
          '16:9': ratioLabel('16:9'), '9:16': ratioLabel('9:16'), '1:1': ratioLabel('1:1'),
          '4:3': ratioLabel('4:3'), '3:4': ratioLabel('3:4'),
        },
      },
      ppioWan27Resolution: {
        name: sharedFieldText('resolution'),
        optionLabels: { '720P': ratioLabel('720P'), '1080P': ratioLabel('1080P') },
      },
      ppioWan27Duration: {
        name: sharedFieldText('duration'),
      },
      ppioWan27ShotType: {
        name: sharedFieldText('shotType'),
        optionLabels: {
          single: { label: sharedOptionText('singleShot') },
          multi: { label: sharedOptionText('multiShot') },
        },
      },
      ppioWan27Audio: {
        name: sharedFieldText('generateAudio'),
      },
      ppioWan27AudioSetting: {
        name: { zh: '声音设置', en: 'Audio Setting' },
        optionLabels: {
          auto: { label: sharedOptionText('auto') },
          origin: { label: { zh: '保留原声', en: 'Keep Original' } },
        },
      },
      ppioWan27PromptExtend: {
        name: sharedFieldText('promptExtension'),
      },
    },
    linkages: [],
  },

  'ppio-minimax-speech': {
    meta: {
      name: { key: 'meta.name', fallback: 'Minimax Speech 2.8' },
      i18nScope: 'models.defs.ppio-minimax-speech',
    },
    params: {
      minimaxAudioSpec: {
        name: { zh: '版本', en: 'Version' },
        role: 'mode',
        optionLabels: { hd: { label: 'HD' }, turbo: { label: 'Turbo' } },
      },
      minimaxVoiceId: {
        name: sharedFieldText('voiceId'),
        panel: 'voice-selector',
        config: {
          ...VOICE_SELECTOR_CONFIG,
          width: 720,
        },
      },
      minimaxAudioEmotion: {
        name: sharedFieldText('emotion'),
        optionLabels: {
          '': { label: { zh: '自动', en: 'Auto' } },
          happy: { label: { zh: '开心', en: 'Happy' } },
          sad: { label: { zh: '悲伤', en: 'Sad' } },
          angry: { label: { zh: '愤怒', en: 'Angry' } },
          fearful: { label: { zh: '害怕', en: 'Fearful' } },
          disgusted: { label: { zh: '厌恶', en: 'Disgusted' } },
          surprised: { label: { zh: '惊讶', en: 'Surprised' } },
          calm: { label: { zh: '中性', en: 'Calm' } },
          fluent: { label: { zh: '生动', en: 'Fluent' } },
          whisper: { label: { zh: '低语', en: 'Whisper' } },
        },
      },
      minimaxLanguageBoost: {
        name: { zh: '语言增强', en: 'Language Boost' },
        optionLabels: {
          auto: { label: { zh: '自动', en: 'Auto' } },
          Chinese: { label: { zh: '中文 (普通话)', en: 'Chinese (Mandarin)' } },
          'Chinese,Yue': { label: { zh: '中文 (粤语)', en: 'Chinese (Cantonese)' } },
          English: { label: { zh: '英语', en: 'English' } },
          Arabic: { label: { zh: '阿拉伯语', en: 'Arabic' } },
          Russian: { label: { zh: '俄语', en: 'Russian' } },
          Spanish: { label: { zh: '西班牙语', en: 'Spanish' } },
          French: { label: { zh: '法语', en: 'French' } },
          Portuguese: { label: { zh: '葡萄牙语', en: 'Portuguese' } },
          German: { label: { zh: '德语', en: 'German' } },
          Turkish: { label: { zh: '土耳其语', en: 'Turkish' } },
          Dutch: { label: { zh: '荷兰语', en: 'Dutch' } },
          Ukrainian: { label: { zh: '乌克兰语', en: 'Ukrainian' } },
          Vietnamese: { label: { zh: '越南语', en: 'Vietnamese' } },
          Indonesian: { label: { zh: '印尼语', en: 'Indonesian' } },
          Japanese: { label: { zh: '日语', en: 'Japanese' } },
          Italian: { label: { zh: '意大利语', en: 'Italian' } },
          Korean: { label: { zh: '韩语', en: 'Korean' } },
          Thai: { label: { zh: '泰语', en: 'Thai' } },
          Polish: { label: { zh: '波兰语', en: 'Polish' } },
          Romanian: { label: { zh: '罗马尼亚语', en: 'Romanian' } },
          Greek: { label: { zh: '希腊语', en: 'Greek' } },
          Czech: { label: { zh: '捷克语', en: 'Czech' } },
          Finnish: { label: { zh: '芬兰语', en: 'Finnish' } },
          Hindi: { label: { zh: '印地语', en: 'Hindi' } },
          Bulgarian: { label: { zh: '保加利亚语', en: 'Bulgarian' } },
          Danish: { label: { zh: '丹麦语', en: 'Danish' } },
          Hebrew: { label: { zh: '希伯来语', en: 'Hebrew' } },
          Malay: { label: { zh: '马来语', en: 'Malay' } },
          Persian: { label: { zh: '波斯语', en: 'Persian' } },
          Slovak: { label: { zh: '斯洛伐克语', en: 'Slovak' } },
          Swedish: { label: { zh: '瑞典语', en: 'Swedish' } },
          Croatian: { label: { zh: '克罗地亚语', en: 'Croatian' } },
          Filipino: { label: { zh: '菲律宾语', en: 'Filipino' } },
          Hungarian: { label: { zh: '匈牙利语', en: 'Hungarian' } },
          Norwegian: { label: { zh: '挪威语', en: 'Norwegian' } },
          Slovenian: { label: { zh: '斯洛文尼亚语', en: 'Slovenian' } },
          Catalan: { label: { zh: '加泰罗尼亚语', en: 'Catalan' } },
          Nynorsk: { label: { zh: '新挪威语', en: 'Nynorsk' } },
          Tamil: { label: { zh: '泰米尔语', en: 'Tamil' } },
          Afrikaans: { label: { zh: '南非荷兰语', en: 'Afrikaans' } },
        },
      },
      minimaxAdvancedSettings: {
        name: { zh: '高级选项', en: 'Advanced Options' },
        panel: 'composite',
        config: {
          ...ADVANCED_PANEL_CONFIG,
          width: 576,
        },
      },
      minimaxVoiceClonePanel: {
        name: { zh: '音色克隆', en: 'Voice Clone' },
        panel: 'minimax-voice-clone',
        config: {
          ...MINIMAX_VOICE_CLONE_PANEL_CONFIG,
          width: 860,
        },
      },
    },
    linkages: [],
  },
}
