/** apimart 模型展示补丁（第 2/5 组）。 */

import { sharedFieldText, sharedOptionText } from '@/core/i18n/modelText'
import type { I18nText } from '@/core/types/I18nText'
import type { ModelPresentation } from '@/core/types/ModelPresentation'

export const apimartPresentationPart2: Record<string, ModelPresentation> = {
  "apimart-kling-3.0-omni": {
    meta: {
      name: { key: 'meta.name', fallback: 'Kling 3.0 Omni' },
      i18nScope: 'models.defs.apimart-kling-3.0-omni',
    },
    params: {
      "apimartKling30OmniMode": {
        name: sharedFieldText('mode'),
        role: 'mode',
        optionLabels: Object.fromEntries((
          [
        { value: 'text-image-to-video', label: { zh: '文生 / 首尾帧', en: 'Text / Start-End Frame' } },
        { value: 'reference-to-video', label: { zh: '多图参考', en: 'Image Reference' } }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "apimartKling30OmniAspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [{ value: 'smart', label: sharedOptionText('smart') }, ...['16:9', '9:16', '1:1'].map((ratio) => ({ value: ratio, label: ratio }))]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "apimartKling30OmniResolution": {
        name: sharedFieldText('resolution'),
        optionLabels: Object.fromEntries((
          ['720p', '1080p', '4K'].map((value) => ({ value, label: value }))
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "apimartKling30OmniDuration": {
        name: sharedFieldText('duration'),
      },
      "apimartKling30OmniAudio": {
        name: sharedFieldText('generateAudio'),
      },
      "apimartKling30OmniKeepOriginalSound": {
        name: { zh: '保留视频原声', en: 'Keep Original Sound' },
      },
      "apimartKling30OmniVideoReferenceType": {
        name: { zh: '视频参考类型', en: 'Video Reference Type' },
        optionLabels: Object.fromEntries((
          [
        { value: 'base', label: { zh: '视频编辑', en: 'Base / Edit' } },
        { value: 'feature', label: { zh: '特征参考', en: 'Feature Reference' } }
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
  "apimart-kling-3.0-turbo": {
    meta: {
      name: { key: 'meta.name', fallback: 'Kling 3.0 Turbo' },
      i18nScope: 'models.defs.apimart-kling-3.0-turbo',
    },
    params: {
      "apimartKling30TurboAspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [{ value: 'smart', label: sharedOptionText('smart') }, ...['16:9', '9:16', '1:1'].map((ratio) => ({ value: ratio, label: ratio }))]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "apimartKling30TurboResolution": {
        name: sharedFieldText('resolution'),
        optionLabels: Object.fromEntries((
          ['720p', '1080p'].map((value) => ({ value, label: value }))
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "apimartKling30TurboDuration": {
        name: sharedFieldText('duration'),
      },
    },
    linkages: [],
  },
  "apimart-kling-3.0": {
    meta: {
      name: { key: 'meta.name', fallback: 'Kling 3.0' },
      i18nScope: 'models.defs.apimart-kling-3.0',
    },
    params: {
      "apimartKling30AspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [{ value: 'smart', label: sharedOptionText('smart') }, ...['16:9', '9:16', '1:1'].map((ratio) => ({ value: ratio, label: ratio }))]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "apimartKling30Resolution": {
        name: sharedFieldText('resolution'),
        optionLabels: Object.fromEntries((
          ['720p', '1080p', '4K'].map((value) => ({ value, label: value }))
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "apimartKling30Duration": {
        name: sharedFieldText('duration'),
      },
      "apimartKling30Audio": {
        name: sharedFieldText('generateAudio'),
      },
    },
    linkages: [],
  },
  "apimart-midjourney-video": {
    meta: {
      name: { key: 'meta.name', fallback: 'Midjourney Video' },
      i18nScope: 'models.defs.apimart-midjourney-video',
    },
    params: {
      "apimartMidjourneyVideoIndex": {
        name: { zh: '首帧', en: 'First Frame' },
        description: { zh: '从 Midjourney 图片结果做成视频时，用四宫格里的第几张作首帧', en: 'Which image of the Midjourney grid becomes the first frame when animating an image result' },
        optionLabels: Object.fromEntries((
          ['0', '1', '2', '3'].map((value, index) => ({
        value,
        label: { zh: `第 ${index + 1} 张`, en: `Image ${index + 1}` }
      }))
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "apimartMidjourneyVideoResolution": {
        name: sharedFieldText('resolution'),
        optionLabels: Object.fromEntries((
          [{ value: '480p', label: '480p' }, { value: '720p', label: '720p' }]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "apimartMidjourneyVideoAnimateMode": {
        name: { zh: '动画模式', en: 'Animate Mode' },
        optionLabels: Object.fromEntries((
          [
        { value: 'manual', label: { zh: '手动', en: 'Manual' } },
        { value: 'auto', label: { zh: '自动', en: 'Automatic' } }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "apimartMidjourneyVideoMotion": {
        name: { zh: '运动幅度', en: 'Motion' },
        optionLabels: Object.fromEntries((
          [{ value: 'low', label: { zh: '低', en: 'Low' } }, { value: 'high', label: { zh: '高', en: 'High' } }]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "apimartMidjourneyVideoBatchSize": {
        name: { zh: '生成数量', en: 'Batch Size' },
        optionLabels: Object.fromEntries((
          ['1', '2', '4'].map((value) => ({ value, label: value }))
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
    },
    paramPresentation: {
    groups: [{
      id: 'midjourney-animation-settings',
      name: { zh: '动画设置', en: 'Animation' },
      order: 3,
      panelWidth: 420,
      sections: [
        {
          id: 'motion',
          name: { zh: '运动', en: 'Motion' },
          paramIds: [
            'apimartMidjourneyVideoIndex',
            'apimartMidjourneyVideoAnimateMode',
            'apimartMidjourneyVideoMotion'
          ]
        }
      ]
    }]
  },
    linkages: [],
  },
}
