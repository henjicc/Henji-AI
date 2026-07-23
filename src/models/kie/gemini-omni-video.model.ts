/**
 * KIE Gemini Omni 视频生成模型
 */

import { defineModel, sharedFieldText, sharedOptionText } from '@/core'
import { hasUploadedVideo } from './mediaSources'

const KIE_CREATE_TASK_ENDPOINT = '/api/v1/jobs/createTask'

export const kieGeminiOmniVideoModel = defineModel({
  meta: {
    id: 'kie-gemini-omni-video',
    canonicalModelId: 'gemini-omni-video',
    provider: 'kie',
    type: 'video',
    i18nScope: 'models.defs.kie-gemini-omni-video',
    name: { key: 'meta.name', fallback: 'Gemini Omni' },
    tags: ['text-to-video', 'image-to-video', 'multi-image-reference', 'video-reference', 'provider-kie'],
    polling: {
      interval: 3000,
      maxAttempts: 180,
      expectedAttempts: 60
    }
  },
  inputLimits: {
    images: { max: 7 },
    videos: { max: 1 },
    rules: [
      {
        videoConstraints: {
          maxDurationSec: 30,
          maxSizeMB: 100,
          trim: { maxClipSeconds: 10 }
        }
      },
      {
        // when 表达式在 with(params){with(context){...}} 里执行：bare 引用一个在 params/context
        // 上都不存在的标识符会直接抛 ReferenceError（画布只有 videos，没有 uploadedVideoFilePaths/
        // uploadedVideos；对话面板反过来），必须用 typeof 守卫，不能像 visible.condition 那样直接判 falsy。
        when: '(typeof uploadedVideoFilePaths !== "undefined" && Array.isArray(uploadedVideoFilePaths) && uploadedVideoFilePaths.length > 0) || (typeof videos !== "undefined" && Array.isArray(videos) && videos.length > 0) || (typeof uploadedVideos !== "undefined" && Array.isArray(uploadedVideos) && uploadedVideos.length > 0)',
        images: { max: 5 }
      }
    ]
  },
  params: [
    {
      id: 'kieGeminiOmniVideoDuration',
      type: 'dropdown',
      order: 1,
      name: sharedFieldText('duration'),
      default: '8',
      options: [
        { value: '4', label: '4s' },
        { value: '6', label: '6s' },
        { value: '8', label: '8s' },
        { value: '10', label: '10s' }
      ],
      visible: {
        condition: (params: DynamicValueMap) => !hasUploadedVideo(params)
      }
    },
    {
      id: 'kieGeminiOmniVideoAspectRatio',
      type: 'dropdown',
      order: 2,
      name: sharedFieldText('aspectRatio'),
      default: 'smart',
      options: [
        { value: 'smart', label: sharedOptionText('smart') },
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' }
      ]
    },
    {
      id: 'kieGeminiOmniVideoResolution',
      type: 'dropdown',
      order: 3,
      name: sharedFieldText('resolution'),
      default: '720p',
      options: [
        { value: '720p', label: '720p' },
        { value: '1080p', label: '1080p' },
        { value: '4k', label: '4K' }
      ]
    }
  ],
  linkages: [],
  endpoints: KIE_CREATE_TASK_ENDPOINT,
  request: {
    // 注意：这个函数会被 scripts/generate-model-manifest.cjs 按源码文本单独序列化成
    // builderJs，再由 electron 主进程在独立 Node VM 里执行——不能引用本文件顶层的
    // 任何 helper/常量（VM 里没有这个模块的闭包），所有用到的小工具函数/常量必须
    // 在这个函数体内部重新声明一份。
    builder: (params) => {
      const filterSources = (value: DynamicValue): string[] => Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : []
      const pickSources = (primary: DynamicValue, fallback: DynamicValue): string[] => {
        const preferred = filterSources(primary)
        return preferred.length > 0 ? preferred : filterSources(fallback)
      }

      const MAX_IMAGES_NO_VIDEO = 7
      const MAX_IMAGES_WITH_VIDEO = 5
      const ASPECT_RATIOS = ['16:9', '9:16']

      const prompt = params.prompt || ''
      const images = pickSources(params.uploadedFilePaths, params.images)
      const videos = pickSources(params.uploadedVideoFilePaths, params.videos)
      const hasVideo = videos.length > 0
      const maxImages = hasVideo ? MAX_IMAGES_WITH_VIDEO : MAX_IMAGES_NO_VIDEO
      const resolution = params.kieGeminiOmniVideoResolution || '720p'

      const aspectRatioRaw = String(params.kieGeminiOmniVideoAspectRatio || 'smart')
      const aspectRatio = ASPECT_RATIOS.includes(aspectRatioRaw)
        ? aspectRatioRaw
        : (() => {
          const imageRatio = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0
            ? params.__firstImageRatio
            : null
          // 无图时没有可参考的比例信号，直接选横屏（更符合大众预期），不强行套用"最接近 1:1"的判断
          if (imageRatio === null) {
            return '16:9'
          }
          let best = ASPECT_RATIOS[0]
          let bestDiff = Number.POSITIVE_INFINITY
          for (const ratioText of ASPECT_RATIOS) {
            const pair = ratioText.split(':').map(Number)
            const ratio = pair[0] / Math.max(1, pair[1])
            const diff = Math.abs(ratio - imageRatio)
            if (diff < bestDiff) {
              bestDiff = diff
              best = ratioText
            }
          }
          return best
        })()

      const input: DynamicValueMap = {
        prompt,
        aspect_ratio: aspectRatio,
        resolution
      }

      if (images.length > 0) {
        input.image_urls = images.slice(0, maxImages)
      }

      if (hasVideo) {
        const rawClipDuration = typeof params.__firstVideoDurationSeconds === 'number' && params.__firstVideoDurationSeconds > 0
          ? params.__firstVideoDurationSeconds
          : 10
        // API 只接受整秒：四舍五入到最近整数，确保裁剪/上传的片段完整覆盖（如 6.5s 取 7，6.1s 取 6）；
        // 上限夹到 10（与 inputLimits.rules 里 videoConstraints.trim.maxClipSeconds 一致）——
        // 用户没主动裁剪、源视频本身超过 10s 时防止发出超过 API"结束-起始不超过10秒"限制的 ends
        const clipDuration = Math.min(10, Math.max(1, Math.round(rawClipDuration)))
        input.video_list = [{ url: videos[0], start: 0, ends: clipDuration }]
      } else {
        input.duration = String(params.kieGeminiOmniVideoDuration || '8')
      }

      return {
        model: 'gemini-omni-video',
        input
      }
    }
  },
  pricing: {
    currency: '$',
    calculator: (params) => {
      const hasVideo = hasUploadedVideo(params)
      const resolution = String(params.kieGeminiOmniVideoResolution || '720p')
      const isHigh4k = resolution === '4k'

      if (hasVideo) {
        return isHigh4k ? 1.8 : 1.2
      }

      const duration = String(params.kieGeminiOmniVideoDuration || '8')
      const basePriceByDuration: Record<string, number> = {
        '4': 0.45,
        '6': 0.6,
        '8': 0.75,
        '10': 0.9
      }
      const base = basePriceByDuration[duration] ?? basePriceByDuration['8']
      return isHigh4k ? base + 0.6 : base
    },
    description: '无视频输入：4/6/8/10s 在 720p/1080p 下 $0.45/$0.6/$0.75/$0.9，4K 在同时长上加 $0.6；有视频输入：720p/1080p 固定 $1.2，4K 固定 $1.8'
  }
})

export default kieGeminiOmniVideoModel
