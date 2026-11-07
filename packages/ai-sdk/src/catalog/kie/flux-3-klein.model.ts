import { defineModel } from '../defineModel'
import type { JsonObject } from '../../types/runtime'
import { resolveKieImageSources } from './mediaSources'

const RATIOS = ['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16', '21:9', '9:21']
const RESOLUTIONS = ['1K', '2K', '4K']
const RATES: Record<string, number> = { '1K': 0.008, '2K': 0.0125, '4K': 0.0325 }
const resolutionOf = (params: JsonObject) => RESOLUTIONS.includes(String(params.kieFlux3KleinResolution)) ? String(params.kieFlux3KleinResolution) : '1K'
const countOf = (params: JsonObject) => Math.min(4, Math.max(1, Math.round(Number(params.kieFlux3KleinCount ?? 1) || 1)))

function nearestRatio(params: JsonObject): string {
  const hint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0
    ? params.__firstImageRatio : 1
  return RATIOS.reduce((best, next) => {
    const value = (ratio: string) => { const [w, h] = ratio.split(':').map(Number); return w / h }
    return Math.abs(value(next) - hint) < Math.abs(value(best) - hint) ? next : best
  }, '1:1')
}

export const kieFlux3KleinModel = defineModel({
  meta: {
    id: 'kie-flux-3-klein', canonicalModelId: 'flux-3-klein',
    provider: 'kie', type: 'image',
    tags: ['text-to-image', 'image-to-image'],
    polling: { interval: 2000, maxAttempts: 150 },
  },
  inputLimits: { images: { max: 10 }, videos: { max: 0 } },
  params: [
    { id: 'kieFlux3KleinAspectRatio', type: 'dropdown', order: 1, default: 'smart', options: ['smart', ...RATIOS].map(value => ({ value })) },
    { id: 'kieFlux3KleinResolution', type: 'dropdown', order: 2, default: '1K', options: RESOLUTIONS.map(value => ({ value })) },
    { id: 'kieFlux3KleinCount', type: 'number', order: 3, default: 1, min: 1, max: 4, step: 1 },
    { id: 'kieFlux3KleinEnhancePrompt', type: 'switch', order: 4, default: true },
  ],
  endpoints: '/api/v1/jobs/createTask',
  request: { builder: (params) => {
    const prompt = typeof params.prompt === 'string' ? params.prompt.trim() : ''
    if (!prompt) throw new Error('请输入 FLUX 3 Klein 提示词')
    if (prompt.length > 5000) throw new Error('FLUX 3 Klein 提示词最多 5000 字符')
    const images = resolveKieImageSources(params)
    if (images.length > 10) throw new Error('FLUX 3 Klein 最多 10 张参考图')
    const rawRatio = String(params.kieFlux3KleinAspectRatio ?? 'smart')
    const input: JsonObject = {
      prompt,
      aspect_ratio: RATIOS.includes(rawRatio) ? rawRatio : (images.length ? 'auto' : nearestRatio(params)),
      resolution: resolutionOf(params),
      num_images: countOf(params),
      enhance_prompt: params.kieFlux3KleinEnhancePrompt !== false,
    }
    if (images.length) input.image_urls = images
    return { model: images.length ? 'flux-3/klein-edit-image' : 'flux-3/klein-text-to-image', input }
  } },
  pricing: {
    currency: '$',
    calculator: params => RATES[resolutionOf(params)] * countOf(params),
    description: '文生图与编辑同价：1K $0.008、2K $0.0125、4K $0.0325 每张',
  },
})
export default kieFlux3KleinModel
