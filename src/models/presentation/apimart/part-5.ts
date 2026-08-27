/** apimart 模型展示补丁（第 5/5 组）。 */

import { sharedFieldText, sharedModeText, sharedOptionText } from '@/core/i18n/modelText'
import type { I18nText } from '@/core/types/I18nText'
import type { ModelPresentation } from '@/core/types/ModelPresentation'

export const apimartPresentationPart5: Record<string, ModelPresentation> = {
  "apimart-seedance-2.0": {
    meta: {
      name: { key: 'meta.name', fallback: 'Seedance 2.0' },
      i18nScope: 'models.defs.apimart-seedance-2.0',
    },
    params: {
      "apimartSeedance20Mode": {
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
      "apimartSeedance20AspectRatio": {
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
      "apimartSeedance20Resolution": {
        name: sharedFieldText('resolution'),
        optionLabels: Object.fromEntries((
          ['480p', '720p', '1080p', '4K'].map((value) => ({ value, label: value }))
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "apimartSeedance20Duration": {
        name: sharedFieldText('duration'),
      },
      "apimartSeedance20GenerateAudio": {
        name: sharedFieldText('generateAudio'),
      },
      "apimartSeedance20ReturnLastFrame": {
        name: { zh: '返回尾帧', en: 'Return Last Frame' },
      },
      "apimartSeedance20WebSearch": {
        name: { zh: '联网搜索', en: 'Web Search' },
      },
    },
    linkages: [],
  },
  "apimart-seedance-2.5": {
    meta: {
      name: { key: 'meta.name', fallback: 'Seedance 2.5' },
      i18nScope: 'models.defs.apimart-seedance-2.5',
    },
    params: {
      "apimartSeedance25Mode": {
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
      "apimartSeedance25TaskType": {
        name: { zh: '任务类型', en: 'Task Type' },
        optionLabels: Object.fromEntries((
          [
        { value: 'auto', label: { zh: '自动判断', en: 'Automatic' } },
        { value: 'reference', label: { zh: '参考生成', en: 'Reference' } },
        { value: 'edit', label: { zh: '视频编辑', en: 'Video Edit' } },
        { value: 'extend', label: { zh: '视频延长', en: 'Video Extend' } }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "apimartSeedance25AspectRatio": {
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
      "apimartSeedance25Resolution": {
        name: sharedFieldText('resolution'),
        optionLabels: Object.fromEntries((
          ['480p', '720p', '1080p'].map((value) => ({ value, label: value }))
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "apimartSeedance25Duration": {
        name: sharedFieldText('duration'),
      },
      "apimartSeedance25AutoDuration": {
        name: { zh: '自动时长', en: 'Automatic Duration' },
      },
      "apimartSeedance25GenerateAudio": {
        name: sharedFieldText('generateAudio'),
      },
      "apimartSeedance25ReturnLastFrame": {
        name: { zh: '返回尾帧', en: 'Return Last Frame' },
      },
      "apimartSeedance25WebSearch": {
        name: { zh: '联网搜索', en: 'Web Search' },
      },
    },
    linkages: [],
  },
  "apimart-seedream-5.0-lite": {
    meta: {
      name: { key: 'meta.name', fallback: 'Seedream 5.0 Lite' },
      i18nScope: 'models.defs.apimart-seedream-5.0-lite',
    },
    params: {
      "apimartSeedream50LiteAspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [{ value: 'smart', label: sharedOptionText('smart') }, ...(['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '2:1', '1:2', '21:9'] as const).map((ratio) => ({ value: ratio, label: ratio }))]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "apimartSeedream50LiteResolution": {
        name: sharedFieldText('resolution'),
        optionLabels: Object.fromEntries((
          ['2K', '3K', '4K'].map((value) => ({ value, label: value }))
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "apimartSeedream50LiteCount": {
        name: { zh: '生成数量', en: 'Output Count' },
      },
    },
    linkages: [],
  },
  "apimart-seedream-5.0-pro": {
    meta: {
      name: { key: 'meta.name', fallback: 'Seedream 5.0 Pro' },
      i18nScope: 'models.defs.apimart-seedream-5.0-pro',
    },
    params: {
      "apimartSeedream50ProMode": {
        role: 'mode',
        name: { zh: '模式', en: 'Mode' },
        optionLabels: Object.fromEntries((
          [
        { value: 'generate', label: { zh: '生成 / 编辑', en: 'Generate / Edit' } },
        { value: 'layer-decomposition', label: { zh: '图层拆分', en: 'Layer Decomposition' } }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "apimartSeedream50ProAspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [{ value: 'smart', label: sharedOptionText('smart') }, ...(['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '2:1', '1:2', '21:9'] as const).map((ratio) => ({ value: ratio, label: ratio }))]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "apimartSeedream50ProResolution": {
        name: sharedFieldText('resolution'),
        optionLabels: Object.fromEntries((
          ['1K', '1.5K', '2K'].map((value) => ({ value, label: value }))
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "apimartSeedream50ProLayerSize": {
        name: sharedFieldText('resolution'),
        optionLabels: Object.fromEntries((
          [
        { value: 'auto', label: sharedOptionText('auto') },
        ...['1K', '1.5K', '2K'].map((value) => ({ value, label: value }))
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "apimartSeedream50ProBackground": {
        name: { zh: '背景', en: 'Background' },
        optionLabels: Object.fromEntries((
          [
        { value: 'opaque', label: { zh: '不透明', en: 'Opaque' } },
        { value: 'transparent', label: { zh: '透明', en: 'Transparent' } }
      ]
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
  "apimart-z-image-turbo": {
    meta: {
      name: { key: 'meta.name', fallback: 'Z-Image Turbo' },
      i18nScope: 'models.defs.apimart-z-image-turbo',
    },
    params: {
      "apimartZImageTurboAspectRatio": {
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
      "apimartZImageTurboResolution": {
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
      "apimartZImageTurboPromptExtend": {
        name: { zh: '提示词改写', en: 'Prompt Rewrite' },
      },
    },
    linkages: [],
  },
}
