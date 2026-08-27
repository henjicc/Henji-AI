/** Grsai 模型的展示补丁：i18n 文案、联动、面板布局。按模型 id 关联运行时定义。 */

import { sharedFieldText, sharedOptionText } from '@/core/i18n/modelText'
import type { ModelPresentation } from '@/core/types/ModelPresentation'

const RATIO_LABELS = [
  '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9', '9:21',
  '1:2', '2:1', '1:3', '3:1', '1:4', '4:1', '1:8', '8:1',
]
const ratioOptionLabels = Object.fromEntries(RATIO_LABELS.map((ratio) => [ratio, { label: ratio }]))
const resolutionOptionLabels = {
  '1K': { label: '1K' },
  '2K': { label: '2K' },
  '4K': { label: '4K' },
}

export const grsaiPresentation: Record<string, ModelPresentation> = {
  'grsai-gpt-image-2': {
    meta: {
      name: { key: 'meta.name', fallback: 'GPT Image 2' },
      i18nScope: 'models.defs.grsai-gpt-image-2',
    },
    params: {
      grsaiGptImage2Channel: {
        name: sharedFieldText('apiChannel'),
        role: 'channel',
        optionLabels: {
          standard: { label: { zh: '标准', en: 'Standard' } },
          vip: { label: { zh: 'VIP', en: 'VIP' } },
        },
      },
      grsaiGptImage2AspectRatio: {
        name: sharedFieldText('aspectRatio'),
        optionLabels: { smart: { label: sharedOptionText('smart') }, ...ratioOptionLabels },
      },
      grsaiGptImage2Resolution: {
        name: sharedFieldText('resolution'),
        optionLabels: resolutionOptionLabels,
      },
    },
    linkages: [],
  },

  'grsai-nano-banana-2-lite': {
    meta: {
      name: { key: 'meta.name', fallback: 'Nano Banana 2 Lite' },
      i18nScope: 'models.defs.grsai-nano-banana-2-lite',
    },
    params: {
      grsaiNanoBanana2LiteAspectRatio: {
        name: sharedFieldText('aspectRatio'),
        optionLabels: { smart: { label: sharedOptionText('smart') }, ...ratioOptionLabels },
      },
    },
    linkages: [],
  },

  'grsai-nano-banana-2': {
    meta: {
      name: { key: 'meta.name', fallback: 'Nano Banana 2' },
      i18nScope: 'models.defs.grsai-nano-banana-2',
    },
    params: {
      grsaiNanoBanana2Channel: {
        name: sharedFieldText('apiChannel'),
        role: 'channel',
        optionLabels: {
          standard: { label: { zh: '标准', en: 'Standard' } },
          'cl-1k': { label: { zh: 'CL · 1K', en: 'CL · 1K' } },
          'cl-2k': { label: { zh: 'CL · 2K', en: 'CL · 2K' } },
          'cl-4k': { label: { zh: 'CL · 4K', en: 'CL · 4K' } },
        },
      },
      grsaiNanoBanana2AspectRatio: {
        name: sharedFieldText('aspectRatio'),
        optionLabels: { smart: { label: sharedOptionText('smart') }, ...ratioOptionLabels },
      },
      grsaiNanoBanana2Resolution: {
        name: sharedFieldText('resolution'),
        optionLabels: resolutionOptionLabels,
      },
    },
    linkages: [],
  },

  'grsai-nano-banana-pro': {
    meta: {
      name: { key: 'meta.name', fallback: 'Nano Banana Pro' },
      i18nScope: 'models.defs.grsai-nano-banana-pro',
    },
    params: {
      grsaiNanoBananaProChannel: {
        name: sharedFieldText('apiChannel'),
        role: 'channel',
        optionLabels: {
          standard: { label: { zh: '标准', en: 'Standard' } },
          vt: { label: { zh: 'VT（备用线路）', en: 'VT (Alt Route)' } },
          cl: { label: { zh: 'CL · 1K', en: 'CL · 1K' } },
          vip: { label: { zh: 'VIP', en: 'VIP' } },
          '4k-vip': { label: { zh: 'VIP · 4K', en: 'VIP · 4K' } },
        },
      },
      grsaiNanoBananaProAspectRatio: {
        name: sharedFieldText('aspectRatio'),
        optionLabels: { smart: { label: sharedOptionText('smart') }, ...ratioOptionLabels },
      },
      grsaiNanoBananaProResolution: {
        name: sharedFieldText('resolution'),
        optionLabels: resolutionOptionLabels,
      },
    },
    linkages: [
      {
        trigger: 'grsaiNanoBananaProChannel',
        effect: 'filterOptions',
        target: 'grsaiNanoBananaProResolution',
        filter: (channel, options) => channel === 'vip'
          ? options.filter((option) => option.value !== '4K')
          : options,
      },
      {
        trigger: 'grsaiNanoBananaProChannel',
        effect: 'autoSwitch',
        target: 'grsaiNanoBananaProResolution',
        condition: (channel, allParams) => channel === 'vip' && allParams.grsaiNanoBananaProResolution === '4K',
        value: '2K',
      },
    ],
  },
}
