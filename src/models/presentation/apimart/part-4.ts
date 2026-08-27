/** apimart 模型展示补丁（第 4/5 组）。 */

import { sharedFieldText, sharedModeText, sharedOptionText } from '@/core/i18n/modelText'
import type { I18nText } from '@/core/types/I18nText'
import type { ModelPresentation } from '@/core/types/ModelPresentation'

export const apimartPresentationPart4: Record<string, ModelPresentation> = {
  "apimart-nano-banana-2-lite": {
    meta: {
      name: { zh: 'Nano Banana 2 Lite', en: 'Nano Banana 2 Lite' },
      i18nScope: 'models.defs.apimart-nano-banana-2',
    },
    params: {
      "apimartNanoBanana2LiteAspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [{ value: 'smart', label: sharedOptionText('smart') }, ...(['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '5:4', '4:5', '21:9'] as const).map((ratio) => ({ value: ratio, label: ratio }))]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "apimartNanoBanana2LiteCount": {
        name: { zh: '生成数量', en: 'Output Count' },
      },
    },
    linkages: [],
  },
  "apimart-nano-banana-2": {
    meta: {
      name: { key: 'meta.name', fallback: 'Nano Banana 2' },
      i18nScope: 'models.defs.apimart-nano-banana-2',
    },
    params: {
      "apimartNanoBanana2AspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [{ value: 'smart', label: sharedOptionText('smart') }, ...(['1:1', '2:3', '3:2', '1:4', '4:1', '3:4', '4:3', '4:5', '5:4', '1:8', '8:1', '9:16', '16:9', '21:9'] as const).map((ratio) => ({ value: ratio, label: ratio }))]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "apimartNanoBanana2Resolution": {
        name: sharedFieldText('resolution'),
        optionLabels: Object.fromEntries((
          ['0.5K', '1K', '2K', '4K'].map((value) => ({ value, label: value }))
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "apimartNanoBanana2GoogleSearch": {
        name: { zh: 'Google 搜索', en: 'Google Search' },
      },
      "apimartNanoBanana2GoogleImageSearch": {
        name: { zh: 'Google 图片搜索', en: 'Google Image Search' },
      },
    },
    linkages: [
    {
      trigger: 'apimartNanoBanana2GoogleImageSearch',
      effect: 'autoSwitch',
      target: 'apimartNanoBanana2GoogleSearch',
      condition: (enabled: boolean, allParams: Record<string, unknown>) => enabled === true && allParams.apimartNanoBanana2GoogleSearch !== true,
      value: true,
      noRestore: true
    }
  ],
  },
  "apimart-nano-banana-pro": {
    meta: {
      name: { key: 'meta.name', fallback: 'Nano Banana Pro' },
      i18nScope: 'models.defs.apimart-nano-banana-pro',
    },
    params: {
      "apimartNanoBananaProAspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [{ value: 'smart', label: sharedOptionText('smart') }, ...(['21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16'] as const).map((ratio) => ({ value: ratio, label: ratio }))]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "apimartNanoBananaProResolution": {
        name: sharedFieldText('resolution'),
        optionLabels: Object.fromEntries((
          ['1K', '2K', '4K'].map((value) => ({ value, label: value }))
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
  "apimart-qwen-image-3.0": {
    meta: {
      name: { key: 'meta.name', fallback: 'Qwen Image 3.0' },
      i18nScope: 'models.defs.apimart-qwen-image-3.0',
    },
    params: {
      "apimartQwenImage30Variant": {
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
      "apimartQwenImage30AspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [{ value: 'smart', label: sharedOptionText('smart') }, ...(['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'] as const).map((ratio) => ({ value: ratio, label: ratio }))]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "apimartQwenImage30Resolution": {
        name: sharedFieldText('resolution'),
        optionLabels: Object.fromEntries((
          ['1K', '2K'].map((value) => ({ value, label: value }))
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "apimartQwenImage30Count": {
        name: { zh: '生成数量', en: 'Output Count' },
      },
      "apimartQwenImage30PromptExtend": {
        name: sharedFieldText('promptExpansion'),
      },
    },
    linkages: [],
  },
  "apimart-seedance-2.0-fast": {
    meta: {
      name: { key: 'meta.name', fallback: 'Seedance 2.0 Fast' },
      i18nScope: 'models.defs.apimart-seedance-2.0-fast',
    },
    params: {
      "apimartSeedance20FastMode": {
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
      "apimartSeedance20FastAspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [{ value: 'smart', label: sharedOptionText('smart') }, ...['1:1', '4:3', '3:4', '16:9', '9:16', '21:9'].map((ratio) => ({ value: ratio, label: ratio }))]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "apimartSeedance20FastResolution": {
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
      "apimartSeedance20FastDuration": {
        name: sharedFieldText('duration'),
      },
      "apimartSeedance20FastGenerateAudio": {
        name: sharedFieldText('generateAudio'),
      },
      "apimartSeedance20FastReturnLastFrame": {
        name: { zh: '返回尾帧', en: 'Return Last Frame' },
      },
      "apimartSeedance20FastWebSearch": {
        name: { zh: '联网搜索', en: 'Web Search' },
      },
    },
    linkages: [],
  },
  "apimart-seedance-2.0-mini": {
    meta: {
      name: { key: 'meta.name', fallback: 'Seedance 2.0 Mini' },
      i18nScope: 'models.defs.apimart-seedance-2.0-mini',
    },
    params: {
      "apimartSeedance20MiniMode": {
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
      "apimartSeedance20MiniAspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [{ value: 'smart', label: sharedOptionText('smart') }, ...['1:1', '4:3', '3:4', '16:9', '9:16', '21:9'].map((ratio) => ({ value: ratio, label: ratio }))]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "apimartSeedance20MiniResolution": {
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
      "apimartSeedance20MiniDuration": {
        name: sharedFieldText('duration'),
      },
      "apimartSeedance20MiniGenerateAudio": {
        name: sharedFieldText('generateAudio'),
      },
      "apimartSeedance20MiniReturnLastFrame": {
        name: { zh: '返回尾帧', en: 'Return Last Frame' },
      },
      "apimartSeedance20MiniWebSearch": {
        name: { zh: '联网搜索', en: 'Web Search' },
      },
    },
    linkages: [],
  },
}
