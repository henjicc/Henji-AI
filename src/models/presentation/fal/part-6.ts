/** fal 模型展示补丁（第 6/7 组）。 */

import { sharedFieldText, sharedModeText, sharedOptionText } from '@/core/i18n/modelText'
import type { I18nText } from '@/core/types/I18nText'
import type { ModelPresentation } from '@/core/types/ModelPresentation'

export const falPresentationPart6: Record<string, ModelPresentation> = {
  "fal-ai-bytedance-seedream-v4.5": {
    meta: {
      name: { key: 'meta.name', fallback: 'Seedream V4.5' },
      i18nScope: 'models.defs.fal-ai-bytedance-seedream-v4.5',
    },
    params: {
      "falSeedreamV45AspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [
        { value: 'smart', label: sharedOptionText('smart') },
        { value: '21:9', label: '21:9' },
        { value: '16:9', label: '16:9' },
        { value: '3:2', label: '3:2' },
        { value: '4:3', label: '4:3' },
        { value: '1:1', label: '1:1' },
        { value: '3:4', label: '3:4' },
        { value: '2:3', label: '2:3' },
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
      "falSeedreamV45Resolution": {
        name: sharedFieldText('resolution'),
        optionLabels: Object.fromEntries((
          [
        { value: '2K', label: sharedOptionText('2k') },
        { value: '4K', label: sharedOptionText('4k') },
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falSeedream45NumImages": {
        name: sharedFieldText('numberOfImages'),
      },
    },
    linkages: [],
  },
  "fal-ai-bytedance-seedream-v4": {
    meta: {
      name: { key: 'meta.name', fallback: 'Seedream V4' },
      i18nScope: 'models.defs.fal-ai-bytedance-seedream-v4',
    },
    params: {
      "falSeedreamV4AspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [
        { value: 'smart', label: sharedOptionText('smart') },
        { value: '21:9', label: '21:9' },
        { value: '16:9', label: '16:9' },
        { value: '3:2', label: '3:2' },
        { value: '4:3', label: '4:3' },
        { value: '1:1', label: '1:1' },
        { value: '3:4', label: '3:4' },
        { value: '2:3', label: '2:3' },
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
      "falSeedreamV4Resolution": {
        name: sharedFieldText('resolution'),
        optionLabels: Object.fromEntries((
          [
        { value: '2K', label: sharedOptionText('2k') },
        { value: '4K', label: sharedOptionText('4k') },
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falSeedream40NumImages": {
        name: sharedFieldText('numberOfImages'),
      },
    },
    linkages: [],
  },
  "fal-ai-veo-3.1": {
    meta: {
      name: { key: 'meta.name', fallback: 'Veo 3.1' },
      i18nScope: 'models.defs.fal-ai-veo-3.1',
    },
    params: {
      "falVeo31Mode": {
        name: sharedFieldText('mode'),
        optionLabels: Object.fromEntries((
          [
        { value: 'text-image-to-video', label: sharedModeText('textImageToVideo') },
        { value: 'start-end-frame', label: sharedModeText('startEndFrame', 'Start/End Frame') },
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
      "falVeo31VideoDuration": {
        name: sharedFieldText('duration'),
        optionLabels: Object.fromEntries((
          [
        { value: 4, label: '4s' },
        { value: 6, label: '6s' },
        { value: 8, label: '8s' }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falVeo31AspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [
        { value: 'auto', label: sharedOptionText('auto') },
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
      "falVeo31Resolution": {
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
      "falVeo31GenerateAudio": {
        name: sharedFieldText('generateAudio'),
      },
      "falVeo31AutoFix": {
        name: sharedFieldText('autoFix'),
      },
      "falVeo31FastMode": {
        name: sharedFieldText('fastMode'),
      },
      "falVeo31EnhancePrompt": {
        name: sharedFieldText('enhancePrompt'),
      },
    },
    linkages: [
    // 参考生视频官方只接受 8s（image-to-video / 首尾帧才有 4s/6s/8s），
    // 选中该模式时收敛选项并把已选的 4s/6s 拉回 8s，避免把非法 duration 发给 API
    {
      trigger: 'falVeo31Mode',
      effect: 'filterOptions',
      target: 'falVeo31VideoDuration',
      filter: (mode, options) =>
        mode === 'reference-to-video' ? options.filter((opt) => opt.value === 8) : options
    },
    {
      trigger: 'falVeo31Mode',
      effect: 'autoSwitch',
      target: 'falVeo31VideoDuration',
      condition: (mode, allParams) =>
        mode === 'reference-to-video' && allParams.falVeo31VideoDuration !== 8,
      value: 8
    },],
  },
  "fal-ai-vidu-q2": {
    meta: {
      name: { key: 'meta.name', fallback: 'Vidu Q2' },
      i18nScope: 'models.defs.fal-ai-vidu-q2',
    },
    params: {
      "viduQ2Mode": {
        name: sharedFieldText('mode'),
        optionLabels: Object.fromEntries((
          [
        { value: 'text-to-video', label: sharedModeText('textToVideo') },
        { value: 'image-to-video', label: sharedModeText('imageToVideo') },
        { value: 'reference-to-video', label: sharedModeText('referenceToVideo') },
        { value: 'video-extension', label: sharedModeText('videoExtension') }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falViduQ2VideoDuration": {
        name: sharedFieldText('duration'),
        optionLabels: Object.fromEntries((
          [
        { value: 4, label: '4s' },
        { value: 6, label: '6s' },
        { value: 8, label: '8s' }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "viduQ2AspectRatio": {
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
      "viduQ2Resolution": {
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
      "viduQ2MovementAmplitude": {
        name: sharedFieldText('movementAmplitude'),
        optionLabels: Object.fromEntries((
          [
        { value: 'auto', label: sharedOptionText('auto') },
        { value: 'low', label: sharedOptionText('low') },
        { value: 'medium', label: sharedOptionText('medium') },
        { value: 'high', label: sharedOptionText('high') }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "viduQ2Bgm": {
        name: sharedFieldText('backgroundMusic'),
      },
      "viduQ2FastMode": {
        name: sharedFieldText('turboMode'),
      },
    },
    linkages: [],
  },
}
