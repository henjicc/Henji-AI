/**
 * KIE Kling V2.6 视频生成模型
 */

import { defineModel } from '@/core'

const KIE_CREATE_TASK_ENDPOINT = '/api/v1/jobs/createTask'

export const kieKlingV26Model = defineModel({
  meta: {
    id: 'kie-kling-v2-6',
    provider: 'kie',
    type: 'video',
    name: { zh: 'Kling V2.6', en: 'Kling V2.6' },
    description: {
      zh: 'KIE Kling V2.6 视频生成模型，支持文/图生视频与动作控制',
      en: 'KIE Kling V2.6 video model with text/image and motion-control modes'
    },
    tags: ['text-to-video', 'image-to-video', 'motion-control', 'provider-kie'],
    aliases: ['kling-v2-6-kie'],
    polling: {
      interval: 3000,
      maxAttempts: 180,
      expectedAttempts: 60
    }
  },
  inputLimits: {
    images: { max: 1 },
    videos: { max: 0 },
    rules: [
      {
        when: 'kieKlingV26Mode === "motion-control"',
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
      id: 'kling-v26-motion-image',
      when: 'kieKlingV26Mode === "motion-control"',
      require: { images: { exact: 1 } },
      message: {
        title: '图片必需',
        message: '动作控制模式需要上传1张图片（不能多也不能少）',
        type: 'warning'
      }
    },
    {
      id: 'kling-v26-motion-video',
      when: 'kieKlingV26Mode === "motion-control"',
      require: { videos: { exact: 1 } },
      message: {
        title: '视频必需',
        message: '动作控制模式需要上传1个视频（不能多也不能少）',
        type: 'warning'
      }
    }
  ],
  params: [
    {
      id: 'kieKlingV26Mode',
      type: 'dropdown',
      order: 1,
      name: { zh: '模式', en: 'Mode' },
      default: 'text-image-to-video',
      options: [
        { value: 'text-image-to-video', label: { zh: '文/图生视频', en: 'Text/Image to Video' } },
        { value: 'motion-control', label: { zh: '动作控制', en: 'Motion Control' } }
      ]
    },
    {
      id: 'kieKlingV26Duration',
      type: 'dropdown',
      order: 2,
      name: { zh: '时长', en: 'Duration' },
      default: '5',
      options: [
        { value: '5', label: '5s' },
        { value: '10', label: '10s' }
      ]
    },
    {
      id: 'kieKlingV26AspectRatio',
      type: 'dropdown',
      order: 3,
      name: { zh: '宽高比', en: 'Aspect Ratio' },
      default: '16:9',
      options: [
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' },
        { value: '1:1', label: '1:1' },
        { value: 'smart', label: { zh: '智能', en: 'Smart' } }
      ]
    },
    {
      id: 'kieKlingV26Resolution',
      type: 'dropdown',
      order: 4,
      name: { zh: '分辨率', en: 'Resolution' },
      default: '720p',
      options: [
        { value: '720p', label: '720p' },
        { value: '1080p', label: '1080p' }
      ]
    },
    {
      id: 'kieKlingV26EnableAudio',
      type: 'switch',
      order: 5,
      name: { zh: '生成音频', en: 'Generate Audio' },
      default: false
    },
    {
      id: 'kieKlingV26CharacterOrientation',
      type: 'dropdown',
      order: 6,
      name: { zh: '角色朝向', en: 'Character Orientation' },
      default: 'video',
      options: [
        { value: 'video', label: { zh: '与视频一致', en: 'Consistent with Video' } },
        { value: 'image', label: { zh: '与图片一致', en: 'Consistent with Image' } }
      ]
    }
  ],
  linkages: [],
  endpoints: KIE_CREATE_TASK_ENDPOINT,
  request: {
    builder: (params) => {
      const images = params.images || []
      const prompt = params.prompt || ''
      const mode = params.kieKlingV26Mode || params.mode || 'text-image-to-video'
      const duration = params.kieKlingV26Duration || params.duration || '5'
      const aspectRatio = params.kieKlingV26AspectRatio || params.aspect_ratio || '16:9'
      const resolution = params.kieKlingV26Resolution || params.resolution || '720p'
      const enableAudio = params.kieKlingV26EnableAudio ?? params.enable_audio ?? false
      const characterOrientation = params.kieKlingV26CharacterOrientation || params.character_orientation || 'video'
      const videoUrl = params.video

      if (mode === 'motion-control') {
        if (images.length === 0) {
          throw new Error('动作控制模式需要上传一张参考图片')
        }
        if (!videoUrl) {
          throw new Error('动作控制模式需要上传一个参考视频')
        }

        return {
          model: 'kling-2.6/motion-control',
          input: {
            prompt,
            input_urls: images,
            video_urls: [videoUrl],
            character_orientation: characterOrientation,
            mode: resolution
          }
        }
      }

      const hasImages = images.length > 0
      const model = hasImages
        ? 'kling-2.6/image-to-video'
        : 'kling-2.6/text-to-video'

      const input: Record<string, unknown> = {
        prompt,
        duration: String(duration),
        sound: enableAudio
      }

      if (!hasImages && aspectRatio && aspectRatio !== 'smart' && aspectRatio !== 'auto') {
        input.aspect_ratio = aspectRatio
      }

      if (hasImages) {
        input.image_urls = images
      }

      return {
        model,
        input
      }
    }
  },
  pricing: {
    currency: '¥',
    calculator: () => 0.12,
    description: '基础价格 ¥0.12/次'
  }
})

export default kieKlingV26Model
