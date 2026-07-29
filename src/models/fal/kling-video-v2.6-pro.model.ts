/**
 * Kling Video V2.6 Pro 视频生成模型
 */

import { defineModel, sharedFieldText, sharedModeText, sharedOptionText } from '@/core'
import { hasUploadedImage } from '@/models/shared/mediaPresence'

export const klingVideoV26ProModel = defineModel({
  meta: {
    id: 'fal-ai-kling-video-v2.6-pro',
    canonicalModelId: 'kling-video-2.6-pro',
    seriesId: 'kling-video',
    seriesRank: 2.6,
    provider: 'fal',
    type: 'video',
        i18nScope: 'models.defs.fal-ai-kling-video-v2.6-pro',
    name: { key: 'meta.name', fallback: 'Kling Video V2.6 Pro' },
    tags: ['video', 'text-to-video', 'image-to-video']
  },
  inputLimits: {
    images: { max: 1 },
    videos: { max: 0 },
    rules: [
      {
        when: 'falKlingV26ProMode === "motion-control"',
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
      when: 'falKlingV26ProMode === "motion-control"',
      require: { images: { exact: 1 } },
      message: {
        title: '图片必需',
        message: '动作控制模式需要上传1张图片（不能多也不能少）',
        type: 'warning'
      }
    },
    {
      id: 'kling-v26-motion-video',
      when: 'falKlingV26ProMode === "motion-control"',
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
      id: 'falKlingV26ProMode',
      order: 1,
      type: 'dropdown',
      name: sharedFieldText('mode'),
      default: 'text-image-to-video',
      options: [
        { value: 'text-image-to-video', label: sharedModeText('textImageToVideo') },
        { value: 'motion-control', label: sharedModeText('motionControl') }
      ]
    },
    {
      id: 'falKlingV26ProResolution',
      order: 2,
      type: 'dropdown',
      name: sharedFieldText('resolution'),
      default: '720p',
      visible: {
        condition: 'falKlingV26ProMode === "motion-control"'
      },
      options: [
        { value: '720p', label: '720p' },
        { value: '1080p', label: '1080p' }
      ]
    },
    {
      id: 'falKlingV26ProCharacterOrientation',
      order: 3,
      type: 'dropdown',
      name: sharedFieldText('characterOrientation'),
      default: 'video',
      visible: {
        condition: 'falKlingV26ProMode === "motion-control"'
      },
      options: [
        { value: 'video', label: sharedOptionText('matchVideo') },
        { value: 'image', label: sharedOptionText('matchImage') }
      ]
    },
    {
      id: 'falKlingV26ProKeepOriginalSound',
      order: 4,
      type: 'switch',
      name: sharedFieldText('keepOriginalSound'),
      default: true,
      visible: {
        condition: 'falKlingV26ProMode === "motion-control"'
      }
    },
    {
      id: 'falKlingV26ProVideoDuration',
      order: 5,
      type: 'dropdown',
      name: sharedFieldText('duration'),
      default: 5,
      visible: {
        condition: 'falKlingV26ProMode !== "motion-control"'
      },
      options: [
        { value: 5, label: '5s' },
        { value: 10, label: '10s' }
      ]
    },
    {
      id: 'falKlingV26ProAspectRatio',
      order: 6,
      type: 'dropdown',
      name: sharedFieldText('aspectRatio'),
      default: '16:9',
      visible: {
        condition: (params: DynamicValueMap) =>
          params.falKlingV26ProMode !== 'motion-control' &&
          !hasUploadedImage(params)
      },
      options: [
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' },
        { value: '1:1', label: '1:1' }
      ]
    },
    {
      id: 'falKlingV26ProCfgScale',
      order: 7,
      type: 'number',
      name: sharedFieldText('cfgScale'),
      default: 0.5,
      min: 0,
      max: 1,
      step: 0.1,
      visible: {
        condition: (params: DynamicValueMap) =>
          params.falKlingV26ProMode !== 'motion-control' &&
          !hasUploadedImage(params)
      }
    },
    {
      id: 'falKlingV26ProGenerateAudio',
      order: 8,
      type: 'switch',
      name: sharedFieldText('generateAudio'),
      default: true,
      visible: {
        condition: 'falKlingV26ProMode !== "motion-control"'
      }
    }
  ],
  linkages: [],
  endpoints: {
    selector: async (params) => {
      const mode = params.falKlingV26ProMode || 'text-image-to-video'
      if (mode === 'motion-control') {
        const resolution = params.falKlingV26ProResolution || '720p'
        return resolution === '1080p'
          ? 'fal-ai/kling-video/v2.6/pro/motion-control'
          : 'fal-ai/kling-video/v2.6/standard/motion-control'
      }

      const images = params.images || []
      return images.length > 0
        ? 'fal-ai/kling-video/v2.6/pro/image-to-video'
        : 'fal-ai/kling-video/v2.6/pro/text-to-video'
    }
  },
  request: {
    builder: (params) => {
      const mode = params.falKlingV26ProMode || 'text-image-to-video'
      const images = params.images || []
      const prompt = params.prompt || ''
      const duration = params.falKlingV26ProVideoDuration || 5
      const aspectRatio = params.falKlingV26ProAspectRatio || '16:9'
      const generateAudio = params.falKlingV26ProGenerateAudio !== false
      const cfgScale = params.falKlingV26ProCfgScale
      const characterOrientation = params.falKlingV26ProCharacterOrientation || 'video'
      const keepOriginalSound = params.falKlingV26ProKeepOriginalSound !== false
      const videoInput = params.video || (Array.isArray(params.videos) ? params.videos.find((v: DynamicValue) => typeof v === 'string' && v.startsWith('http')) : undefined)

      if (mode === 'motion-control') {
        const requestData: DynamicValue = {
          image_url: images[0],
          video_url: videoInput,
          character_orientation: characterOrientation,
          keep_original_sound: keepOriginalSound
        }

        if (prompt) {
          requestData.prompt = prompt
        }

        return requestData
      }

      const requestData: DynamicValue = {
        prompt,
        duration: `${duration}`,
        generate_audio: generateAudio
      }

      if (images.length > 0) {
        requestData.image_url = images[0]
      } else {
        if (aspectRatio && aspectRatio !== 'auto') {
          requestData.aspect_ratio = aspectRatio
        }
        if (cfgScale !== undefined) {
          requestData.cfg_scale = cfgScale
        }
      }

      return requestData
    }
  },
  pricing: {
    currency: '$',
    calculator: () => 0.12,
    description: '基础价格 $0.12/次'
  }
})

export default klingVideoV26ProModel;
