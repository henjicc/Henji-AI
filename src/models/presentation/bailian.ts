/** 阿里云百炼（bailian）模型的展示补丁：i18n 文案、联动、面板布局。按模型 id 关联运行时定义。 */

import { sharedFieldText, sharedModeText, sharedOptionText } from '@/core/i18n/modelText'
import type { ModelPresentation } from '@/core/types/ModelPresentation'

export const bailianPresentation: Record<string, ModelPresentation> = {
  'bailian-qwen-image-3.0': {
    meta: {
      name: { key: 'meta.name', fallback: 'Qwen Image 3.0' },
      i18nScope: 'models.defs.bailian-qwen-image-3.0',
    },
    params: {
      bailianQwenImage30Variant: {
        name: sharedFieldText('variant'),
        role: 'mode',
        optionLabels: {
          standard: { label: { zh: '标准版', en: 'Standard' } },
          pro: { label: 'Pro' },
        },
      },
      bailianQwenImage30AspectRatio: {
        name: sharedFieldText('aspectRatio'),
        optionLabels: {
          smart: { label: sharedOptionText('smart') },
          '1:1': { label: '1:1' },
          '4:3': { label: '4:3' },
          '3:4': { label: '3:4' },
          '16:9': { label: '16:9' },
          '9:16': { label: '9:16' },
          '3:2': { label: '3:2' },
          '2:3': { label: '2:3' },
        },
      },
      bailianQwenImage30Resolution: {
        name: sharedFieldText('resolution'),
        optionLabels: {
          '1K': { label: '1K' },
          '2K': { label: '2K' },
        },
      },
      bailianQwenImage30Count: {
        name: { zh: '生成数量', en: 'Output Count' },
      },
    },
    linkages: [],
  },

  'bailian-wan-3.0': {
    meta: {
      name: { key: 'meta.name', fallback: 'Wan 3.0' },
      i18nScope: 'models.defs.bailian-wan-3.0',
    },
    params: {
      bailianWan30Variant: {
        name: { zh: '版本', en: 'Version' },
        role: 'mode',
        optionLabels: {
          standard: { label: sharedOptionText('standard') },
          prime: { label: 'Prime' },
        },
        tooltip: { zh: 'Prime 能力与标准版一致、生成更快，单价更高。', en: 'Prime matches Standard in capability and generates faster at a higher price.' },
      },
      bailianWan30Mode: {
        name: sharedFieldText('mode'),
        role: 'mode',
        optionLabels: {
          'text-image-to-video': { label: sharedModeText('textImageToVideo') },
          'reference-to-video': { label: sharedModeText('referenceToVideo') },
        },
        tooltip: { zh: '文/图生视频：1 张图为首帧，2 张为首尾帧。参考生视频可放最多 10 张图，提示词里用“图1”“图2”指代。', en: 'Text/Image to Video: 1 image is the first frame, 2 are first and last frames. Reference takes up to 10 images; refer to them as Image 1, Image 2 in the prompt.' },
      },
      bailianWan30AspectRatio: {
        name: sharedFieldText('aspectRatio'),
        optionLabels: {
          smart: { label: sharedOptionText('smart') },
          '16:9': { label: '16:9' },
          '4:3': { label: '4:3' },
          '1:1': { label: '1:1' },
          '3:4': { label: '3:4' },
          '9:16': { label: '9:16' },
          '21:9': { label: '21:9' },
        },
      },
      bailianWan30Resolution: {
        name: sharedFieldText('resolution'),
        optionLabels: {
          '480P': { label: '480P' },
          '720P': { label: '720P' },
          '1080P': { label: '1080P' },
        },
      },
      bailianWan30Duration: { name: sharedFieldText('duration') },
      bailianWan30Audio: { name: sharedFieldText('generateAudio') },
    },
    linkages: [],
  },

  'bailian-z-image-turbo': {
    meta: {
      name: { key: 'meta.name', fallback: 'Z-Image Turbo' },
      i18nScope: 'models.defs.bailian-z-image-turbo',
    },
    params: {
      bailianZImageTurboAspectRatio: {
        name: sharedFieldText('aspectRatio'),
        optionLabels: {
          smart: { label: sharedOptionText('smart') },
          '1:1': { label: '1:1' },
          '4:3': { label: '4:3' },
          '3:4': { label: '3:4' },
          '16:9': { label: '16:9' },
          '9:16': { label: '9:16' },
          '3:2': { label: '3:2' },
          '2:3': { label: '2:3' },
          '7:9': { label: '7:9' },
          '9:7': { label: '9:7' },
          '21:9': { label: '21:9' },
          '9:21': { label: '9:21' },
        },
      },
      bailianZImageTurboResolution: {
        name: sharedFieldText('resolution'),
        optionLabels: {
          '1K': { label: '1K' },
          '2K': { label: '2K' },
        },
      },
      bailianZImageTurboPromptExtend: {
        name: { zh: '提示词改写', en: 'Prompt Rewrite' },
      },
    },
    linkages: [],
  },
}
