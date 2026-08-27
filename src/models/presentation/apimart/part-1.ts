/** apimart 模型展示补丁（第 1/5 组）。 */

import { sharedFieldText, sharedOptionText } from '@/core/i18n/modelText'
import type { I18nText } from '@/core/types/I18nText'
import type { ModelPresentation } from '@/core/types/ModelPresentation'

export const apimartPresentationPart1: Record<string, ModelPresentation> = {
  "apimart-gemini-omni-flash": {
    meta: {
      name: { key: 'meta.name', fallback: 'Gemini Omni Flash' },
      i18nScope: 'models.defs.apimart-gemini-omni-flash',
    },
    params: {
      "apimartGeminiOmniFlashChannel": {
        role: 'channel',
        name: sharedFieldText('apiChannel'),
        optionLabels: Object.fromEntries((
          [
        { value: 'official', label: sharedOptionText('official') },
        { value: 'ext', label: sharedOptionText('regular') }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "apimartGeminiOmniFlashAspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [{ value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "apimartGeminiOmniFlashResolution": {
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
      "apimartGeminiOmniFlashOfficialDuration": {
        name: sharedFieldText('duration'),
      },
      "apimartGeminiOmniFlashExtDuration": {
        name: sharedFieldText('duration'),
        optionLabels: Object.fromEntries((
          ['4', '6', '8', '10'].map((value) => ({ value, label: `${value}s` }))
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "apimartGeminiOmniFlashGenerationType": {
        name: { zh: '图片生成方式', en: 'Image Generation Type' },
        optionLabels: Object.fromEntries((
          [
        { value: 'reference', label: { zh: '参考融合', en: 'Reference' } },
        { value: 'frame', label: { zh: '首帧动画', en: 'First Frame' } }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "apimartGeminiOmniFlashExtendTaskId": {
        name: { zh: '延续任务 ID', en: 'Extend From Task ID' },
      },
    },
    linkages: [{
    trigger: 'apimartGeminiOmniFlashChannel',
    effect: 'filterOptions',
    target: 'apimartGeminiOmniFlashResolution',
    filter: (channel, options) => channel === 'ext'
      ? options
      : options.filter((option) => option.value === '720p')
  }, {
    trigger: 'apimartGeminiOmniFlashChannel',
    effect: 'autoSwitch',
    target: 'apimartGeminiOmniFlashResolution',
    condition: (channel, allParams) => channel !== 'ext' && allParams.apimartGeminiOmniFlashResolution !== '720p',
    value: '720p'
  }],
  },
  "apimart-gpt-image-2": {
    meta: {
      name: { key: 'meta.name', fallback: 'GPT Image 2' },
      i18nScope: 'models.defs.apimart-gpt-image-2',
    },
    params: {
      "apimartGptImage2Version": {
        role: 'channel',
        name: sharedFieldText('apiChannel'),
        optionLabels: Object.fromEntries((
          [
        { value: 'ext', label: sharedOptionText('regular') },
        { value: 'official', label: sharedOptionText('official') }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "apimartGptImage2AspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [
        { value: 'smart', label: sharedOptionText('smart') },
        ...([
  '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16',
  '2:1', '1:2', '3:1', '1:3', '21:9', '9:21'
] as const).map((ratio) => ({ value: ratio, label: ratio }))
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "apimartGptImage2Resolution": {
        name: sharedFieldText('resolution'),
        optionLabels: Object.fromEntries((
          ['1K', '2K', '4K'].map((value) => ({ value, label: value }))
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "apimartGptImage2Quality": {
        name: sharedFieldText('quality'),
        optionLabels: Object.fromEntries((
          [
        { value: 'auto', label: sharedOptionText('auto') },
        { value: 'low', label: { zh: '低', en: 'Low' } },
        { value: 'medium', label: { zh: '标准', en: 'Medium' } },
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
      "apimartGptImage2Background": {
        name: { zh: '背景', en: 'Background' },
        optionLabels: Object.fromEntries((
          [
        { value: 'auto', label: sharedOptionText('auto') },
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
      "apimartGptImage2Count": {
        name: { zh: '生成数量', en: 'Output Count' },
      },
      "apimartGptImage2MaskUrl": {
        name: { zh: '局部重绘遮罩', en: 'Inpainting Mask' },
        description: { zh: '请上传与首张参考图同尺寸、带透明通道的遮罩图', en: 'Upload a mask with alpha matching the first reference image size' },
      },
    },
    linkages: [],
  },
  "apimart-grok-imagine-2.0": {
    meta: {
      name: { key: 'meta.name', fallback: 'Grok Imagine Image 2.0' },
      i18nScope: 'models.defs.apimart-grok-imagine-2.0',
    },
    params: {
      "apimartGrokImagine20Version": {
        role: 'channel',
        name: sharedFieldText('apiChannel'),
        optionLabels: Object.fromEntries((
          [
        { value: 'ext', label: sharedOptionText('regular') },
        { value: 'official', label: sharedOptionText('official') }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "apimartGrokImagine20AspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [
        { value: 'smart', label: sharedOptionText('smart') },
        ...([...new Set([...(['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9'] as const), ...([
  '1:1', '3:4', '4:3', '9:16', '16:9', '2:3', '3:2',
  '9:19.5', '19.5:9', '9:20', '20:9', '1:2', '2:1'
] as const)])]).map((ratio) => ({ value: ratio, label: ratio }))
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "apimartGrokImagine20Resolution": {
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
      "apimartGrokImagine20Quality": {
        name: sharedFieldText('quality'),
        optionLabels: Object.fromEntries((
          [
        { value: 'low', label: { zh: '低', en: 'Low' } },
        { value: 'medium', label: { zh: '标准', en: 'Medium' } }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "apimartGrokImagine20Count": {
        name: { zh: '生成数量', en: 'Output Count' },
      },
    },
    linkages: [
    {
      trigger: 'apimartGrokImagine20Version',
      effect: 'filterOptions',
      target: 'apimartGrokImagine20AspectRatio',
      filter: (version, options) => {
        const allowed = version === 'official'
          ? ['smart', '1:1', '3:4', '4:3', '9:16', '16:9', '2:3', '3:2', '9:19.5', '19.5:9', '9:20', '20:9', '1:2', '2:1']
          : ['smart', '1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9']
        return options.filter((option) => allowed.includes(String(option.value)))
      }
    },
    {
      trigger: 'apimartGrokImagine20Version',
      effect: 'filterRange',
      target: 'apimartGrokImagine20Count',
      filter: (version) => ({ min: 1, max: version === 'official' ? 10 : 12, step: 1 })
    },
    {
      trigger: 'apimartGrokImagine20Version',
      effect: 'autoSwitch',
      target: 'apimartGrokImagine20Count',
      condition: (version, params) => version === 'official' && Number(params.apimartGrokImagine20Count) > 10,
      value: 10,
      noRestore: true
    },
    {
      trigger: 'apimartGrokImagine20Version',
      effect: 'autoSwitch',
      target: 'apimartGrokImagine20AspectRatio',
      condition: (version, params) => {
        if (version !== 'ext') return false
        return ['9:19.5', '19.5:9', '9:20', '20:9', '1:2', '2:1'].includes(String(params.apimartGrokImagine20AspectRatio))
      },
      value: 'smart',
      noRestore: true
    }
  ],
  },
}
