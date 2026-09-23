import { defineModel } from '../defineModel'
import type { JsonObject } from '../../types/runtime'
import { hasUploadedImage, resolveKieImageSources } from './mediaSources'

const RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '4:5', '5:4', '9:21', '21:9']
function duration(params: JsonObject): number {
  const value = params.kieHappyHorse11Duration ?? 5
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 3 || value > 15) {
    throw new Error('HappyHorse 1.1 时长必须是 3–15 秒的整数')
  }
  return value
}

export const kieHappyHorse11Model = defineModel({
  meta: {
    id: 'kie-happyhorse-1.1', canonicalModelId: 'happyhorse-1.1', seriesId: 'happyhorse', seriesRank: 1.1,
    provider: 'kie', type: 'video',
    tags: ['text-to-video', 'image-to-video', 'reference-mode', 'multi-mode-switch', 'supports-multi-image', 'provider-kie'],
    polling: { interval: 5000, maxAttempts: 180, expectedAttempts: 60 },
  },
  inputLimits: {
    images: { max: 1 }, videos: { max: 0 }, audios: { max: 0 },
    rules: [{ when: 'kieHappyHorse11Mode === "reference-to-video"', images: { min: 1, max: 9 } }],
  },
  params: [
    { id: 'kieHappyHorse11Mode', type: 'dropdown', order: 1, default: 'text-image-to-video',
      options: [{ value: 'text-image-to-video' }, { value: 'reference-to-video' }] },
    { id: 'kieHappyHorse11AspectRatio', type: 'dropdown', order: 2, default: 'smart',
      visible: { condition: params => params.kieHappyHorse11Mode === 'reference-to-video' || !hasUploadedImage(params) },
      options: [{ value: 'smart' }, ...RATIOS.map(value => ({ value }))] },
    { id: 'kieHappyHorse11Resolution', type: 'dropdown', order: 3, default: '1080p',
      options: [{ value: '720p' }, { value: '1080p' }] },
    { id: 'kieHappyHorse11Duration', type: 'number', order: 4, default: 5, min: 3, max: 15, step: 1 },
  ],
  endpoints: '/api/v1/jobs/createTask',
  request: { builder: params => {
    const images = resolveKieImageSources(params)
    const reference = params.kieHappyHorse11Mode === 'reference-to-video'
    if (images.length > (reference ? 9 : 1) || (reference && !images.length)) {
      throw new Error(reference ? '参考模式需要 1–9 张图片' : '图生视频只接受 1 张图片')
    }
    const mode = reference ? 'reference-to-video' : images.length ? 'image-to-video' : 'text-to-video'
    const prompt = typeof params.prompt === 'string' ? params.prompt.trim() : ''
    if ((!prompt && mode !== 'image-to-video') || prompt.length > (mode === 'text-to-video' ? 4999 : 5000)) {
      throw new Error('HappyHorse 1.1 提示词为空或超出长度限制')
    }
    const input: JsonObject = { duration: duration(params), resolution: params.kieHappyHorse11Resolution === '720p' ? '720p' : '1080p' }
    if (prompt) input.prompt = prompt
    if (mode === 'image-to-video') input.image_urls = images
    else {
      const raw = String(params.kieHappyHorse11AspectRatio ?? 'smart')
      const hint = typeof params.__firstImageRatio === 'number' && params.__firstImageRatio > 0 ? params.__firstImageRatio : 16 / 9
      input.aspect_ratio = RATIOS.includes(raw) ? raw : RATIOS.reduce((best, ratio) => {
        const distance = (value: string): number => { const [w, h] = value.split(':').map(Number); return Math.abs(w / h - hint) }
        return distance(ratio) < distance(best) ? ratio : best
      }, '16:9')
      if (reference) input.reference_image = images
    }
    return { model: `happyhorse-1-1/${mode}`, input }
  } },
  pricing: {
    currency: '$',
    calculator: params => duration(params) * (params.kieHappyHorse11Resolution === '720p' ? 0.1125 : 0.145),
    description: '720p $0.1125/秒；1080p $0.145/秒；三种模式同价',
  },
})
export default kieHappyHorse11Model
