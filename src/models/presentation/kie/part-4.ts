/** kie 模型展示补丁（第 4/6 组）。 */

import { sharedFieldText, sharedModeText, sharedOptionText } from '@/core/i18n/modelText'
import type { I18nText } from '@/core/types/I18nText'
import type { ModelPresentation } from '@/core/types/ModelPresentation'

export const kiePresentationPart4: Record<string, ModelPresentation> = {
  "kie-qwen-image-3.0": {
    meta: {
      name: { key: 'meta.name', fallback: 'Qwen Image 3.0' },
      i18nScope: 'models.defs.kie-qwen-image-3.0',
    },
    params: {
      "kieQwenImage30Variant": {
        name: sharedFieldText('variant'),
        optionLabels: Object.fromEntries((
          [
        { value: 'standard', label: { zh: '标准版', en: 'Standard' } },
        { value: 'pro', label: 'Pro' }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "kieQwenImage30AspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [
        { value: 'smart', label: sharedOptionText('smart') },
        ...([
  '1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9'
] as const).map((ratio) => ({ value: ratio, label: ratio }))
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "kieQwenImage30Resolution": {
        name: sharedFieldText('resolution'),
        optionLabels: Object.fromEntries((
          [
        { value: '1K', label: '1K' },
        { value: '2K', label: '2K' }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "kieQwenImage30PromptExtend": {
        name: { zh: '提示词扩写', en: 'Prompt Expansion' },
      },
    },
    linkages: [],
  },
  "kie-seedance-1.5-pro": {
    meta: {
      name: { key: 'meta.name', fallback: 'Seedance 1.5 Pro' },
      i18nScope: 'models.defs.kie-seedance-1.5-pro',
    },
    params: {
      "kieSeedance15ProAspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [
        { value: 'smart', label: sharedOptionText('smart') },
        { value: '1:1', label: '1:1' },
        { value: '21:9', label: '21:9' },
        { value: '4:3', label: '4:3' },
        { value: '3:4', label: '3:4' },
        { value: '16:9', label: '16:9' },
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
      "kieSeedance15ProResolution": {
        name: sharedFieldText('resolution'),
        optionLabels: Object.fromEntries((
          [
        { value: '480p', label: '480p' },
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
      "kieSeedance15ProDuration": {
        name: sharedFieldText('duration'),
        optionLabels: Object.fromEntries((
          [
        { value: 4, label: '4s' },
        { value: 6, label: '6s' },
        { value: 8, label: '8s' },
        { value: 10, label: '10s' },
        { value: 12, label: '12s' }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "kieSeedance15ProGenerateAudio": {
        name: sharedFieldText('generateAudio'),
      },
      "kieSeedance15ProFixedLens": {
        name: sharedFieldText('cameraFixed'),
      },
    },
    linkages: [],
  },
  "kie-seedance-2.0-fast": {
    meta: {
      name: { key: 'meta.name', fallback: 'Seedance 2.0 Fast' },
      i18nScope: 'models.defs.kie-seedance-2.0-fast',
    },
    params: {
      "kieSeedance20FastMode": {
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
      "kieSeedance20FastAspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [
        { value: 'smart', label: sharedOptionText('smart') },
        { value: '1:1', label: '1:1' },
        { value: '4:3', label: '4:3' },
        { value: '3:4', label: '3:4' },
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' },
        { value: '21:9', label: '21:9' }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "kieSeedance20FastResolution": {
        name: sharedFieldText('resolution'),
        optionLabels: Object.fromEntries((
          [
        { value: '480p', label: '480p' },
        { value: '720p', label: '720p' }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "kieSeedance20FastDuration": {
        name: sharedFieldText('duration'),
      },
      "kieSeedance20FastGenerateAudio": {
        name: sharedFieldText('generateAudio'),
      },
      "kieSeedance20FastWebSearch": {
        name: { zh: '联网搜索', en: 'Web Search' },
      },
      "kieSeedance20FastReturnLastFrame": {
        name: { zh: '返回尾帧', en: 'Return Last Frame' },
      },
    },
    linkages: [],
  },
  "kie-seedance-2.0-mini": {
    meta: {
      name: { key: 'meta.name', fallback: 'Seedance 2.0 Mini' },
      i18nScope: 'models.defs.kie-seedance-2.0-mini',
    },
    params: {
      "kieSeedance20MiniMode": {
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
      "kieSeedance20MiniAspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [
        { value: 'smart', label: sharedOptionText('smart') },
        { value: '1:1', label: '1:1' },
        { value: '4:3', label: '4:3' },
        { value: '3:4', label: '3:4' },
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' },
        { value: '21:9', label: '21:9' }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "kieSeedance20MiniResolution": {
        name: sharedFieldText('resolution'),
        optionLabels: Object.fromEntries((
          [
        { value: '480p', label: '480p' },
        { value: '720p', label: '720p' }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "kieSeedance20MiniDuration": {
        name: sharedFieldText('duration'),
      },
      "kieSeedance20MiniGenerateAudio": {
        name: sharedFieldText('generateAudio'),
      },
      "kieSeedance20MiniWebSearch": {
        name: { zh: '联网搜索', en: 'Web Search' },
      },
    },
    linkages: [],
  },
}
