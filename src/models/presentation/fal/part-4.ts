/** fal 模型展示补丁（第 4/7 组）。 */

import { sharedFieldText, sharedModeText, sharedOptionText } from '@/core/i18n/modelText'
import type { I18nText } from '@/core/types/I18nText'
import type { ModelPresentation } from '@/core/types/ModelPresentation'

export const falPresentationPart4: Record<string, ModelPresentation> = {
  "fal-ai-pixverse-v5.5": {
    meta: {
      name: { key: 'meta.name', fallback: 'PixVerse V5.5' },
      i18nScope: 'models.defs.fal-ai-pixverse-v5.5',
    },
    params: {
      "pixverseAspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [
        { value: 'smart', label: sharedOptionText('smart') },
        { value: '16:9', label: '16:9' },
        { value: '4:3', label: '4:3' },
        { value: '1:1', label: '1:1' },
        { value: '3:4', label: '3:4' },
        { value: '9:16', label: '9:16' }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "pixverseResolution": {
        name: sharedFieldText('resolution'),
        optionLabels: Object.fromEntries((
          [
        { value: '720p', label: '720p' },
        { value: '1080p', label: '1080p' }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falPixverse55VideoDuration": {
        name: sharedFieldText('duration'),
        optionLabels: Object.fromEntries((
          [
        { value: 5, label: '5s' },
        { value: 10, label: '10s' }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "pixverseStyle": {
        name: sharedFieldText('style'),
        optionLabels: Object.fromEntries((
          [
        { value: 'none', label: sharedOptionText('default') },
        { value: 'anime', label: sharedOptionText('anime') },
        { value: '3d_animation', label: sharedOptionText('threeDAnimation') },
        { value: 'clay', label: sharedOptionText('clay') },
        { value: 'comic', label: sharedOptionText('comic') },
        { value: 'cyberpunk', label: sharedOptionText('cyberpunk') }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "pixverseThinkingType": {
        name: sharedFieldText('thinkingType'),
        optionLabels: Object.fromEntries((
          [
        { value: 'auto', label: sharedOptionText('auto') },
        { value: 'enabled', label: sharedOptionText('enabled') },
        { value: 'disabled', label: sharedOptionText('disabled') }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "pixverseGenerateAudio": {
        name: sharedFieldText('generateAudio'),
      },
      "pixverseMultiClip": {
        name: sharedFieldText('multiClip'),
      },
    },
    linkages: [
    // 官方文档明确 10 秒档不提供 1080p
    {
      trigger: 'falPixverse55VideoDuration',
      effect: 'filterOptions',
      target: 'pixverseResolution',
      filter: (duration, options) => (duration === 10 ? options.filter((opt) => opt.value !== '1080p') : options)
    },
    {
      trigger: 'falPixverse55VideoDuration',
      effect: 'autoSwitch',
      target: 'pixverseResolution',
      condition: (duration, allParams) => duration === 10 && allParams.pixverseResolution === '1080p',
      value: '720p'
    }
  ],
  },
  "fal-ai-qwen-image-3.0": {
    meta: {
      name: { key: 'meta.name', fallback: 'Qwen Image 3.0' },
      i18nScope: 'models.defs.fal-ai-qwen-image-3.0',
    },
    params: {
      "falQwenImage30AspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [{ value: 'smart', label: sharedOptionText('smart') }, ...(['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'] as const).map((value) => ({ value, label: value }))]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falQwenImage30Resolution": {
        name: sharedFieldText('resolution'),
        optionLabels: Object.fromEntries((
          ['1K', '2K', '1MP'].map((value) => ({ value, label: value === '1MP' ? { zh: '约 1MP（兼容）', en: 'Approx. 1MP (Compatibility)' } : value }))
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falQwenImage30NumImages": {
        name: sharedFieldText('numberOfImages'),
      },
      "falQwenImage30PromptExpansion": {
        name: sharedFieldText('promptExpansion'),
      },
    },
    linkages: [],
  },
  "fal-ai-seedance-2.0-fast": {
    meta: {
      name: { key: 'meta.name', fallback: 'Seedance 2.0 Fast' },
      i18nScope: 'models.defs.fal-ai-seedance-2.0-fast',
    },
    params: {
      "falSeedance20FastMode": {
        name: sharedFieldText('mode'),
        optionLabels: Object.fromEntries((
          [
        { value: 'text-image-to-video', label: sharedModeText('textImageToVideo') },
        { value: 'reference-to-video', label: sharedModeText('referenceToVideo') }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falSeedance20FastAspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [
        { value: 'smart', label: sharedOptionText('smart') },
        ...['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'].map((value) => ({ value, label: value }))
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falSeedance20FastResolution": {
        name: sharedFieldText('resolution'),
        optionLabels: Object.fromEntries((
          ['480p', '720p'].map((value) => ({ value, label: value }))
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falSeedance20FastDuration": {
        name: sharedFieldText('duration'),
      },
      "falSeedance20FastGenerateAudio": {
        name: sharedFieldText('generateAudio'),
      },
      "falSeedance20FastBitrate": {
        name: { zh: '码率', en: 'Bitrate' },
        optionLabels: Object.fromEntries((
          [{ value: 'standard', label: { zh: '标准', en: 'Standard' } }, { value: 'high', label: { zh: '高', en: 'High' } }]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
    },
    linkages: [],
  },
  "fal-ai-seedance-2.0-mini": {
    meta: {
      name: { key: 'meta.name', fallback: 'Seedance 2.0 Mini' },
      i18nScope: 'models.defs.fal-ai-seedance-2.0-mini',
    },
    params: {
      "falSeedance20MiniMode": {
        name: sharedFieldText('mode'),
        optionLabels: Object.fromEntries((
          [
        { value: 'text-image-to-video', label: sharedModeText('textImageToVideo') },
        { value: 'reference-to-video', label: sharedModeText('referenceToVideo') }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falSeedance20MiniAspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [
        { value: 'smart', label: sharedOptionText('smart') },
        ...['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'].map((value) => ({ value, label: value }))
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falSeedance20MiniResolution": {
        name: sharedFieldText('resolution'),
        optionLabels: Object.fromEntries((
          ['480p', '720p'].map((value) => ({ value, label: value }))
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falSeedance20MiniDuration": {
        name: sharedFieldText('duration'),
      },
      "falSeedance20MiniGenerateAudio": {
        name: sharedFieldText('generateAudio'),
      },
    },
    linkages: [],
  },
}
