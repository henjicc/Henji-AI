/** APIMart Midjourney 生成、编辑与混图统一模型（运行时契约） */

import { defineModel } from '../defineModel'
import { hasUploadedImage } from '../shared/mediaPresence'
import type { JsonValue, JsonObject } from '../../types/runtime'

export const apimartMidjourneyModel = defineModel({
  meta: {
    id: 'apimart-midjourney',
    canonicalModelId: 'midjourney',
    seriesId: 'midjourney',
    seriesRank: 1,
    provider: 'apimart',
    type: 'image',
    tags: ['text-to-image', 'image-to-image', 'supports-image-editing', 'supports-multi-image', 'provider-apimart'],
    aliases: [
      'midjourney-apimart',
      'apimart-midjourney-edit',
      'midjourney-edit-apimart',
      'midjourney-edits-apimart',
      'apimart-midjourney-blend',
      'midjourney-blend-apimart',
    ],
    aliasParamDefaults: {
      'apimart-midjourney-edit': { apimartMidjourneyMode: 'edit' },
      'midjourney-edit-apimart': { apimartMidjourneyMode: 'edit' },
      'midjourney-edits-apimart': { apimartMidjourneyMode: 'edit' },
      'apimart-midjourney-blend': { apimartMidjourneyMode: 'blend' },
      'midjourney-blend-apimart': { apimartMidjourneyMode: 'blend' },
    },
    aliasParamMappings: {
      'apimart-midjourney-blend': {
        apimartMidjourneyBlendAspectRatio: 'apimartMidjourneyAspectRatio',
        apimartMidjourneyBlendSpeed: 'apimartMidjourneySpeed',
      },
    },
    polling: { interval: 3000, maxAttempts: 300, expectedAttempts: 80 },
  },
  inputLimits: {
    images: { max: 6 },
    videos: { max: 0 },
    audios: { max: 0 },
    rules: [
      { when: 'apimartMidjourneyMode === "edit"', images: { min: 1, max: 6 } },
      { when: 'apimartMidjourneyMode === "blend"', images: { min: 2, max: 4 } },
    ],
  },
  requirements: [
    {
      id: 'apimart-midjourney-edit-images',
      when: 'apimartMidjourneyMode === "edit"',
      require: { prompt: true, images: { min: 1, max: 6 } },
      message: { title: '需要编辑素材', message: '编辑模式需要提示词和至少 1 张待编辑图片。', type: 'warning' },
    },
    {
      id: 'apimart-midjourney-blend-images',
      when: 'apimartMidjourneyMode === "blend"',
      require: { images: { min: 2, max: 4 } },
      message: { title: '需要多张图片', message: '混图模式需要 2–4 张图片。', type: 'warning' },
    },
  ],
  params: [
    {
      id: 'apimartMidjourneyMode', type: 'dropdown', order: 1,
      default: 'imagine',
      options: [
        { value: 'imagine' },
        { value: 'edit' },
        { value: 'blend' },
      ],
    },
    {
      id: 'apimartMidjourneyAspectRatio', type: 'dropdown', order: 2,
      default: 'smart',
      options: [
        { value: 'smart' },
        ...['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9'].map((value) => ({ value })),
      ],
    },
    {
      id: 'apimartMidjourneySpeed', type: 'dropdown', order: 3,
      default: 'relax',
      options: [
        { value: 'relax' },
        { value: 'fast' },
        { value: 'turbo' },
      ],
    },
    {
      id: 'apimartMidjourneyQuality', type: 'dropdown', order: 4,
      default: '1',
      options: ['0.25', '0.5', '1', '2'].map((value) => ({ value })),
    },
    {
      id: 'apimartMidjourneyRepeat', type: 'number', order: 5,
      default: 1, min: 1, max: 40, step: 1,
    },
    {
      id: 'apimartMidjourneyVersion', type: 'dropdown', order: 20,
      default: 'auto',
      options: [
        { value: 'auto' },
        ...['8.2', '8.1', '7', '6.1', '6', '5.2', '5.1'].map((value) => ({ value })),
      ],
    },
    {
      id: 'apimartMidjourneyNiji', type: 'switch', order: 21,
      default: false,
    },
    {
      id: 'apimartMidjourneyStylize', type: 'number', order: 22,
      default: 100, min: 0, max: 1000, step: 1,
    },
    {
      id: 'apimartMidjourneyChaos', type: 'number', order: 23,
      default: 0, min: 0, max: 100, step: 1,
    },
    {
      id: 'apimartMidjourneyWeird', type: 'number', order: 24,
      default: 0, min: 0, max: 3000, step: 1,
    },
    {
      id: 'apimartMidjourneyImageWeight', type: 'number', order: 25,
      default: 1, min: 0, max: 3, step: 0.1,
    },
    {
      id: 'apimartMidjourneyTile', type: 'switch', order: 26,
      default: false,
    },
    {
      id: 'apimartMidjourneyRaw', type: 'switch', order: 27,
      default: false,
    },
    {
      id: 'apimartMidjourneyDraft', type: 'switch', order: 28,
      default: false,
    },
    {
      id: 'apimartMidjourneyHd', type: 'switch', order: 29,
      default: false,
    },
    {
      id: 'apimartMidjourneyCharacterReference', type: 'image-upload', order: 30,
      default: [],
      valueType: 'array', maxCount: 1, format: 'url',
      accept: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], maxSize: 20 * 1024 * 1024,
    },
    {
      id: 'apimartMidjourneyStyleReference', type: 'image-upload', order: 31,
      default: [],
      valueType: 'array', maxCount: 1, format: 'url',
      accept: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], maxSize: 20 * 1024 * 1024,
    },
    {
      id: 'apimartMidjourneyDepthReference', type: 'image-upload', order: 32,
      default: [],
      valueType: 'array', maxCount: 1, format: 'url',
      accept: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], maxSize: 20 * 1024 * 1024,
    },
    {
      id: 'apimartMidjourneyCharacterWeight', type: 'number', order: 33,
      default: 100, min: 0, max: 100, step: 1,
    },
    {
      id: 'apimartMidjourneyStyleWeight', type: 'number', order: 34,
      default: 100, min: 0, max: 1000, step: 1,
    },
    {
      id: 'apimartMidjourneyDepthWeight', type: 'number', order: 35,
      default: 100, min: 0, max: 100, step: 1,
    },
    {
      id: 'apimartMidjourneyStop', type: 'number', order: 36,
      default: 100, min: 10, max: 100, step: 1,
    },
    {
      id: 'apimartMidjourneyExtra', type: 'textarea', order: 37,
      default: '',
    },
  ],
  runtimeConstraints: {
    mediaFields: [
      { field: 'cref', kind: 'image' },
      { field: 'sref', kind: 'image' },
      { field: 'dref', kind: 'image' },
    ],
  },
  endpoints: {
    default: '/v1/midjourney/generations',
    selector: (params) => {
      if (params.apimartMidjourneyMode === 'blend') return '/v1/midjourney/generations/blend'
      if (params.apimartMidjourneyMode === 'edit') return '/v1/midjourney/generations/edits'
      return '/v1/midjourney/generations'
    },
  },
  request: {
    builder: (params) => {
      const clean = (value: JsonValue): string[] => Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : []
      const uploaded = clean(params.uploadedFilePaths)
      const images = uploaded.length > 0 ? uploaded : clean(params.images)
      const mode = params.apimartMidjourneyMode === 'edit' || params.apimartMidjourneyMode === 'blend'
        ? params.apimartMidjourneyMode
        : 'imagine'
      const speed = params.apimartMidjourneySpeed === 'fast' || params.apimartMidjourneySpeed === 'turbo'
        ? params.apimartMidjourneySpeed
        : 'relax'
      const ratio = String(params.apimartMidjourneyAspectRatio || (mode === 'blend' ? '1:1' : 'smart'))

      if (mode === 'blend') {
        if (images.length < 2 || images.length > 4) throw new Error('Midjourney 混图模式只支持 2–4 张图片')
        return {
          image_urls: images,
          size: /^\d+:\d+$/u.test(ratio) ? ratio : '1:1',
          speed,
        }
      }

      const prompt = typeof params.prompt === 'string' ? params.prompt.trim() : ''
      if (!prompt) throw new Error(`Midjourney ${mode === 'edit' ? '编辑' : '生成'}模式的提示词不能为空`)
      if (mode === 'edit' && (images.length === 0 || images.length > 6)) {
        throw new Error('Midjourney 编辑模式需要 1–6 张待编辑图片')
      }
      const body: JsonObject = {
        prompt,
        speed,
        quality: ['0.25', '0.5', '2'].includes(String(params.apimartMidjourneyQuality))
          ? String(params.apimartMidjourneyQuality)
          : '1',
        stylize: Math.min(1000, Math.max(0, Math.round(Number(params.apimartMidjourneyStylize ?? 100)))),
        chaos: Math.min(100, Math.max(0, Math.round(Number(params.apimartMidjourneyChaos ?? 0)))),
        weird: Math.min(3000, Math.max(0, Math.round(Number(params.apimartMidjourneyWeird ?? 0)))),
        nsfw_check: false,
      }
      if (ratio !== 'smart' && /^\d+:\d+$/u.test(ratio)) body.size = ratio
      const requestedVersion = String(params.apimartMidjourneyVersion || 'auto')
      const niji = params.apimartMidjourneyNiji === true
      const version = niji && !['auto', '6', '7'].includes(requestedVersion) ? '7' : requestedVersion
      if (version !== 'auto') body.version = version
      if (niji) {
        body.niji = true
        if (version === 'auto' || !['6', '7'].includes(version)) body.version = '7'
      }
      if (images.length > 0) {
        body.image_urls = images.slice(0, 6)
        body.iw = Math.min(3, Math.max(0, Number(params.apimartMidjourneyImageWeight ?? 1)))
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
        ['dref', params.apimartMidjourneyDepthReference],
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
      const supportsStop = niji ? version === '6' : ['5.1', '5.2', '6', '6.1'].includes(version)
      if (stop < 100 && supportsStop) body.stop = stop
      if (typeof params.apimartMidjourneyExtra === 'string' && params.apimartMidjourneyExtra.trim()) {
        body.extra = params.apimartMidjourneyExtra.trim()
      }
      return body
    },
  },
  pricing: {
    currency: '$',
    calculator: (params) => {
      const mode = params.apimartMidjourneyMode === 'edit' || params.apimartMidjourneyMode === 'blend'
        ? params.apimartMidjourneyMode
        : 'imagine'
      const speed = params.apimartMidjourneySpeed === 'turbo'
        ? 'turbo'
        : (params.apimartMidjourneySpeed === 'fast' ? 'fast' : 'relax')
      if (mode === 'blend') return speed === 'turbo' ? 0.1 : 0.05504
      const repeat = Math.min(40, Math.max(1, Math.round(Number(params.apimartMidjourneyRepeat ?? 1))))
      if (mode === 'edit') return repeat * (speed === 'turbo' ? 0.1 : 0.05504)
      return repeat * (speed === 'turbo' ? 0.1 : (speed === 'fast' ? 0.05504 : 0.04504))
    },
    description: '生成、编辑与混图按当前模式、速度及生成数量计费',
  },
})

export default apimartMidjourneyModel
