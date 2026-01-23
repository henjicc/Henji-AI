/**
 * PixVerse V4.5 视频生成模型
 *
 * PixVerse V4.5 视频生成模型，支持文生视频和图生视频
 */

import { defineModel } from '@/core'
import { normalizePixverseResolution } from './utils'

export const pixverseV45Model = defineModel({
  meta: {
    id: 'pixverse-v4.5',
    provider: 'ppio',
    type: 'video',
    name: 'PixVerse V4.5',
    description: 'PixVerse V4.5 视频生成模型，支持文生视频和图生视频',
    tags: ['video', 'text-to-video', 'image-to-video']
  },
  params: [
    // 1. 宽高比（文生视频）
    {
      id: 'ppioPixverse45VideoAspectRatio',
      type: 'dropdown',
      order: 1,
      name: { zh: '宽高比', en: 'Aspect Ratio' },
      default: '16:9',
      options: [
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' },
        { value: '1:1', label: '1:1' }
      ],
      apiField: 'aspect_ratio'
    },
    // 2. 分辨率
    {
      id: 'ppioPixverse45VideoResolution',
      type: 'dropdown',
      order: 2,
      name: { zh: '分辨率', en: 'Resolution' },
      default: '540p',
      options: [
        { value: '360p', label: '360P' },
        { value: '540p', label: '540P' },
        { value: '720p', label: '720P' },
        { value: '1080p', label: '1080P' }
      ],
      apiField: 'resolution'
    },
    // 3. 快速模式
    {
      id: 'ppioPixverse45FastMode',
      type: 'switch',
      order: 3,
      name: { zh: '快速模式', en: 'Fast Mode' },
      default: false,
      apiField: 'fast_mode'
    },
    // 4. 负面提示词
    {
      id: 'ppioPixverse45NegativePrompt',
      type: 'textarea',
      order: 4,
      name: { zh: '负面提示词', en: 'Negative Prompt' },
      default: '',
      apiField: 'negative_prompt'
    }
  ],
  linkages: [
    // Hide aspect ratio when image is uploaded
    {
      trigger: 'uploadedImages',
      effect: 'hide',
      targets: ['ppioPixverse45VideoAspectRatio'],
      condition: (images) => (images?.length || 0) > 0
    },
    // Disable 1080p when fast mode is enabled
    {
      trigger: 'ppioPixverse45FastMode',
      effect: 'filterOptions',
      target: 'ppioPixverse45VideoResolution',
      filter: (fastMode, options) => {
        if (fastMode) {
          return options.filter(opt => opt.value !== '1080p')
        }
        return options
      }
    },
    // Auto-switch resolution if 1080p is selected and fast mode is enabled
    {
      trigger: 'ppioPixverse45FastMode',
      effect: 'autoSwitch',
      target: 'ppioPixverse45VideoResolution',
      condition: (fastMode, allParams) => {
        const resolution = allParams.ppioPixverse45VideoResolution
        return fastMode && resolution === '1080p'
      },
      value: '720p'
    }
  ],
  endpoints: {
    selector: async (params) => {
      const images = params.images || []
      return images.length > 0 ? '/async/pixverse-v4.5-i2v' : '/async/pixverse-v4.5-t2v'
    }
  },
  request: {
    builder: (params) => {
      const images = params.images || []
      const resolution = normalizePixverseResolution(params.resolution)
      const aspectRatio = params.aspect_ratio || '16:9'
      const fastMode = params.fast_mode || false
      const prompt = params.prompt || ''
      const negativePrompt = params.negative_prompt || ''

      // Fast mode doesn't support 1080p
      const finalResolution = fastMode && resolution === '1080p' ? '720p' : resolution

      if (images.length > 0) {
        // Image-to-video
        const img0 = images[0]
        const base64 = typeof img0 === 'string' && img0.startsWith('data:') ? img0.split(',')[1] : img0

        return {
          prompt,
          image: base64,
          resolution: finalResolution,
          negative_prompt: negativePrompt,
          fast_mode: fastMode
        }
      } else {
        // Text-to-video
        return {
          prompt,
          aspect_ratio: aspectRatio,
          resolution: finalResolution,
          negative_prompt: negativePrompt,
          fast_mode: fastMode
        }
      }
    }
  },
  pricing: {
    currency: '¥',
    calculator: (params) => {
      const resolution = params.ppioPixverse45VideoResolution || '540p'
      const fastMode = params.ppioPixverse45FastMode || false

      // Base prices by resolution
      const resolutionPrices: Record<string, number> = {
        '360p': 0.2,
        '540p': 0.3,
        '720p': 0.4,
        '1080p': 0.6
      }

      const basePrice = resolutionPrices[resolution] || 0.3

      // Fast mode discount (50% off)
      return fastMode ? basePrice * 0.5 : basePrice
    },
    description: '基础价格 ¥0.3/次（540P），快速模式半价'
  }
})

export default pixverseV45Model;
