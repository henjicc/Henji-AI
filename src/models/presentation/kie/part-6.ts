/** kie 模型展示补丁（第 6/6 组）。 */

import { sharedFieldText, sharedOptionText } from '@/core/i18n/modelText'
import type { I18nText } from '@/core/types/I18nText'
import type { ModelPresentation } from '@/core/types/ModelPresentation'

export const kiePresentationPart6: Record<string, ModelPresentation> = {
  "kie-seedream-4.5": {
    meta: {
      name: { key: 'meta.name', fallback: 'Seedream 4.5' },
      i18nScope: 'models.defs.kie-seedream-4.5',
    },
    params: {
      "kieSeedreamAspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [
        { value: 'smart', label: sharedOptionText('smart') },
        { value: '1:1', label: '1:1' },
        { value: '4:3', label: '4:3' },
        { value: '3:4', label: '3:4' },
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' },
        { value: '2:3', label: '2:3' },
        { value: '3:2', label: '3:2' },
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
      "kieSeedreamQuality": {
        name: sharedFieldText('quality'),
        optionLabels: Object.fromEntries((
          [
        { value: '2K', label: '2K' },
        { value: '4K', label: '4K' }
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
  "kie-seedream-5.0-lite": {
    meta: {
      name: { key: 'meta.name', fallback: 'Seedream 5.0 Lite' },
      i18nScope: 'models.defs.kie-seedream-5.0-lite',
    },
    params: {
      "kieSeedream50LiteAspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [
        { value: 'smart', label: sharedOptionText('smart') },
        ...(['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9'] as const).map((ratio) => ({ value: ratio, label: ratio }))
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "kieSeedream50LiteResolution": {
        name: sharedFieldText('resolution'),
        optionLabels: Object.fromEntries((
          [
        { value: '2K', label: '2K' },
        { value: '3K', label: '3K' },
        { value: '4K', label: '4K' }
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
  "kie-seedream-5.0-pro": {
    meta: {
      name: { key: 'meta.name', fallback: 'Seedream 5.0 Pro' },
      i18nScope: 'models.defs.kie-seedream-5.0-pro',
    },
    params: {
      "kieSeedream50ProMode": {
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
      "kieSeedream50ProAspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [
        { value: 'smart', label: sharedOptionText('smart') },
        ...(['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9'] as const).map((ratio) => ({ value: ratio, label: ratio }))
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "kieSeedream50ProResolution": {
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
      "kieSeedream50ProLayerSize": {
        name: sharedFieldText('resolution'),
        optionLabels: Object.fromEntries((
          [
        { value: 'auto', label: sharedOptionText('auto') },
        { value: '1K', label: '1K' },
        { value: '1.5K', label: '1.5K' },
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
    },
    linkages: [],
  },
  "kie-z-image": {
    meta: {
      name: { key: 'meta.name', fallback: 'Z-Image Turbo' },
      i18nScope: 'models.defs.kie-z-image',
    },
    params: {
      "kieZImageAspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [
        { value: 'smart', label: { zh: '智能', en: 'Smart' } },
        { value: '1:1', label: '1:1' },
        { value: '4:3', label: '4:3' },
        { value: '3:4', label: '3:4' },
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' },
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
}
