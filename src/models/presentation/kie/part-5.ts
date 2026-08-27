/** kie 模型展示补丁（第 5/6 组）。 */

import { sharedFieldText, sharedModeText, sharedOptionText } from '@/core/i18n/modelText'
import type { I18nText } from '@/core/types/I18nText'
import type { ModelPresentation } from '@/core/types/ModelPresentation'

export const kiePresentationPart5: Record<string, ModelPresentation> = {
  "kie-seedance-2.0": {
    meta: {
      name: { key: 'meta.name', fallback: 'Seedance 2.0' },
      i18nScope: 'models.defs.kie-seedance-2.0',
    },
    params: {
      "kieSeedance20Mode": {
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
      "kieSeedance20AspectRatio": {
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
      "kieSeedance20Resolution": {
        name: sharedFieldText('resolution'),
        optionLabels: Object.fromEntries((
          [
        { value: '480p', label: '480p' },
        { value: '720p', label: '720p' },
        { value: '1080p', label: '1080p' },
        { value: '4k', label: '4K' }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "kieSeedance20Duration": {
        name: sharedFieldText('duration'),
      },
      "kieSeedance20GenerateAudio": {
        name: sharedFieldText('generateAudio'),
      },
      "kieSeedance20WebSearch": {
        name: { zh: '联网搜索', en: 'Web Search' },
      },
      "kieSeedance20ReturnLastFrame": {
        name: { zh: '返回尾帧', en: 'Return Last Frame' },
      },
    },
    linkages: [],
  },
  "kie-seedance-2.5": {
    meta: {
      name: { key: 'meta.name', fallback: 'Seedance 2.5' },
      i18nScope: 'models.defs.kie-seedance-2.5',
    },
    params: {
      "kieSeedance25Mode": {
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
      "kieSeedance25AspectRatio": {
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
      "kieSeedance25Resolution": {
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
      "kieSeedance25Duration": {
        name: sharedFieldText('duration'),
      },
      "kieSeedance25GenerateAudio": {
        name: sharedFieldText('generateAudio'),
      },
      "kieSeedance25ReturnLastFrame": {
        name: { zh: '返回尾帧', en: 'Return Last Frame' },
      },
      "kieSeedance25AutoDuration": {
        name: { zh: '自动时长', en: 'Automatic Duration' },
      },
      "kieSeedance25WebSearch": {
        name: { zh: '联网搜索', en: 'Web Search' },
      },
    },
    linkages: [],
  },
  "kie-seedance-v1": {
    meta: {
      name: { key: 'meta.name', fallback: 'Seedance 1.0' },
      i18nScope: 'models.defs.kie-seedance-v1',
    },
    params: {
      "kieSeedanceV1Version": {
        name: sharedFieldText('variant'),
        optionLabels: Object.fromEntries((
          [
        { value: 'lite', label: 'Lite' },
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
      "kieSeedanceV1FastMode": {
        name: sharedFieldText('fastMode'),
      },
      "kieSeedanceV1Duration": {
        name: sharedFieldText('duration'),
        optionLabels: Object.fromEntries((
          [
        { value: '5', label: '5s' },
        { value: '10', label: '10s' }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "kieSeedanceV1AspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [
        { value: 'smart', label: sharedOptionText('smart') },
        { value: '21:9', label: '21:9' },
        { value: '16:9', label: '16:9' },
        { value: '4:3', label: '4:3' },
        { value: '1:1', label: '1:1' },
        { value: '3:4', label: '3:4' },
        { value: '9:16', label: '9:16' },
        { value: '9:21', label: '9:21' }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "kieSeedanceV1Resolution": {
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
      "kieSeedanceV1CameraFixed": {
        name: sharedFieldText('cameraFixed'),
      },
    },
    linkages: [
    {
      trigger: 'uploadedImages',
      effect: 'autoSwitch',
      target: 'kieSeedanceV1FastMode',
      condition: (images: string[], allParams: Record<string, unknown>) => {
        const imageCount = images?.length || 0
        return imageCount !== 1 && allParams.kieSeedanceV1FastMode === true
      },
      value: false,
      noRestore: true
    },
    {
      trigger: 'kieSeedanceV1Version',
      effect: 'autoSwitch',
      target: 'kieSeedanceV1FastMode',
      condition: (version: string, allParams: Record<string, unknown>) =>
        version !== 'pro' && allParams.kieSeedanceV1FastMode === true,
      value: false,
      noRestore: true
    }
  ],
  },
  "kie-seedream-4.0": {
    meta: {
      name: { key: 'meta.name', fallback: 'Seedream 4.0' },
      i18nScope: 'models.defs.kie-seedream-4.0',
    },
    params: {
      "kieSeedream40AspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [
        { value: 'smart', label: sharedOptionText('smart') },
        { value: '1:1', label: '1:1' },
        { value: '4:3', label: '4:3' },
        { value: '3:4', label: '3:4' },
        { value: '3:2', label: '3:2' },
        { value: '2:3', label: '2:3' },
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
      "kieSeedream40Resolution": {
        name: sharedFieldText('resolution'),
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
      "kieSeedream40MaxImages": {
        name: sharedFieldText('maxImages'),
      },
    },
    linkages: [],
  },
}
