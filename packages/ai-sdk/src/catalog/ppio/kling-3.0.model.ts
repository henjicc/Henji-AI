import { defineModel } from '../defineModel'
import { hasUploadedImage, resolveUploadedVideoDurationSeconds } from './mediaSources'
import type { JsonObject } from '../../types/runtime'

export const kling30Model = defineModel({
  meta: {
    id: 'ppio-kling-3.0',
    canonicalModelId: 'kling-video-3.0',
    seriesId: 'kling-video',
    seriesRank: 3.0,
    provider: 'ppio',
    type: 'video',
    tags: ['text-to-video', 'image-to-video', 'start-end-frame', 'motion-control', 'provider-ppio'],
    polling: {
      interval: 3000,
      maxAttempts: 120,
      expectedAttempts: 50
    }
  },
  inputLimits: {
    images: { max: 2 },
    videos: { max: 0 },
    rules: [
      {
        when: 'ppioKling30Mode === "motion-control"',
        images: { exact: 1 },
        videos: { exact: 1 },
        videoConstraints: {
          maxSizeMB: 10,
          minDurationSec: 3,
          maxDurationSec: 30
        }
      }
    ]
  },
  requirements: [
    {
      id: 'kling-30-motion-image',
      when: 'ppioKling30Mode === "motion-control"',
      require: { images: { exact: 1 } },
      message: {
        title: '图片必需',
        message: '动作控制模式需要上传1张图片（不能多也不能少）',
        type: 'warning'
      }
    },
    {
      id: 'kling-30-motion-video',
      when: 'ppioKling30Mode === "motion-control"',
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
      id: 'ppioKling30Mode',
      type: 'dropdown',
      order: 1,
      valueType: 'string',
      default: 'text-image-to-video',
      options: [
        { value: 'text-image-to-video' },
        { value: 'motion-control' }
      ]
    },
    {
      id: 'ppioKling30Resolution',
      type: 'dropdown',
      order: 2,
      valueType: 'string',
      default: '720P',
      options: [
        { value: '720P' },
        { value: '1080P' },
        { value: '4K' }
      ]
    },
    {
      id: 'ppioKling30Duration',
      type: 'dropdown',
      order: 3,
      valueType: 'number',
      default: 5,
      visible: {
        condition: (params) => params.ppioKling30Mode !== 'motion-control',
        reason: '动作控制模式输出时长由参考视频和人物朝向决定'
      },
      options: Array.from({ length: 13 }, (_, index) => {
        const value = index + 3
        return { value }
      })
    },
    {
      id: 'ppioKling30AspectRatio',
      type: 'dropdown',
      order: 4,
      valueType: 'string',
      default: '16:9',
      visible: {
        condition: (params) => {
          if (params.ppioKling30Mode === 'motion-control') {
            return false
          }
          return !hasUploadedImage(params)
        },
        reason: '仅文生视频支持设置宽高比'
      },
      options: [
        { value: '16:9' },
        { value: '9:16' },
        { value: '1:1' }
      ]
    },
    {
      id: 'ppioKling30CfgScale',
      type: 'number',
      order: 5,
      valueType: 'number',
      default: 0.5,
      visible: {
        condition: (params) => params.ppioKling30Mode !== 'motion-control',
        reason: '动作控制接口不支持 cfg_scale'
      },
      min: 0,
      max: 1,
      step: 0.01
    },
    {
      id: 'ppioKling30Sound',
      type: 'switch',
      order: 6,
      valueType: 'boolean',
      default: false,
      visible: {
        condition: (params) => params.ppioKling30Mode !== 'motion-control',
        reason: '动作控制模式使用保留原声控制'
      }
    },
    {
      id: 'ppioKling30CharacterOrientation',
      type: 'dropdown',
      order: 7,
      valueType: 'string',
      default: 'video',
      visible: {
        condition: (params) => params.ppioKling30Mode === 'motion-control',
        reason: '仅动作控制模式支持人物朝向'
      },
      options: [
        { value: 'video' },
        { value: 'image' }
      ]
    },
    {
      id: 'ppioKling30KeepOriginalSound',
      type: 'switch',
      order: 8,
      valueType: 'boolean',
      default: true,
      visible: {
        condition: (params) => params.ppioKling30Mode === 'motion-control',
        reason: '仅动作控制模式支持保留参考视频原声'
      }
    }
  ],
  endpoints: {
    default: '/async/kling-v3.0-std-t2v',
    selector: (params) => {
      const mode = typeof params.ppioKling30Mode === 'string'
        ? params.ppioKling30Mode
        : 'text-image-to-video'
      if (mode === 'motion-control') {
        return '/async/kling-v3.0-motion-control'
      }

      const uploadedFilePaths = Array.isArray(params.uploadedFilePaths)
        ? params.uploadedFilePaths.filter((item) => typeof item === 'string' && item.trim().length > 0)
        : []
      const legacyImages = Array.isArray(params.images)
        ? params.images.filter((item) => typeof item === 'string' && item.trim().length > 0)
        : []
      const requestImages = uploadedFilePaths.length > 0 ? uploadedFilePaths : legacyImages
      const rawResolution = params.ppioKling30Resolution ?? params.resolution
      const version = rawResolution === '4K'
        ? '4k'
        : (rawResolution === '1080P' ? 'pro' : 'std')
      const modality = requestImages.length > 0 ? 'i2v' : 't2v'

      return `/async/kling-v3.0-${version}-${modality}`
    }
  },
  request: {
    builder: (params) => {
      const mode = typeof params.ppioKling30Mode === 'string'
        ? params.ppioKling30Mode
        : 'text-image-to-video'
      const uploadedFilePaths = Array.isArray(params.uploadedFilePaths)
        ? params.uploadedFilePaths.filter((item) => typeof item === 'string' && item.trim().length > 0)
        : []
      const legacyImages = Array.isArray(params.images)
        ? params.images.filter((item) => typeof item === 'string' && item.trim().length > 0)
        : []
      const requestImages = uploadedFilePaths.length > 0 ? uploadedFilePaths : legacyImages
      const uploadedVideoFilePaths = Array.isArray(params.uploadedVideoFilePaths)
        ? params.uploadedVideoFilePaths.filter((item) => typeof item === 'string' && item.trim().length > 0)
        : []
      const legacyVideos = Array.isArray(params.videos)
        ? params.videos.filter((item) => typeof item === 'string' && item.trim().length > 0)
        : []
      const requestVideos = uploadedVideoFilePaths.length > 0 ? uploadedVideoFilePaths : legacyVideos
      const prompt = typeof params.prompt === 'string' ? params.prompt.slice(0, 2500) : ''
      const rawResolution = params.ppioKling30Resolution ?? params.resolution
      const resolution = rawResolution === '4K'
        ? '4K'
        : (rawResolution === '1080P' ? '1080P' : '720P')

      if (mode === 'motion-control') {
        const requestData: JsonObject = {
          image: requestImages[0],
          video: requestVideos[0],
          prompt,
          model_name: resolution === '720P' ? 'kling-v3-0-std' : 'kling-v3-0-pro',
          character_orientation: params.ppioKling30CharacterOrientation === 'image' ? 'image' : 'video',
          keep_original_sound: params.ppioKling30KeepOriginalSound !== undefined
            ? params.ppioKling30KeepOriginalSound === true
            : params.keep_original_sound !== false
        }

        return requestData
      }

      const durationValue = params.ppioKling30Duration ?? params.duration
      const duration = typeof durationValue === 'number' ? durationValue : Number(durationValue || 5)
      const cfgScaleValue = params.ppioKling30CfgScale ?? params.cfg_scale
      const cfgScale = typeof cfgScaleValue === 'number' ? cfgScaleValue : Number(cfgScaleValue ?? 0.5)
      const rawSound = params.ppioKling30Sound ?? params.sound
      const sound = rawSound === true

      const requestData: JsonObject = {
        prompt,
        duration,
        sound,
        cfg_scale: Number.isFinite(cfgScale) ? cfgScale : 0.5
      }

      if (requestImages.length > 0) {
        requestData.image = requestImages[0]
        if (requestImages.length > 1) {
          requestData.end_image = requestImages[1]
        }
        return requestData
      }

      const rawAspectRatio = params.ppioKling30AspectRatio ?? params.aspect_ratio
      const aspectRatio = rawAspectRatio === '9:16' || rawAspectRatio === '1:1' ? rawAspectRatio : '16:9'
      requestData.aspect_ratio = aspectRatio

      return requestData
    }
  },
  pricing: {
    currency: '¥',
    calculator: (params) => {
      const mode = params.ppioKling30Mode ?? 'text-image-to-video'
      const rawResolution = params.ppioKling30Resolution ?? params.resolution
      const resolution = rawResolution === '4K'
        ? '4K'
        : (rawResolution === '1080P' ? '1080P' : '720P')
      const rawSound = params.ppioKling30Sound ?? params.sound
      const sound = rawSound === true
      const durationValue = params.ppioKling30Duration ?? params.duration
      const duration = typeof durationValue === 'number' ? durationValue : Number(durationValue || 5)
      const safeDuration = Number.isFinite(duration) ? duration : 5

      if (mode === 'motion-control') {
        const characterOrientation = params.ppioKling30CharacterOrientation ?? params.character_orientation
        // character_orientation=image 时官方固定输出 5 秒；=video 时输出时长跟随参考视频
        // （最长 30 秒），优先使用宿主读取到的真实参考视频时长，读取失败才用当前参数兜底。
        const sourceVideoDuration = resolveUploadedVideoDurationSeconds(params, safeDuration)
        const motionDuration = characterOrientation === 'image'
          ? 5
          : Math.min(30, Math.max(3, sourceVideoDuration || safeDuration))
        const pricePerSecond = resolution === '720P' ? 0.9 : 1.2
        return pricePerSecond * motionDuration
      }

      const pricePerSecond = resolution === '4K'
        ? (sound ? 4.5 : 3.0)
        : (resolution === '1080P'
          ? (sound ? 1.2 : 0.8)
          : (sound ? 0.9 : 0.6))

      return pricePerSecond * safeDuration
    },
    description: '720P(Standard)：无声 ¥0.6/秒，有声 ¥0.9/秒；1080P(Pro)：无声 ¥0.8/秒，有声 ¥1.2/秒；4K：无声 ¥3.0/秒，有声 ¥4.5/秒；动作控制 720P ¥0.9/秒，1080P ¥1.2/秒'
  }
})

export default kling30Model
