/**
 * KIE Kling V2.6 视频生成模型
 */

import { defineModel, sharedFieldText, sharedModeText, sharedOptionText } from '@/core'
import { hasUploadedImage, resolveKieImageSources, resolveKiePrimaryVideoSource } from './mediaSources'

const KIE_CREATE_TASK_ENDPOINT = '/api/v1/jobs/createTask'

export const kieKlingV26Model = defineModel({
  meta: {
    id: 'kie-kling-v2-6',
    canonicalModelId: 'kling-video-2.6-pro',
    seriesId: 'kling-video',
    seriesRank: 2.6,
    provider: 'kie',
    type: 'video',
        i18nScope: 'models.defs.kie-kling-v2-6',
    name: { key: 'meta.name', fallback: 'Kling V2.6' },
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
      name: sharedFieldText('mode'),
      default: 'text-image-to-video',
      options: [
        { value: 'text-image-to-video', label: sharedModeText('textImageToVideo') },
        { value: 'motion-control', label: sharedModeText('motionControl') }
      ]
    },
    {
      id: 'kieKlingV26Duration',
      type: 'dropdown',
      order: 2,
      name: sharedFieldText('duration'),
      default: '5',
      visible: {
        condition: 'kieKlingV26Mode !== "motion-control"'
      },
      options: [
        { value: '5', label: '5s' },
        { value: '10', label: '10s' }
      ]
    },
    {
      id: 'kieKlingV26AspectRatio',
      type: 'dropdown',
      order: 3,
      name: sharedFieldText('aspectRatio'),
      default: '16:9',
      visible: {
        condition: (params: DynamicValueMap) =>
          params.kieKlingV26Mode !== 'motion-control' &&
          !hasUploadedImage(params)
      },
      options: [
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' },
        { value: '1:1', label: '1:1' },
        { value: 'smart', label: sharedOptionText('smart') }
      ]
    },
    {
      id: 'kieKlingV26Resolution',
      type: 'dropdown',
      order: 4,
      name: sharedFieldText('resolution'),
      default: '720p',
      visible: {
        condition: 'kieKlingV26Mode === "motion-control"'
      },
      options: [
        { value: '720p', label: '720p' },
        { value: '1080p', label: '1080p' }
      ]
    },
    {
      id: 'kieKlingV26EnableAudio',
      type: 'switch',
      order: 5,
      name: sharedFieldText('generateAudio'),
      default: true,
      visible: {
        condition: 'kieKlingV26Mode !== "motion-control"'
      }
    },
    {
      id: 'kieKlingV26CharacterOrientation',
      type: 'dropdown',
      order: 6,
      name: sharedFieldText('characterOrientation'),
      default: 'video',
      visible: {
        condition: 'kieKlingV26Mode === "motion-control"'
      },
      options: [
        { value: 'video', label: sharedOptionText('consistentWithVideo') },
        { value: 'image', label: sharedOptionText('consistentWithImage') }
      ]
    }
  ],
  linkages: [],
  endpoints: KIE_CREATE_TASK_ENDPOINT,
  request: {
    builder: (params) => {
      const images = resolveKieImageSources(params)
      const prompt = params.prompt || ''
      const mode = params.kieKlingV26Mode || params.mode || 'text-image-to-video'
      const duration = params.kieKlingV26Duration || params.duration || '5'
      const aspectRatio = params.kieKlingV26AspectRatio || params.aspect_ratio || '16:9'
      const resolution = params.kieKlingV26Resolution || params.resolution || '720p'
      const enableAudio = params.kieKlingV26EnableAudio ?? params.enable_audio ?? true
      const characterOrientation = params.kieKlingV26CharacterOrientation || params.character_orientation || 'video'
      const videoUrl = resolveKiePrimaryVideoSource(params)

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

      const input: DynamicValueMap = {
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
    currency: '$',
    calculator: (params) => {
      const mode = params.kieKlingV26Mode || 'text-image-to-video'
      if (mode === 'motion-control') {
        const resolution = params.kieKlingV26Resolution === '1080p' ? '1080p' : '720p'
        const duration = 5
        return (resolution === '1080p' ? 0.09 : 0.055) * duration
      }
      const duration = params.kieKlingV26Duration === '10' ? 10 : 5
      const enableAudio = params.kieKlingV26EnableAudio !== false
      if (duration === 10) return enableAudio ? 1.1 : 0.55
      return enableAudio ? 0.55 : 0.28
    },
    description: '文/图生视频：5s 无音频 $0.28、10s $0.55；有音频 5s $0.55、10s $1.10；动作控制：720p $0.055/秒，1080p $0.09/秒'
  }
})

export default kieKlingV26Model
