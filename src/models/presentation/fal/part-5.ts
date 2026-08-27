/** fal 模型展示补丁（第 5/7 组）。 */

import { sharedFieldText, sharedModeText, sharedOptionText } from '@/core/i18n/modelText'
import type { I18nText } from '@/core/types/I18nText'
import type { ModelPresentation } from '@/core/types/ModelPresentation'

export const falPresentationPart5: Record<string, ModelPresentation> = {
  "fal-ai-seedance-2.0": {
    meta: {
      name: { key: 'meta.name', fallback: 'Seedance 2.0' },
      i18nScope: 'models.defs.fal-ai-seedance-2.0',
    },
    params: {
      "falSeedance20Mode": {
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
      "falSeedance20AspectRatio": {
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
      "falSeedance20Resolution": {
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
      "falSeedance20Duration": {
        name: sharedFieldText('duration'),
      },
      "falSeedance20GenerateAudio": {
        name: sharedFieldText('generateAudio'),
      },
      "falSeedance20Bitrate": {
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
  "fal-ai-seedance-2.5": {
    meta: {
      name: { key: 'meta.name', fallback: 'Seedance 2.5' },
      i18nScope: 'models.defs.fal-ai-seedance-2.5',
    },
    params: {
      "falSeedance25Mode": {
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
      "falSeedance25AspectRatio": {
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
      "falSeedance25Resolution": {
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
      "falSeedance25Duration": {
        name: sharedFieldText('duration'),
      },
      "falSeedance25AutoDuration": {
        name: { zh: '自动时长', en: 'Automatic Duration' },
      },
      "falSeedance25GenerateAudio": {
        name: sharedFieldText('generateAudio'),
      },
      "falSeedance25Bitrate": {
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
  "fal-ai-bytedance-seedance-v1": {
    meta: {
      name: { key: 'meta.name', fallback: 'Seedance' },
      i18nScope: 'models.defs.fal-ai-bytedance-seedance-v1',
    },
    params: {
      "falSeedanceV1Mode": {
        name: sharedFieldText('mode'),
        optionLabels: Object.fromEntries((
          [
        { value: 'text-to-video', label: sharedModeText('textToVideo') },
        { value: 'image-to-video', label: sharedModeText('imageToVideo') }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falSeedanceV1AspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [
        { value: 'smart', label: sharedOptionText('smart') },
        { value: 'auto', label: sharedOptionText('auto') },
        { value: '21:9', label: '21:9' },
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
      "falSeedanceV1Resolution": {
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
      "falSeedanceV1VideoDuration": {
        name: sharedFieldText('duration'),
        optionLabels: Object.fromEntries((
          [
        { value: 2, label: '2s' },
        { value: 3, label: '3s' },
        { value: 4, label: '4s' },
        { value: 5, label: '5s' },
        { value: 6, label: '6s' },
        { value: 7, label: '7s' },
        { value: 8, label: '8s' },
        { value: 9, label: '9s' },
        { value: 10, label: '10s' },
        { value: 11, label: '11s' },
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
      "falSeedanceV1CameraFixed": {
        name: sharedFieldText('cameraFixed'),
      },
      "falSeedanceV1FastMode": {
        name: sharedFieldText('fastMode'),
      },
    },
    linkages: [],
  },
  "fal-ai-seedream-5.0-lite": {
    meta: {
      name: { key: 'meta.name', fallback: 'Seedream 5.0 Lite' },
      i18nScope: 'models.defs.fal-ai-seedream-5.0-lite',
    },
    params: {
      "falSeedream50LiteAspectRatio": {
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
      "falSeedream50LiteResolution": {
        name: sharedFieldText('resolution'),
        optionLabels: Object.fromEntries((
          ['2K', '3K', '4K', '1MP'].map((value) => ({ value, label: value === '1MP' ? { zh: '约 1MP（服务端会放大）', en: 'Approx. 1MP (Server Upscales)' } : value }))
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falSeedream50LiteNumImages": {
        name: sharedFieldText('numberOfImages'),
      },
      "falSeedream50LiteMaxImages": {
        name: { zh: '每轮最大图片数', en: 'Max Images Per Run' },
      },
    },
    linkages: [],
  },
  "fal-ai-seedream-5.0-pro": {
    meta: {
      name: { key: 'meta.name', fallback: 'Seedream 5.0 Pro' },
      i18nScope: 'models.defs.fal-ai-seedream-5.0-pro',
    },
    params: {
      "falSeedream50ProAspectRatio": {
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
      "falSeedream50ProResolution": {
        name: sharedFieldText('resolution'),
        optionLabels: Object.fromEntries((
          ['1K', '2K', '1MP'].map((value) => ({ value, label: value === '1MP' ? { zh: '约 1MP', en: 'Approx. 1MP' } : value }))
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falSeedream50ProNumImages": {
        name: sharedFieldText('numberOfImages'),
      },
    },
    linkages: [],
  },
}
