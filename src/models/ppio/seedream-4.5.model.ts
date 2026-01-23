/**
 * Seedream 4.5 模型定义
 *
 * 派欧云即梦图片 4.5 - 支持文生图和图生图
 */

import { defineModel } from '@/core'

export const seedream45Model = defineModel({
  meta: {
    id: 'seedream-4.5',
    provider: 'ppio',
    type: 'image',
    name: { zh: '即梦图片 4.5', en: 'Seedream 4.5' },
    description: {
      zh: '派欧云即梦图片生成模型 4.5 版本，支持 2K/4K 分辨率',
      en: 'PPIO Seedream image generation model v4.5, supports 2K/4K resolution'
    },
    tags: ['text-to-image', 'image-to-image', 'supports-4k', 'provider-ppio'],
    polling: {
      interval: 3000,
      maxAttempts: 120,
      expectedAttempts: 20
    }
  },

  params: [
    // 1. Resolution parameter (dropdown with smart match)
    {
      id: 'selectedResolution',
      type: 'dropdown',
      order: 1,
      name: { zh: '分辨率', en: 'Resolution' },
      default: 'smart',
      options: [
        { value: 'smart', label: { zh: '智能', en: 'Smart' } },
        { value: '21:9', label: '21:9' },
        { value: '16:9', label: '16:9' },
        { value: '3:2', label: '3:2' },
        { value: '4:3', label: '4:3' },
        { value: '1:1', label: '1:1' },
        { value: '3:4', label: '3:4' },
        { value: '2:3', label: '2:3' },
        { value: '9:16', label: '9:16' }
      ]
    },

    // 2. Max images parameter (number input)
    {
      id: 'ppioSeedream45MaxImages',
      type: 'number',
      order: 2,
      name: { zh: '数量', en: 'Quantity' },
      tooltip: {
        zh: '设置为1时仅生成单张图片；大于1时，会根据该数值生成多张图片。参考图+生成图片的总数不能超过15张。',
        en: 'Set to 1 to generate a single image; greater than 1 will generate multiple images. Total reference + generated images cannot exceed 15.'
      },
      default: 1,
      min: 1,
      max: 15,
      step: 1
    },

    // 3. Optimize prompt parameter (switch)
    {
      id: 'ppioSeedream45OptimizePrompt',
      type: 'switch',
      order: 3,
      name: { zh: '提示词优化', en: 'Prompt Optimization' },
      tooltip: {
        zh: '开启后模型会自动优化提示词以获得更好的生成效果。当前仅支持标准模式。',
        en: 'When enabled, the model will automatically optimize prompts for better generation results. Currently only supports standard mode.'
      },
      default: false
    }
  ],

  linkages: [
    // FilterOptions: Add "smart" option when images are uploaded
    {
      trigger: 'uploadedImages',
      effect: 'filterOptions',
      target: 'selectedResolution',
      filter: (_images: string[], options: any[]) => {
        // Always show smart option (it's already in the base options)
        return options
      }
    }
  ],

  endpoints: {
    selector: (params) => {
      return params.model === 'seedream-4.5' ? '/seedream-4.5' : '/seedream-4.0'
    }
  },

  request: {
    builder: (params) => {
      const requestData: any = {
        prompt: params.prompt,
        watermark: false
      }

      // Handle resolution/size
      if (params.size) {
        requestData.size = params.size
      }

      // Handle image upload (use 'image' field for 4.5)
      if (params.images && params.images.length > 0) {
        requestData.image = params.images
      }

      // Handle sequential image generation
      if (params.sequential_image_generation !== undefined) {
        requestData.sequential_image_generation = params.sequential_image_generation

        // max_images nested in sequential_image_generation_options
        if (params.max_images !== undefined && params.sequential_image_generation === 'auto') {
          requestData.sequential_image_generation_options = {
            max_images: params.max_images
          }

          // Workaround: Seedream 4.5 needs explicit count in prompt for multi-image generation
          if (params.max_images > 1) {
            requestData.prompt = `Generate ${params.max_images} images. ${requestData.prompt}`
          }
        }
      }

      // Handle prompt optimization
      if (params.optimize_prompt === true) {
        requestData.optimize_prompt_options = {
          mode: 'standard'
        }
      }

      return requestData
    }
  },

  pricing: {
    currency: '¥',
    calculator: (params) => {
      const basePrice = 0.15
      const maxImages = params.ppioSeedream45MaxImages || 1
      const quality = params.selectedResolution || '2K'

      // 4K resolution doubles the price
      const qualityMultiplier = quality === '4K' ? 2 : 1

      return basePrice * maxImages * qualityMultiplier
    },
    description: '基础价格 ¥0.15/张，4K分辨率翻倍'
  }
})

export default seedream45Model;
