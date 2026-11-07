import { defineModel } from '../defineModel'
import type { JsonObject } from '../../types/runtime'
import { resolveKieImageSources } from './mediaSources'

const RATIOS = ['auto', '16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3']
// 官方价格页只列 480p/720p，1080p 没有公开价格，不开放。
const RATES: Record<string, number> = { '480p': 0.012, '720p': 0.0225 }
const resolutionOf = (params: JsonObject) => params.kieGrokVideo15Resolution === '720p' ? '720p' : '480p'
const secondsOf = (params: JsonObject) => Math.min(15, Math.max(1, Math.round(Number(params.kieGrokVideo15Duration ?? 8) || 8)))

export const kieGrokImagineVideo15Model = defineModel({
  meta: {
    id: 'kie-grok-imagine-video-1.5', canonicalModelId: 'grok-imagine-video-1.5',
    provider: 'kie', type: 'video',
    tags: ['image-to-video'],
    promptLanguage: 'en',
    polling: { interval: 3000, maxAttempts: 200, expectedAttempts: 40 },
  },
  // 官方 schema 把 image_urls 列为必填且最多 1 张。
  inputLimits: { images: { exact: 1 }, videos: { max: 0 } },
  requirements: [{
    id: 'kie-grok-video-1.5-image', require: { images: { exact: 1 } },
    message: { title: '图片必需', message: 'Grok Imagine Video 1.5 需要上传 1 张图片。', type: 'warning' },
  }],
  params: [
    { id: 'kieGrokVideo15AspectRatio', type: 'dropdown', order: 1, default: 'auto', options: RATIOS.map(value => ({ value })) },
    { id: 'kieGrokVideo15Resolution', type: 'dropdown', order: 2, default: '480p', options: Object.keys(RATES).map(value => ({ value })) },
    { id: 'kieGrokVideo15Duration', type: 'number', order: 3, default: 8, min: 1, max: 15, step: 1 },
  ],
  endpoints: '/api/v1/jobs/createTask',
  request: { builder: (params) => {
    const images = resolveKieImageSources(params)
    if (images.length !== 1) throw new Error('Grok Imagine Video 1.5 需要 1 张图片')
    const prompt = typeof params.prompt === 'string' ? params.prompt : ''
    if (prompt.length > 4096) throw new Error('Grok Imagine Video 1.5 提示词最多 4096 字符')
    const ratio = String(params.kieGrokVideo15AspectRatio ?? 'auto')
    const input: JsonObject = {
      image_urls: images,
      aspect_ratio: RATIOS.includes(ratio) ? ratio : 'auto',
      resolution: resolutionOf(params),
      duration: secondsOf(params),
    }
    if (prompt) input.prompt = prompt
    return { model: 'grok-imagine-video-1-5-preview', input }
  } },
  pricing: {
    currency: '$',
    calculator: params => RATES[resolutionOf(params)] * secondsOf(params),
    description: '480p $0.012/秒，720p $0.0225/秒（含同步生成的音频）',
  },
})
export default kieGrokImagineVideo15Model
