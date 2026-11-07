/** kie 模型展示补丁（第 1/6 组）。 */

import { sharedFieldText, sharedOptionText } from '@/core/i18n/modelText'
import type { I18nText } from '@/core/types/I18nText'
import type { Linkage } from '@/core/types/Linkage'
import type { ModelPresentation } from '@/core/types/ModelPresentation'

function hasUploadedImage(params: Record<string, unknown>): boolean {
  return [params.uploadedFilePaths, params.images, params.uploadedImages]
    .some(value => Array.isArray(value) && value.length > 0)
}

/**
 * GPT Image 2（KIE）各比例能用的分辨率，与 SDK 构建器的校验一致：5:4、4:5 只有 1K；
 * 文生图的 3:1、1:3、9:21 只有 1K；图生图的 1:1 没有 4K。智能比例由构建器在可用比例里挑，不受限。
 */
function kieGptImage2Resolutions(params: Record<string, unknown>): string[] {
  const ratio = params.kieGptImage2AspectRatio
  if (ratio === '5:4' || ratio === '4:5') return ['1K']
  const image = hasUploadedImage(params)
  if (!image && (ratio === '3:1' || ratio === '1:3' || ratio === '9:21')) return ['1K']
  if (image && ratio === '1:1') return ['1K', '2K']
  return ['1K', '2K', '4K']
}
const kieGptImage2Triggers = ['kieGptImage2AspectRatio', 'uploadedImages', 'images']
const kieGptImage2Linkages: Linkage[] = [
  {
    trigger: kieGptImage2Triggers, effect: 'filterOptions', target: 'kieGptImage2Resolution',
    filter: (_value, options, params) => options.filter(option => kieGptImage2Resolutions(params).includes(String(option.value))),
  },
  {
    trigger: kieGptImage2Triggers, effect: 'reset', targets: ['kieGptImage2Resolution'],
    condition: (_value, params) => !kieGptImage2Resolutions(params).includes(String(params.kieGptImage2Resolution)),
  },
]

export const kiePresentationPart1: Record<string, ModelPresentation> = {
  "kie-gemini-omni-video": {
    meta: {
      name: { key: 'meta.name', fallback: 'Gemini Omni' },
      i18nScope: 'models.defs.kie-gemini-omni-video',
    },
    params: {
      "kieGeminiOmniVideoDuration": {
        name: sharedFieldText('duration'),
        optionLabels: Object.fromEntries((
          [
        { value: '4', label: '4s' },
        { value: '6', label: '6s' },
        { value: '8', label: '8s' },
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
      "kieGeminiOmniVideoAspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [
        { value: 'smart', label: sharedOptionText('smart') },
        { value: '16:9', label: '16:9' },
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
      "kieGeminiOmniVideoResolution": {
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
    },
    linkages: [],
  },
  "kie-gpt-image-2": {
    meta: {
      name: { key: 'meta.name', fallback: 'GPT Image 2' },
      i18nScope: 'models.defs.kie-gpt-image-2',
    },
    params: {
      "kieGptImage2AspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [
        { value: 'smart', label: sharedOptionText('smart') },
        { value: '1:1', label: '1:1' },
        { value: '5:4', label: '5:4' },
        { value: '4:3', label: '4:3' },
        { value: '3:2', label: '3:2' },
        { value: '16:9', label: '16:9' },
        { value: '21:9', label: '21:9' },
        { value: '4:5', label: '4:5' },
        { value: '3:4', label: '3:4' },
        { value: '2:3', label: '2:3' },
        { value: '9:16', label: '9:16' },
        { value: '2:1', label: '2:1' },
        { value: '1:2', label: '1:2' },
        { value: '3:1', label: '3:1' },
        { value: '1:3', label: '1:3' },
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
      "kieGptImage2Resolution": {
        name: sharedFieldText('resolution'),
        optionLabels: Object.fromEntries((
          [
        { value: '1K', label: '1K' },
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
    linkages: kieGptImage2Linkages,
  },
  "kie-grok-imagine-2.0": {
    meta: {
      name: { key: 'meta.name', fallback: 'Grok Imagine Image 2.0' },
      i18nScope: 'models.defs.kie-grok-imagine-2.0',
    },
    params: {
      "kieGrokImagine20AspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [
        { value: 'smart', label: sharedOptionText('smart') },
        { value: '1:1', label: '1:1' },
        { value: '2:3', label: '2:3' },
        { value: '3:2', label: '3:2' },
        { value: '16:9', label: '16:9' },
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
    },
    linkages: [],
  },
  "kie-grok-imagine-video": {
    meta: {
      name: { key: 'meta.name', fallback: 'Grok Imagine Video' },
      i18nScope: 'models.defs.kie-grok-imagine-video',
    },
    params: {
      "kieGrokImagineVideoAspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [
        { value: '2:3', label: '2:3' },
        { value: '3:2', label: '3:2' },
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
      "kieGrokImagineVideoMode": {
        name: sharedFieldText('mode'),
        role: 'mode',
        optionLabels: Object.fromEntries((
          [
        { value: 'fun', label: sharedOptionText('fun') },
        { value: 'normal', label: sharedOptionText('normal') },
        { value: 'spicy', label: sharedOptionText('spicy') }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "kieGrokImagineVideoDuration": {
        name: sharedFieldText('duration'),
      },
      "kieGrokImagineVideoResolution": {
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
    },
    linkages: [{
      trigger: ['kieGrokImagineVideoMode', 'images', 'uploadedImages'], effect: 'filterOptions', target: 'kieGrokImagineVideoMode',
      filter: (_: unknown, options, allParams) => hasUploadedImage(allParams) ? options.filter(option => option.value !== 'spicy') : options,
    }, {
      // 官方图生视频不支持 spicy，构建器按 normal 发送，界面跟着显示 normal。
      trigger: ['kieGrokImagineVideoMode', 'images', 'uploadedImages'], effect: 'autoSwitch', target: 'kieGrokImagineVideoMode',
      condition: (_: unknown, allParams: Record<string, unknown>) => allParams.kieGrokImagineVideoMode === 'spicy' && hasUploadedImage(allParams),
      value: 'normal',
    }],
  },
  "kie-grok-imagine": {
    meta: {
      name: { key: 'meta.name', fallback: 'Grok Imagine' },
      i18nScope: 'models.defs.kie-grok-imagine',
    },
    params: {
      "kieGrokImagineMode": {
        role: 'mode',
        name: { zh: '模式', en: 'Mode' },
        optionLabels: Object.fromEntries((
          [
        { value: 'text-to-image', label: { zh: '文生图', en: 'Text to Image' } },
        { value: 'image-to-image', label: { zh: '图生图', en: 'Image to Image' } }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "kieGrokImagineQuality": {
        name: sharedFieldText('quality'),
        optionLabels: Object.fromEntries((
          [
        { value: 'standard', label: { zh: '标准', en: 'Standard' } },
        { value: 'quality', label: { zh: '质量', en: 'Quality' } }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "kieGrokImagineAspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [
        { value: '1:1', label: '1:1' },
        { value: '2:3', label: '2:3' },
        { value: '3:2', label: '3:2' },
        { value: '9:16', label: '9:16' },
        { value: '16:9', label: '16:9' }
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
