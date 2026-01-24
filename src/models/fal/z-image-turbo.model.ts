/**
 * Z-Image Turbo 图片生成模型
 */

import { defineModel } from '@/core'
import { parseImageSize } from './utils'

export const zImageTurboModel = defineModel({
  meta: {
    id: 'fal-ai-z-image-turbo',
    provider: 'fal',
    type: 'image',
    name: 'Z-Image Turbo',
    description: 'Z-Image Turbo 快速图片生成模型',
    tags: ['image', 'text-to-image', 'image-to-image', 'fast']
  },
  inputLimits: {
    images: { max: 0 },
    videos: { max: 0 }
  },
  params: [
    // 1. 图片尺寸
    {
      id: 'falZImageTurboImageSize',
      order: 1,
      type: 'text',
      name: { zh: '图片尺寸', en: 'Image Size' },
      default: 'landscape_4_3'
    },
    // 2. 生成数量
    {
      id: 'falZImageTurboNumImages',
      order: 2,
      type: 'number',
      name: { zh: '生成数量', en: 'Number of Images' },
      default: 1,
      min: 1,
      max: 4
    },
    // 3. 推理步数
    {
      id: 'falZImageTurboNumInferenceSteps',
      order: 3,
      type: 'number',
      name: { zh: '推理步数', en: 'Inference Steps' },
      default: 8,
      min: 1,
      max: 50
    },
    // 4. 提示词扩展
    {
      id: 'falZImageTurboEnablePromptExpansion',
      order: 4,
      type: 'switch',
      name: { zh: '提示词扩展', en: 'Prompt Expansion' },
      default: false
    },
    // 5. 加速模式
    {
      id: 'falZImageTurboAcceleration',
      order: 5,
      type: 'dropdown',
      name: { zh: '加速模式', en: 'Acceleration' },
      default: 'none',
      options: [
        { value: 'none', label: '无' },
        { value: 'fast', label: '快速' }
      ]
    }
  ],
  linkages: [
  ],
  endpoints: {
    selector: async () => 'fal-ai/z-image/turbo'
  },
  request: {
    builder: (params) => {
      const images = params.images || []
      const prompt = params.prompt || ''
      const imageSize = parseImageSize(params.falZImageTurboImageSize)

      const requestData: any = {
        prompt,
        image_size: imageSize,
        num_inference_steps: params.falZImageTurboNumInferenceSteps || 8,
        num_images: params.falZImageTurboNumImages || 1,
        enable_safety_checker: false,
        output_format: 'png',
        enable_prompt_expansion: params.falZImageTurboEnablePromptExpansion || false,
        acceleration: params.falZImageTurboAcceleration || 'none'
      }

      if (images.length > 0) {
        requestData.image_urls = images
      }

      return requestData
    }
  },
  pricing: {
    currency: '$',
    calculator: () => 0.01,
    description: '基础价格 $0.01/张'
  }
})

export default zImageTurboModel;
