/** APIMart Midjourney 整图编辑 */

import { defineModel } from '@/core'
import { apimartMidjourneyModel } from './midjourney.model'

export const apimartMidjourneyEditModel = defineModel({
  meta: {
    id: 'apimart-midjourney-edit', canonicalModelId: 'midjourney', seriesId: 'midjourney', seriesRank: 1.2,
    provider: 'apimart', type: 'image', i18nScope: 'models.defs.apimart-midjourney-edit',
    name: { key: 'meta.name', fallback: 'Midjourney Edit' },
    tags: ['image-to-image', 'supports-image-editing', 'supports-multi-image', 'provider-apimart'],
    aliases: ['midjourney-edits-apimart'], polling: { interval: 3000, maxAttempts: 300, expectedAttempts: 80 }
  },
  inputLimits: { images: { min: 1, max: 6 }, videos: { max: 0 }, audios: { max: 0 } },
  requirements: [{
    id: 'apimart-midjourney-edit-images',
    require: { images: { min: 1 } },
    message: { title: '图片必需', message: 'Midjourney Edit 需要至少 1 张待编辑图片。', type: 'warning' }
  }],
  params: apimartMidjourneyModel.params,
  paramPresentation: apimartMidjourneyModel.paramPresentation,
  linkages: apimartMidjourneyModel.linkages,
  runtimeConstraints: {
    mediaFields: [
      { field: 'cref', kind: 'image' },
      { field: 'sref', kind: 'image' },
      { field: 'dref', kind: 'image' }
    ]
  },
  endpoints: '/v1/midjourney/generations/edits',
  request: {
    // Manifest 会把 builder 放进独立 VM，因此不能引用 Imagine 文件的闭包函数。
    builder: (params) => {
      const clean = (value: DynamicValue): string[] => Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : []
      const uploaded = clean(params.uploadedFilePaths)
      const images = uploaded.length > 0 ? uploaded : clean(params.images)
      const prompt = typeof params.prompt === 'string' ? params.prompt.trim() : ''
      if (!prompt) throw new Error('Midjourney Edit 的编辑提示词不能为空')
      if (images.length === 0) throw new Error('Midjourney Edit 至少需要 1 张待编辑图片')
      const body: DynamicValueMap = {
        prompt,
        image_urls: images,
        speed: params.apimartMidjourneySpeed === 'fast' || params.apimartMidjourneySpeed === 'turbo'
          ? params.apimartMidjourneySpeed
          : 'relax',
        quality: ['0.25', '0.5', '2'].includes(String(params.apimartMidjourneyQuality))
          ? String(params.apimartMidjourneyQuality)
          : '1',
        stylize: Math.min(1000, Math.max(0, Math.round(Number(params.apimartMidjourneyStylize ?? 100)))),
        chaos: Math.min(100, Math.max(0, Math.round(Number(params.apimartMidjourneyChaos ?? 0)))),
        weird: Math.min(3000, Math.max(0, Math.round(Number(params.apimartMidjourneyWeird ?? 0)))),
        iw: Math.min(3, Math.max(0, Number(params.apimartMidjourneyImageWeight ?? 1))),
        nsfw_check: false
      }
      const ratio = String(params.apimartMidjourneyAspectRatio || 'smart')
      if (ratio !== 'smart' && /^\d+:\d+$/u.test(ratio)) body.size = ratio
      const requestedVersion = String(params.apimartMidjourneyVersion || 'auto')
      const niji = params.apimartMidjourneyNiji === true
      const version = niji && !['auto', '6', '7'].includes(requestedVersion) ? '7' : requestedVersion
      if (version !== 'auto') body.version = version
      if (niji) {
        body.niji = true
        if (version === 'auto' || !['6', '7'].includes(version)) body.version = '7'
      }
      if (params.apimartMidjourneyTile === true) body.tile = true
      if (params.apimartMidjourneyRaw === true) body.raw = true
      if (params.apimartMidjourneyDraft === true && !niji && ['auto', '7', '8.1', '8.2'].includes(version)) body.draft = true
      if (params.apimartMidjourneyHd === true && !niji && ['auto', '8.1', '8.2'].includes(version)) body.hd = true
      const repeat = Math.min(40, Math.max(1, Math.round(Number(params.apimartMidjourneyRepeat ?? 1))))
      if (repeat > 1) body.repeat = repeat
      const references = [
        ['cref', params.apimartMidjourneyCharacterReference],
        ['sref', params.apimartMidjourneyStyleReference],
        ['dref', params.apimartMidjourneyDepthReference]
      ] as const
      for (const [field, value] of references) {
        const candidates = Array.isArray(value) ? value : [value]
        const reference = candidates.find((item) => typeof item === 'string' && item.trim().length > 0)
        if (typeof reference === 'string') body[field] = reference.trim()
      }
      if (body.cref) body.cw = Math.min(100, Math.max(0, Math.round(Number(params.apimartMidjourneyCharacterWeight ?? 100))))
      if (body.sref) body.sw = Math.min(1000, Math.max(0, Math.round(Number(params.apimartMidjourneyStyleWeight ?? 100))))
      if (body.dref) body.dw = Math.min(100, Math.max(0, Number(params.apimartMidjourneyDepthWeight ?? 100)))
      const stop = Math.min(100, Math.max(10, Math.round(Number(params.apimartMidjourneyStop ?? 100))))
      const supportsStop = niji
        ? version === '6'
        : ['5.1', '5.2', '6', '6.1'].includes(version)
      if (stop < 100 && supportsStop) body.stop = stop
      if (typeof params.apimartMidjourneyExtra === 'string' && params.apimartMidjourneyExtra.trim()) {
        body.extra = params.apimartMidjourneyExtra.trim()
      }
      return body
    }
  },
  pricing: {
    currency: '$',
    calculator: (params) => {
      const repeat = Math.min(40, Math.max(1, Math.round(Number(params.apimartMidjourneyRepeat ?? 1))))
      return repeat * (params.apimartMidjourneySpeed === 'turbo' ? 0.1 : 0.05504)
    },
    description: 'Edit Relax/Fast $0.05504 每次，Turbo $0.1 每次；repeat 按次数倍增'
  }
})

export default apimartMidjourneyEditModel
