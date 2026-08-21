/** APIMart Seedance 2.5 多模态视频模型 */

import { defineModel, sharedFieldText, sharedModeText, sharedOptionText } from '@/core'

export const apimartSeedance25Model = defineModel({
  meta: {
    id: 'apimart-seedance-2.5', canonicalModelId: 'seedance-2.5', seriesId: 'seedance', seriesRank: 2.5,
    provider: 'apimart', type: 'video', i18nScope: 'models.defs.apimart-seedance-2.5',
    name: { key: 'meta.name', fallback: 'Seedance 2.5' },
    tags: ['text-to-video', 'image-to-video', 'start-end-frame', 'reference-mode', 'multi-mode-switch', 'mixed-upload-mode', 'supports-audio-generation', 'provider-apimart'],
    aliases: ['seedance-2-5-apimart'], polling: { interval: 3000, maxAttempts: 400, expectedAttempts: 100 }
  },
  inputLimits: {
    images: { max: 2 }, videos: { max: 0 }, audios: { max: 0 },
    rules: [{ when: 'apimartSeedance25Mode === "reference-to-video"', images: { max: 30 }, videos: { max: 10 }, audios: { max: 10 } }]
  },
  params: [
    {
      id: 'apimartSeedance25Mode', type: 'dropdown', order: 1,
      name: sharedFieldText('mode'), default: 'reference-to-video',
      options: [
        { value: 'text-image-to-video', label: sharedModeText('textImageToVideo') },
        { value: 'reference-to-video', label: sharedModeText('referenceToVideo') }
      ]
    },
    {
      id: 'apimartSeedance25TaskType', type: 'dropdown', order: 2,
      name: { zh: '任务类型', en: 'Task Type' }, default: 'auto',
      visible: { condition: 'apimartSeedance25Mode === "reference-to-video"' },
      options: [
        { value: 'auto', label: { zh: '自动判断', en: 'Automatic' } },
        { value: 'reference', label: { zh: '参考生成', en: 'Reference' } },
        { value: 'edit', label: { zh: '视频编辑', en: 'Video Edit' } },
        { value: 'extend', label: { zh: '视频延长', en: 'Video Extend' } }
      ]
    },
    {
      id: 'apimartSeedance25AspectRatio', type: 'dropdown', order: 3,
      name: sharedFieldText('aspectRatio'), default: 'smart',
      options: [{ value: 'smart', label: sharedOptionText('smart') }, ...['1:1', '4:3', '3:4', '16:9', '9:16', '21:9'].map((ratio) => ({ value: ratio, label: ratio }))]
    },
    {
      id: 'apimartSeedance25Resolution', type: 'dropdown', order: 4,
      name: sharedFieldText('resolution'), default: '720p',
      options: ['480p', '720p', '1080p'].map((value) => ({ value, label: value }))
    },
    {
      id: 'apimartSeedance25Duration', type: 'number', order: 5,
      name: sharedFieldText('duration'), default: 5, min: 4, max: 30, step: 1
    },
    {
      id: 'apimartSeedance25AutoDuration', type: 'switch', order: 6,
      name: { zh: '自动时长', en: 'Automatic Duration' }, default: false
    },
    {
      id: 'apimartSeedance25GenerateAudio', type: 'switch', order: 7,
      name: sharedFieldText('generateAudio'), default: true
    },
    {
      id: 'apimartSeedance25ReturnLastFrame', type: 'switch', order: 8,
      name: { zh: '返回尾帧', en: 'Return Last Frame' }, default: false
    },
    {
      id: 'apimartSeedance25WebSearch', type: 'switch', order: 9,
      name: { zh: '联网搜索', en: 'Web Search' }, default: false
    }
  ],
  linkages: [], endpoints: '/v1/videos/generations',
  request: {
    builder: (params) => {
      const filterSources = (value: DynamicValue): string[] => Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
      const pickSources = (primary: DynamicValue, fallback: DynamicValue): string[] => {
        const preferred = filterSources(primary)
        return preferred.length > 0 ? preferred : filterSources(fallback)
      }
      const images = pickSources(params.uploadedFilePaths, params.images)
      const videos = pickSources(params.uploadedVideoFilePaths, params.videos)
      const audios = pickSources(params.uploadedAudioFilePaths, params.audios)
      const ratios = ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9']
      const raw = String(params.apimartSeedance25AspectRatio || 'smart')
      const mode = params.apimartSeedance25Mode === 'reference-to-video' ? 'reference-to-video' : 'text-image-to-video'
      const taskType = ['reference', 'edit', 'extend'].includes(String(params.apimartSeedance25TaskType))
        ? String(params.apimartSeedance25TaskType)
        : 'auto'
      const hasFrames = mode === 'text-image-to-video' && images.length > 0
      let size = ratios.includes(raw) ? raw : 'adaptive'
      if (raw === 'smart' || raw === 'adaptive' || raw === 'auto' || hasFrames || taskType === 'edit' || taskType === 'extend') {
        size = 'adaptive'
      }
      if ((taskType === 'edit' || taskType === 'extend') && videos.length === 0) {
        throw new Error(`Seedance 2.5 的${taskType === 'edit' ? '视频编辑' : '视频延长'}任务至少需要一个参考视频`)
      }
      const autoDuration = params.apimartSeedance25AutoDuration === true || taskType === 'edit'
      const body: DynamicValueMap = {
        model: 'seedance-2.5', prompt: typeof params.prompt === 'string' ? params.prompt.slice(0, 30000) : '',
        duration: autoDuration ? -1 : Math.min(30, Math.max(4, Math.round(Number(params.apimartSeedance25Duration || 5)))),
        size,
        resolution: params.apimartSeedance25Resolution === '480p' || params.apimartSeedance25Resolution === '1080p'
          ? params.apimartSeedance25Resolution : '720p',
        generate_audio: params.apimartSeedance25GenerateAudio !== false,
        return_last_frame: params.apimartSeedance25ReturnLastFrame === true,
        nsfw_check: false
      }
      if (params.apimartSeedance25WebSearch === true) body.tools = [{ type: 'web_search' }]
      if (mode === 'reference-to-video') {
        body.omni_reference_task_type = taskType
        if (images.length > 0) body.image_urls = images.slice(0, 30)
        if (videos.length > 0) body.video_urls = videos.slice(0, 10)
        if (audios.length > 0) body.audio_urls = audios.slice(0, 10)
      } else if (images.length > 0) {
        body.image_with_roles = images.slice(0, 2).map((url, index) => ({ url, role: index === 0 ? 'first_frame' : 'last_frame' }))
      }
      return body
    }
  },
  pricing: {
    currency: '$',
    calculator: (params) => {
      const autoDuration = params.apimartSeedance25AutoDuration === true || params.apimartSeedance25TaskType === 'edit'
      const duration = autoDuration ? 30 : Math.min(30, Math.max(4, Math.round(Number(params.apimartSeedance25Duration || 5))))
      const rates: Record<string, { noVideo: number; withVideo: number }> = {
        '480p': { noVideo: 0.09608, withVideo: 0.0576 },
        '720p': { noVideo: 0.216, withVideo: 0.1296 },
        '1080p': { noVideo: 0.38488, withVideo: 0.22992 }
      }
      const rate = rates[String(params.apimartSeedance25Resolution || '720p')] ?? rates['720p']
      const videos = Array.isArray(params.uploadedVideoFilePaths)
        ? params.uploadedVideoFilePaths
        : (Array.isArray(params.videos) ? params.videos : [])
      const hasVideo = params.apimartSeedance25Mode === 'reference-to-video' && videos.length > 0
      const inputDuration = typeof params.__firstVideoDurationSeconds === 'number' && params.__firstVideoDurationSeconds > 0
        ? params.__firstVideoDurationSeconds * videos.length
        : 0
      return (duration + (hasVideo ? inputDuration : 0)) * (hasVideo ? rate.withVideo : rate.noVideo)
    },
    description: '无/有视频输入每秒：480p $0.09608/$0.0576，720p $0.216/$0.1296，1080p $0.38488/$0.22992；有视频时按输入与输出总时长计费，自动时长按 30 秒预估'
  }
})

export default apimartSeedance25Model
