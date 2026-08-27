/** fal 模型展示补丁（第 2/7 组）。 */

import { sharedFieldText, sharedModeText, sharedOptionText } from '@/core/i18n/modelText'
import type { I18nText } from '@/core/types/I18nText'
import type { ModelPresentation } from '@/core/types/ModelPresentation'

export const falPresentationPart2: Record<string, ModelPresentation> = {
  "fal-ai-kling-3.0-turbo": {
    meta: {
      name: { key: 'meta.name', fallback: 'Kling 3.0 Turbo' },
      i18nScope: 'models.defs.fal-ai-kling-3.0-turbo',
    },
    params: {
      "falKling30TurboAspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [
        { value: 'smart', label: sharedOptionText('smart') },
        { value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }, { value: '1:1', label: '1:1' }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falKling30TurboResolution": {
        name: sharedFieldText('resolution'),
        optionLabels: Object.fromEntries((
          [
        { value: 'standard', label: { zh: '标准', en: 'Standard' } },
        { value: 'pro', label: { zh: '专业', en: 'Pro' } }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falKling30TurboDuration": {
        name: sharedFieldText('duration'),
      },
    },
    linkages: [],
  },
  "fal-ai-kling-3.0": {
    meta: {
      name: { key: 'meta.name', fallback: 'Kling 3.0' },
      i18nScope: 'models.defs.fal-ai-kling-3.0',
    },
    params: {
      "falKling30AspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [
        { value: 'smart', label: sharedOptionText('smart') },
        { value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }, { value: '1:1', label: '1:1' }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falKling30Resolution": {
        name: sharedFieldText('resolution'),
        optionLabels: Object.fromEntries((
          [
        { value: 'standard', label: { zh: '标准', en: 'Standard' } },
        { value: 'pro', label: { zh: '专业', en: 'Pro' } }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falKling30Duration": {
        name: sharedFieldText('duration'),
      },
      "falKling30GenerateAudio": {
        name: sharedFieldText('generateAudio'),
      },
    },
    linkages: [],
  },
  "fal-ai-kling-image-o1": {
    meta: {
      name: { key: 'meta.name', fallback: 'Kling Image O1' },
      i18nScope: 'models.defs.fal-ai-kling-image-o1',
    },
    params: {
      "falKlingImageO1NumImages": {
        name: sharedFieldText('numberOfImages'),
      },
      "falKlingImageO1AspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [
        { value: 'auto', label: sharedOptionText('auto') },
        { value: '1:1', label: '1:1' },
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' },
        { value: '4:3', label: '4:3' },
        { value: '3:4', label: '3:4' },
        { value: '3:2', label: '3:2' },
        { value: '2:3', label: '2:3' },
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
      "falKlingImageO1Resolution": {
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
    },
    linkages: [
  ],
  },
  "fal-ai-kling-video-o1": {
    meta: {
      name: { key: 'meta.name', fallback: 'Kling Video O1' },
      i18nScope: 'models.defs.fal-ai-kling-video-o1',
    },
    params: {
      "falKlingVideoO1Mode": {
        name: sharedFieldText('mode'),
        optionLabels: Object.fromEntries((
          [
        { value: 'image-to-video', label: sharedModeText('imageToVideo') },
        { value: 'reference-to-video', label: sharedModeText('referenceToVideo') },
        { value: 'video-to-video-edit', label: sharedModeText('videoEdit') },
        { value: 'video-to-video-reference', label: sharedModeText('videoReference') }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falKlingVideoO1VideoDuration": {
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
      "falKlingVideoO1AspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [
        { value: 'auto', label: sharedOptionText('auto') },
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
      "falKlingVideoO1KeepAudio": {
        name: sharedFieldText('keepAudio'),
      },
    },
    linkages: [],
  },
  "fal-ai-kling-video-v2.6-pro": {
    meta: {
      name: { key: 'meta.name', fallback: 'Kling Video V2.6 Pro' },
      i18nScope: 'models.defs.fal-ai-kling-video-v2.6-pro',
    },
    params: {
      "falKlingV26ProMode": {
        name: sharedFieldText('mode'),
        optionLabels: Object.fromEntries((
          [
        { value: 'text-image-to-video', label: sharedModeText('textImageToVideo') },
        { value: 'motion-control', label: sharedModeText('motionControl') }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falKlingV26ProResolution": {
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
      "falKlingV26ProCharacterOrientation": {
        name: sharedFieldText('characterOrientation'),
        optionLabels: Object.fromEntries((
          [
        { value: 'video', label: sharedOptionText('matchVideo') },
        { value: 'image', label: sharedOptionText('matchImage') }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falKlingV26ProKeepOriginalSound": {
        name: sharedFieldText('keepOriginalSound'),
      },
      "falKlingV26ProVideoDuration": {
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
      "falKlingV26ProAspectRatio": {
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
      "falKlingV26ProCfgScale": {
        name: sharedFieldText('cfgScale'),
      },
      "falKlingV26ProGenerateAudio": {
        name: sharedFieldText('generateAudio'),
      },
    },
    linkages: [],
  },
}
