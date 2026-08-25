/**
 * ModelScope SD XL 模型
 */

import { defineModel, sharedFieldText } from '@/core'
import { buildModelscopeRequest, MODELSCOPE_ASPECT_RATIO_OPTIONS, MODELSCOPE_CREATE_TASK_ENDPOINT } from './utils'

export const modelscopeSdxl14Model = defineModel({
  meta: {
    id: 'MusePublic/14_ckpt_SD_XL',
    canonicalModelId: 'sdxl-14-checkpoint',
    provider: 'modelscope',
    type: 'image',
        i18nScope: 'models.defs.MusePublic/14_ckpt_SD_XL',
    name: { key: 'meta.name', fallback: 'SD XL 1.4' },
    tags: ['text-to-image', 'provider-modelscope'],
    polling: {
      interval: 3000,
      maxAttempts: 120,
      expectedAttempts: 40
    }
  },
  inputLimits: {
    images: { max: 0 },
    videos: { max: 0 }
  },
  params: [
    {
      id: 'modelscopeImageSize',
      type: 'dropdown',
      order: 1,
      name: sharedFieldText('aspectRatio'),
      default: '1:1',
      options: MODELSCOPE_ASPECT_RATIO_OPTIONS
    },
    {
      id: 'resolutionBaseSize',
      type: 'number',
      order: 2,
      name: sharedFieldText('baseSize'),
      default: 1024,
      min: 64,
      max: 2048,
      step: 8
    },
    {
      id: 'modelscopeSteps',
      type: 'number',
      order: 3,
      name: sharedFieldText('steps'),
      default: 30,
      min: 1,
      max: 100,
      step: 1
    },
    {
      id: 'modelscopeGuidance',
      type: 'number',
      order: 4,
      name: sharedFieldText('guidance'),
      default: 7.5,
      min: 1.5,
      max: 20,
      step: 0.5
    },
    {
      id: 'modelscopeNegativePrompt',
      type: 'text',
      order: 5,
      name: sharedFieldText('negativePrompt'),
      default: '',
      multiline: true,
      editor: { kind: 'prompt', preset: 'plain' }
    }
  ],
  linkages: [],
  endpoints: MODELSCOPE_CREATE_TASK_ENDPOINT,
  request: {
    builder: (params) => buildModelscopeRequest(params, {
      modelId: 'MusePublic/14_ckpt_SD_XL',
      allowGuidance: true,
      allowNegativePrompt: true,
      allowImage: false,
      baseSize: 1024,
      sizeBounds: { min: 64, max: 2048 }
    })
  },
  pricing: {
    currency: '魔粒',
    calculator: () => 1,
    // 魔搭 API-Inference 不收钱，扣的是魔粒积分（standard 档 1 魔粒/次）。
    // 日常免费额度约 250 魔粒/天（登录 200 + 绑定阿里云 50），过期不累积。
    description: '1 魔粒/次（standard 档），魔搭免费额度约 250 魔粒/天'
  }
})

export default modelscopeSdxl14Model
