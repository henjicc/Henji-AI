/** APIMart Midjourney Imagine 图片生成模型 */

import { defineModel, sharedFieldText, sharedOptionText } from '@/core'

export const apimartMidjourneyModel = defineModel({
  meta: {
    id: 'apimart-midjourney',
    canonicalModelId: 'midjourney',
    seriesId: 'midjourney',
    seriesRank: 1,
    provider: 'apimart',
    type: 'image',
    i18nScope: 'models.defs.apimart-midjourney',
    name: { key: 'meta.name', fallback: 'Midjourney Imagine' },
    tags: ['text-to-image', 'image-to-image', 'supports-multi-image', 'provider-apimart'],
    aliases: ['midjourney-apimart'],
    polling: { interval: 3000, maxAttempts: 300, expectedAttempts: 80 }
  },
  inputLimits: { videos: { max: 0 }, audios: { max: 0 } },
  params: [
    {
      id: 'apimartMidjourneyAspectRatio', type: 'dropdown', order: 1,
      name: sharedFieldText('aspectRatio'), default: 'smart',
      options: [
        { value: 'smart', label: sharedOptionText('smart') },
        ...['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9'].map((value) => ({ value, label: value }))
      ]
    },
    {
      id: 'apimartMidjourneySpeed', type: 'dropdown', order: 2,
      name: { zh: '生成速度', en: 'Generation Speed' }, default: 'relax',
      options: [
        { value: 'relax', label: { zh: '休闲', en: 'Relax' } },
        { value: 'fast', label: { zh: '快速', en: 'Fast' } },
        { value: 'turbo', label: { zh: '极速', en: 'Turbo' } }
      ]
    },
    {
      id: 'apimartMidjourneyQuality', type: 'dropdown', order: 3,
      name: { zh: '生成质量', en: 'Quality' }, default: '1',
      options: ['0.25', '0.5', '1', '2'].map((value) => ({ value, label: value }))
    },
    {
      id: 'apimartMidjourneyVersion', type: 'dropdown', order: 4,
      name: { zh: '模型版本', en: 'Model Version' }, default: 'auto',
      options: [
        { value: 'auto', label: sharedOptionText('auto') },
        ...['8.2', '8.1', '7', '6.1', '6', '5.2', '5.1'].map((value) => ({ value, label: value }))
      ]
    },
    {
      id: 'apimartMidjourneyNiji', type: 'switch', order: 5,
      name: { zh: 'Niji 动漫模型', en: 'Niji Anime Model' }, default: false
    },
    {
      id: 'apimartMidjourneyStylize', type: 'number', order: 6,
      name: { zh: '风格化强度', en: 'Stylize' }, default: 100, min: 0, max: 1000, step: 1
    },
    {
      id: 'apimartMidjourneyChaos', type: 'number', order: 7,
      name: { zh: '混沌度', en: 'Chaos' }, default: 0, min: 0, max: 100, step: 1
    },
    {
      id: 'apimartMidjourneyWeird', type: 'number', order: 8,
      name: { zh: '怪异度', en: 'Weird' }, default: 0, min: 0, max: 3000, step: 1
    },
    {
      id: 'apimartMidjourneyImageWeight', type: 'number', order: 9,
      name: { zh: '垫图权重', en: 'Image Weight' }, default: 1, min: 0, max: 3, step: 0.1
    },
    {
      id: 'apimartMidjourneyTile', type: 'switch', order: 10,
      name: { zh: '无缝平铺', en: 'Seamless Tile' }, default: false
    },
    {
      id: 'apimartMidjourneyRaw', type: 'switch', order: 11,
      name: { zh: '原始风格', en: 'Raw Style' }, default: false
    },
    {
      id: 'apimartMidjourneyDraft', type: 'switch', order: 12,
      name: { zh: '草图模式', en: 'Draft Mode' }, default: false
    },
    {
      id: 'apimartMidjourneyHd', type: 'switch', order: 13,
      name: { zh: 'HD 高清', en: 'HD' }, default: false
    },
    {
      id: 'apimartMidjourneyRepeat', type: 'number', order: 14,
      name: { zh: '重复生成', en: 'Repeat' }, default: 1, min: 1, max: 40, step: 1
    },
    {
      id: 'apimartMidjourneyCharacterReference', type: 'text', order: 15,
      name: { zh: '角色参考图 URL', en: 'Character Reference URL' }, default: ''
    },
    {
      id: 'apimartMidjourneyStyleReference', type: 'text', order: 16,
      name: { zh: '风格参考图 URL', en: 'Style Reference URL' }, default: ''
    },
    {
      id: 'apimartMidjourneyDepthReference', type: 'text', order: 17,
      name: { zh: '深度参考图 URL', en: 'Depth Reference URL' }, default: ''
    },
    {
      id: 'apimartMidjourneyDepthWeight', type: 'number', order: 18,
      name: { zh: '深度权重', en: 'Depth Weight' }, default: 100, min: 0, max: 100, step: 1
    },
    {
      id: 'apimartMidjourneyCharacterWeight', type: 'number', order: 19,
      name: { zh: '角色权重', en: 'Character Weight' }, default: 100, min: 0, max: 100, step: 1
    },
    {
      id: 'apimartMidjourneyStyleWeight', type: 'number', order: 20,
      name: { zh: '风格权重', en: 'Style Weight' }, default: 100, min: 0, max: 1000, step: 1
    },
    {
      id: 'apimartMidjourneyStop', type: 'number', order: 21,
      name: { zh: '提前停止', en: 'Stop' }, default: 100, min: 10, max: 100, step: 1
    },
    {
      id: 'apimartMidjourneyExtra', type: 'textarea', order: 22,
      name: { zh: '额外 Midjourney 参数', en: 'Extra Midjourney Parameters' },
      description: { zh: '原样追加到提示词末尾', en: 'Appended to the prompt unchanged' },
      default: '', rows: 2
    }
  ],
  linkages: [],
  endpoints: '/v1/midjourney/generations',
  request: {
    builder: (params) => {
      const clean = (value: DynamicValue): string[] => Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : []
      const uploaded = clean(params.uploadedFilePaths)
      const images = uploaded.length > 0 ? uploaded : clean(params.images)
      const prompt = typeof params.prompt === 'string' ? params.prompt.trim() : ''
      if (!prompt) throw new Error('Midjourney Imagine 的提示词不能为空')
      const body: DynamicValueMap = {
        prompt,
        speed: params.apimartMidjourneySpeed === 'fast' || params.apimartMidjourneySpeed === 'turbo'
          ? params.apimartMidjourneySpeed
          : 'relax',
        quality: ['0.25', '0.5', '2'].includes(String(params.apimartMidjourneyQuality))
          ? String(params.apimartMidjourneyQuality)
          : '1',
        stylize: Math.min(1000, Math.max(0, Math.round(Number(params.apimartMidjourneyStylize ?? 100)))),
        chaos: Math.min(100, Math.max(0, Math.round(Number(params.apimartMidjourneyChaos ?? 0)))),
        weird: Math.min(3000, Math.max(0, Math.round(Number(params.apimartMidjourneyWeird ?? 0)))),
        nsfw_check: false
      }
      const ratio = String(params.apimartMidjourneyAspectRatio || 'smart')
      if (ratio !== 'smart' && /^\d+:\d+$/u.test(ratio)) body.size = ratio
      const version = String(params.apimartMidjourneyVersion || 'auto')
      if (version !== 'auto') body.version = version
      if (params.apimartMidjourneyNiji === true) {
        body.niji = true
        if (version === 'auto' || !['6', '7'].includes(version)) body.version = '7'
      }
      if (images.length > 0) {
        body.image_urls = images
        body.iw = Math.min(3, Math.max(0, Number(params.apimartMidjourneyImageWeight ?? 1)))
      }
      if (params.apimartMidjourneyTile === true) body.tile = true
      if (params.apimartMidjourneyRaw === true) body.raw = true
      if (params.apimartMidjourneyDraft === true) body.draft = true
      if (params.apimartMidjourneyHd === true) body.hd = true
      const repeat = Math.min(40, Math.max(1, Math.round(Number(params.apimartMidjourneyRepeat ?? 1))))
      if (repeat > 1) body.repeat = repeat
      const references = [
        ['cref', params.apimartMidjourneyCharacterReference],
        ['sref', params.apimartMidjourneyStyleReference],
        ['dref', params.apimartMidjourneyDepthReference]
      ] as const
      for (const [field, value] of references) {
        if (typeof value === 'string' && value.trim()) body[field] = value.trim()
      }
      if (body.cref) body.cw = Math.min(100, Math.max(0, Math.round(Number(params.apimartMidjourneyCharacterWeight ?? 100))))
      if (body.sref) body.sw = Math.min(1000, Math.max(0, Math.round(Number(params.apimartMidjourneyStyleWeight ?? 100))))
      if (body.dref) body.dw = Math.min(100, Math.max(0, Number(params.apimartMidjourneyDepthWeight ?? 100)))
      const stop = Math.min(100, Math.max(10, Math.round(Number(params.apimartMidjourneyStop ?? 100))))
      if (stop < 100) body.stop = stop
      if (typeof params.apimartMidjourneyExtra === 'string' && params.apimartMidjourneyExtra.trim()) {
        body.extra = params.apimartMidjourneyExtra.trim()
      }
      return body
    }
  },
  pricing: {
    currency: '$',
    calculator: (params) => {
      const speed = params.apimartMidjourneySpeed === 'turbo'
        ? 'turbo'
        : (params.apimartMidjourneySpeed === 'fast' ? 'fast' : 'relax')
      const repeat = Math.min(40, Math.max(1, Math.round(Number(params.apimartMidjourneyRepeat ?? 1))))
      return repeat * (speed === 'turbo' ? 0.1 : (speed === 'fast' ? 0.05504 : 0.04504))
    },
    description: 'Imagine Relax/Fast/Turbo 为 $0.04504/$0.05504/$0.1 每次；repeat 按次数倍增'
  }
})

export default apimartMidjourneyModel
