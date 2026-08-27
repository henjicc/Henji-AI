/** fal 模型展示补丁（第 7/7 组）。 */

import { sharedFieldText, sharedOptionText } from '@/core/i18n/modelText'
import type { I18nText } from '@/core/types/I18nText'
import type { ModelPresentation } from '@/core/types/ModelPresentation'

export const falPresentationPart7: Record<string, ModelPresentation> = {
  "fal-ai-wan-25-preview": {
    meta: {
      name: { key: 'meta.name', fallback: 'Wan 2.5 Preview' },
      i18nScope: 'models.defs.fal-ai-wan-25-preview',
    },
    params: {
      "falWan25VideoDuration": {
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
      "falWan25AspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' },
        { value: '1:1', label: '1:1' }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falWan25Resolution": {
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
      "falWan25PromptExpansion": {
        name: sharedFieldText('promptExpansion'),
      },
    },
    linkages: [],
  },
  "fal-ai-z-image-turbo": {
    meta: {
      name: { key: 'meta.name', fallback: 'Z-Image Turbo' },
      i18nScope: 'models.defs.fal-ai-z-image-turbo',
    },
    params: {
      "falZImageTurboAspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [{ value: 'smart', label: sharedOptionText('smart') }, ...(['1:1', '4:3', '3:4', '16:9', '9:16'] as const).map((value) => ({ value, label: value }))]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falZImageTurboResolution": {
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
      "falZImageTurboImageSize": {
        name: sharedFieldText('imageSize'),
        optionLabels: {
          provider: { label: { zh: '供应商预设', en: 'Provider Preset' } },
          '1MP': { label: { zh: '约 1MP', en: 'Approx. 1MP' } },
        },
      },
      "falZImageTurboNumImages": {
        name: sharedFieldText('numberOfImages'),
      },
      "falZImageTurboNumInferenceSteps": {
        name: sharedFieldText('inferenceSteps'),
      },
      "falZImageTurboAcceleration": {
        name: sharedFieldText('acceleration'),
        optionLabels: Object.fromEntries((
          [
        { value: 'none', label: { zh: '无', en: 'None' } },
        { value: 'regular', label: { zh: '常规', en: 'Regular' } },
        { value: 'high', label: { zh: '高', en: 'High' } }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falZImageTurboPromptExpansion": {
        name: sharedFieldText('promptExpansion'),
      },
      "falZImageTurboStrength": {
        name: { zh: '重绘强度', en: 'Strength' },
      },
    },
    linkages: [],
  },
}
