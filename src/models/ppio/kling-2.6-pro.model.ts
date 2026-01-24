/**
 * Kling 2.6 Pro 模型定义
 *
 * 派欧云可灵视频 2.6 Pro - 支持文/图生视频、动作控制
 */

import { defineModel } from '@/core'

export const kling26ProModel = defineModel({
  meta: {
    id: 'kling-2.6-pro',
    provider: 'ppio',
    type: 'video',
    name: { zh: '可灵视频 2.6 Pro', en: 'Kling 2.6 Pro' },
    description: {
      zh: '派欧云可灵视频生成模型 2.6 Pro 版本，支持文/图生视频和动作控制两种模式',
      en: 'PPIO Kling video generation model v2.6 Pro, supports text/image-to-video and motion-control modes'
    },
    tags: ['text-to-video', 'image-to-video', 'motion-control'],
    polling: {
      interval: 3000,
      maxAttempts: 120,
      expectedAttempts: 50
    }
  },
  inputLimits: {
    images: { max: 1 },
    videos: { max: 0 },
    rules: [
      {
        when: 'ppioKling26Mode === "motion-control"',
        images: { exact: 1 },
        videos: { exact: 1 },
        videoConstraints: {
          maxSizeMB: 100,
          minDurationSec: 3,
          maxDurationSec: 30
        }
      }
    ]
  },
  requirements: [
    {
      id: 'kling-26-motion-image',
      when: 'ppioKling26Mode === "motion-control"',
      require: { images: { exact: 1 } },
      message: {
        title: '图片必需',
        message: '动作控制模式需要上传1张图片（不能多也不能少）',
        type: 'warning'
      }
    },
    {
      id: 'kling-26-motion-video',
      when: 'ppioKling26Mode === "motion-control"',
      require: { videos: { exact: 1 } },
      message: {
        title: '视频必需',
        message: '动作控制模式需要上传1个视频（不能多也不能少）',
        type: 'warning'
      }
    }
  ],

  params: [
    // 1. Mode selection
    {
      id: 'ppioKling26Mode',
      type: 'dropdown',
      order: 1,
      name: { zh: '模式', en: 'Mode' },
      default: 'text-image-to-video',
      options: [
        { value: 'text-image-to-video', label: { zh: '文/图生视频', en: 'Text/Image to Video' } },
        { value: 'motion-control', label: { zh: '动作控制', en: 'Motion Control' } }
      ],
      apiField: 'mode'
    },

    // 2. Duration parameter
    {
      id: 'ppioKling26VideoDuration',
      type: 'dropdown',
      order: 2,
      name: { zh: '时长', en: 'Duration' },
      default: 5,
      options: [
        { value: 5, label: '5s' },
        { value: 10, label: '10s' }
      ],
      apiField: 'duration'
    },

    // 3. Aspect ratio parameter
    {
      id: 'ppioKling26AspectRatio',
      type: 'dropdown',
      order: 3,
      name: { zh: '宽高比', en: 'Aspect Ratio' },
      default: '16:9',
      options: [
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' },
        { value: '1:1', label: '1:1' }
      ],
      apiField: 'aspect_ratio'
    },

    // 4. CFG Scale parameter
    {
      id: 'ppioKling26CfgScale',
      type: 'number',
      order: 4,
      name: { zh: 'CFG Scale', en: 'CFG Scale' },
      default: 0.5,
      min: 0,
      max: 1,
      step: 0.01,
      apiField: 'cfg_scale'
    },

    // 5. Sound parameter
    {
      id: 'ppioKling26Sound',
      type: 'switch',
      order: 5,
      name: { zh: '生成音频', en: 'Generate Audio' },
      default: true,
      apiField: 'sound'
    },

    // 6. Character orientation parameter (motion-control mode only)
    {
      id: 'ppioKling26CharacterOrientation',
      type: 'dropdown',
      order: 6,
      name: { zh: '人物朝向', en: 'Character Orientation' },
      tooltip: {
        zh: '默认为人物朝向与视频一致，此时角色动作/表情/运镜/朝向都会按照动作视频生成。可以通过提示词控制其他信息。最长支持30s生成时长。\n\n选择人物朝向与图片一致，此时角色动作/表情都会按照动作视频生成，朝向与图片中人物朝向一致，运镜及其他信息可以通过提示词自定义。最长支持5s生成时长。',
        en: 'Default is character orientation consistent with video. You can control other information through prompts. Maximum 30s generation duration.\n\nIf you choose character orientation consistent with image, the character actions/expressions will be generated according to the motion video, and the orientation will be consistent with the character orientation in the image. Maximum 5s generation duration.'
      },
      default: 'video',
      options: [
        { value: 'video', label: { zh: '与视频一致', en: 'Consistent with Video' } },
        { value: 'image', label: { zh: '与图片一致', en: 'Consistent with Image' } }
      ],
      apiField: 'character_orientation'
    },

    // 7. Keep original sound parameter (motion-control mode only)
    {
      id: 'ppioKling26KeepOriginalSound',
      type: 'switch',
      order: 7,
      name: { zh: '保留音频', en: 'Keep Original Sound' },
      default: true,
      apiField: 'keep_original_sound'
    }
  ],
  linkages: [
    // Hide text/image-to-video params in motion-control mode
    {
      trigger: 'ppioKling26Mode',
      effect: 'hide',
      targets: ['ppioKling26VideoDuration', 'ppioKling26AspectRatio', 'ppioKling26CfgScale', 'ppioKling26Sound'],
      condition: (mode: string) => mode === 'motion-control'
    },

    // Hide motion-control params in text/image-to-video mode
    {
      trigger: 'ppioKling26Mode',
      effect: 'hide',
      targets: ['ppioKling26CharacterOrientation', 'ppioKling26KeepOriginalSound'],
      condition: (mode: string) => mode !== 'motion-control'
    }
  ],
  endpoints: {
    selector: (params: Record<string, any>) => {
      // 使用原始参数 ID（ppioKling26Mode），不是 API 字段名（mode）
      const mode = params.ppioKling26Mode || 'text-image-to-video'
      const images = params.images || []

      if (mode === 'motion-control') {
        return 'motion-control'
      } else if (images.length > 0) {
        return 'image-to-video'
      } else {
        return 'text-to-video'
      }
    },
    routes: {
      'text-to-video': { path: '/async/kling-v2.6-pro-t2v', method: 'POST' },
      'image-to-video': { path: '/async/kling-v2.6-pro-i2v', method: 'POST' },
      'motion-control': { path: '/async/kling-v2.6-pro-motion-control', method: 'POST' }
    }
  },
  request: {
    builder: (params) => {
      const mode = (params.ppioKling26Mode || params.mode || 'text-image-to-video') as string
      const images = (params.images || []) as string[]
      const videos = (params.videos || []) as string[]
      const video = params.video || videos[0]
      const prompt = ((params.prompt || '') as string).slice(0, 2500)

      if (mode === 'motion-control') {
        return {
          prompt,
          image: images[0],
          video,
          character_orientation: params.ppioKling26CharacterOrientation || params.character_orientation || 'video',
          keep_original_sound: params.ppioKling26KeepOriginalSound !== undefined
            ? params.ppioKling26KeepOriginalSound
            : (params.keep_original_sound !== undefined ? params.keep_original_sound : true)
        }
      }

      const requestData: Record<string, any> = {
        prompt,
        duration: params.ppioKling26VideoDuration || params.duration || 5,
        sound: params.ppioKling26Sound !== undefined ? params.ppioKling26Sound : (params.sound || false),
        aspect_ratio: params.ppioKling26AspectRatio || params.aspect_ratio || '16:9'
      }

      const cfgScale = params.ppioKling26CfgScale ?? params.cfg_scale
      if (cfgScale !== undefined) {
        requestData.cfg_scale = cfgScale
      }

      if (images.length > 0) {
        requestData.image = images[0]
      }

      return requestData
    }
  },
  pricing: {
    currency: '¥',
    calculator: (params) => {
      const mode = params.ppioKling26Mode || 'text-image-to-video'
      const duration = params.ppioKling26VideoDuration || 5

      if (mode === 'motion-control') {
        return 1.5
      }

      const basePrice = 0.8
      const durationMultiplier = duration / 5
      return basePrice * durationMultiplier
    },
    description: '基础价格 ¥0.8/5秒，动作控制模式 ¥1.5'
  }
})

export default kling26ProModel;
