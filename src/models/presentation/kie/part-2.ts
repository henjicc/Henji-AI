/** kie 模型展示补丁（第 2/6 组）。 */

import { sharedFieldText, sharedModeText, sharedOptionText } from '@/core/i18n/modelText'
import type { I18nText } from '@/core/types/I18nText'
import type { ModelPresentation } from '@/core/types/ModelPresentation'

export const kiePresentationPart2: Record<string, ModelPresentation> = {
  "kie-hailuo-02": {
    meta: {
      name: { key: 'meta.name', fallback: 'Hailuo 02' },
      i18nScope: 'models.defs.kie-hailuo-02',
    },
    params: {
      "kieHailuo02Duration": {
        name: sharedFieldText('duration'),
        optionLabels: Object.fromEntries((
          [
        { value: 6, label: '6s' },
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
      "kieHailuo02Resolution": {
        name: sharedFieldText('resolution'),
        optionLabels: Object.fromEntries((
          [
        { value: '512P', label: '512P' },
        { value: '768P', label: '768P' },
        { value: '1080P', label: '1080P' }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "kieHailuo02PromptOptimizer": {
        name: sharedFieldText('promptOptimizer'),
      },
    },
    linkages: [
    {
      trigger: ['kieHailuo02Resolution', 'kieHailuo02Duration'],
      effect: 'autoSwitch',
      target: 'kieHailuo02Duration',
      condition: (_: unknown, allParams: Record<string, unknown>) => {
        return allParams.kieHailuo02Resolution === '1080P' && allParams.kieHailuo02Duration !== 6
      },
      value: 6
    },
    {
      trigger: ['kieHailuo02Duration', 'kieHailuo02Resolution'],
      effect: 'autoSwitch',
      target: 'kieHailuo02Resolution',
      condition: (_: unknown, allParams: Record<string, unknown>) => {
        return allParams.kieHailuo02Duration === 10 && allParams.kieHailuo02Resolution === '1080P'
      },
      value: '768P'
    }
  ],
  },
  "kie-hailuo-2-3": {
    meta: {
      name: { key: 'meta.name', fallback: 'Hailuo 2.3' },
      i18nScope: 'models.defs.kie-hailuo-2-3',
    },
    params: {
      "kieHailuo23Mode": {
        name: sharedFieldText('mode'),
        optionLabels: Object.fromEntries((
          [
        { value: 'standard', label: sharedOptionText('standard') },
        { value: 'pro', label: sharedOptionText('pro') }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "kieHailuo23Duration": {
        name: sharedFieldText('duration'),
        optionLabels: Object.fromEntries((
          [
        { value: 6, label: '6s' },
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
      "kieHailuo23Resolution": {
        name: sharedFieldText('resolution'),
        optionLabels: Object.fromEntries((
          [
        { value: '768P', label: '768P' },
        { value: '1080P', label: '1080P' }
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
    {
      trigger: ['kieHailuo23Duration', 'kieHailuo23Resolution'],
      effect: 'autoSwitch',
      target: 'kieHailuo23Resolution',
      condition: (_: unknown, allParams: Record<string, unknown>) => {
        return allParams.kieHailuo23Duration === 10 && allParams.kieHailuo23Resolution === '1080P'
      },
      value: '768P'
    }
  ],
  },
  "kie-kling-3.0-omni": {
    meta: {
      name: { key: 'meta.name', fallback: 'Kling 3.0 Omni' },
      i18nScope: 'models.defs.kie-kling-3.0-omni',
    },
    params: {
      "kieKling30OmniMode": {
        name: sharedFieldText('mode'),
        optionLabels: Object.fromEntries((
          [
        { value: 'text-to-video', label: sharedModeText('textToVideo') },
        { value: 'image-to-video', label: sharedModeText('imageToVideo') },
        { value: 'transformation', label: sharedModeText('videoEdit') },
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
      "kieKling30OmniAspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [
        { value: 'smart', label: sharedOptionText('smart') },
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
      "kieKling30OmniResolution": {
        name: sharedFieldText('resolution'),
        optionLabels: Object.fromEntries((
          [
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
      "kieKling30OmniDuration": {
        name: sharedFieldText('duration'),
        optionLabels: Object.fromEntries((
          Array.from({ length: 13 }, (_, index) => {
        const value = String(index + 3)
        return { value, label: `${value}s` }
      })
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "kieKling30OmniAudio": {
        name: sharedFieldText('generateAudio'),
      },
    },
    linkages: [],
  },
  "kie-kling-3.0-turbo": {
    meta: {
      name: { key: 'meta.name', fallback: 'Kling 3.0 Turbo' },
      i18nScope: 'models.defs.kie-kling-3.0-turbo',
    },
    params: {
      "kieKling30TurboAspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [
        { value: 'smart', label: sharedOptionText('smart') },
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
      "kieKling30TurboResolution": {
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
      "kieKling30TurboDuration": {
        name: sharedFieldText('duration'),
        optionLabels: Object.fromEntries((
          Array.from({ length: 13 }, (_, index) => {
        const value = String(index + 3)
        return { value, label: `${value}s` }
      })
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
  "kie-kling-3.0": {
    meta: {
      name: { key: 'meta.name', fallback: 'Kling 3.0' },
      i18nScope: 'models.defs.kie-kling-3.0',
    },
    params: {
      "kieKling30AspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [
        { value: 'smart', label: sharedOptionText('smart') },
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
      "kieKling30Resolution": {
        name: sharedFieldText('resolution'),
        optionLabels: Object.fromEntries((
          [
        { value: '720p', label: '720p' },
        { value: '1080p', label: '1080p' },
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
      "kieKling30Duration": {
        name: sharedFieldText('duration'),
        optionLabels: Object.fromEntries((
          Array.from({ length: 13 }, (_, index) => {
        const value = String(index + 3)
        return { value, label: `${value}s` }
      })
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "kieKling30Sound": {
        name: sharedFieldText('generateAudio'),
      },
    },
    linkages: [],
  },
}
