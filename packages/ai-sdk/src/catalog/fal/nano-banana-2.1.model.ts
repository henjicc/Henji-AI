import { defineModel } from '../defineModel'
import type { JsonObject } from '../../types/runtime'
import { resolveUploadedImageSources, resolveUploadedVideoSources } from '../shared/mediaPresence'
import { NANO21_RATIOS, NANO21_RESOLUTIONS, nano21Choice, nano21Count, nano21Options, nano21Prompt, nano21Ratio } from '../shared/nanoBanana21'

function pdfSource(params: JsonObject): string | undefined {
  const values = params.falNanoBanana21Pdf
  if (values === undefined) return undefined
  if (!Array.isArray(values) || values.length > 1 || values.some(v => typeof v !== 'string')) throw new Error('PDF 上下文需要上传一份文件')
  return values.find((v): v is string => typeof v === 'string' && v.trim().length > 0)
}

export const falNanoBanana21Model = defineModel({
  meta: {
    id: 'fal-ai-nano-banana-2.1', canonicalModelId: 'nano-banana-2.1', seriesId: 'nano-banana', seriesRank: 2.1,
    provider: 'fal', type: 'image',
    tags: ['text-to-image', 'image-to-image', 'supports-image-editing', 'supports-multi-image', 'supports-4k', 'provider-fal'],
    polling: { interval: 3000, maxAttempts: 200, expectedAttempts: 40 },
  },
  inputLimits: { images: {}, videos: { max: 1 }, audios: { max: 0 }, rules: [{ videoConstraints: { maxSizeMB: 15 } }] },
  params: [
    { id: 'falNanoBanana21AspectRatio', type: 'dropdown', order: 1, default: 'smart', options: nano21Options(['smart', ...NANO21_RATIOS]) },
    { id: 'falNanoBanana21Resolution', type: 'dropdown', order: 2, default: '1K', options: nano21Options(NANO21_RESOLUTIONS) },
    { id: 'falNanoBanana21NumImages', type: 'number', order: 3, default: 1, min: 1, max: 4, step: 1 },
    { id: 'falNanoBanana21WebSearch', type: 'switch', order: 4, default: false },
    { id: 'falNanoBanana21Thinking', type: 'dropdown', order: 5, default: 'medium', options: nano21Options(['minimal', 'medium', 'high']) },
    { id: 'falNanoBanana21Pdf', type: 'file-upload', order: 6, default: [], valueType: 'array', maxCount: 1, accept: ['application/pdf'], maxSize: 15 * 1024 * 1024 },
    { id: 'falNanoBanana21SystemPrompt', type: 'text', order: 7, default: '' },
    { id: 'falNanoBanana21OutputFormat', type: 'dropdown', order: 8, default: 'png', options: nano21Options(['png', 'jpeg', 'webp']) },
    { id: 'falNanoBanana21LimitGenerations', type: 'switch', order: 9, default: true },
  ],
  runtimeConstraints: { mediaFields: [{ field: 'pdf_url', kind: 'file' }] },
  endpoints: { selector: async params => resolveUploadedImageSources(params).length || resolveUploadedVideoSources(params).length || pdfSource(params)
    ? 'google/nano-banana-2.1/edit' : 'google/nano-banana-2.1' },
  request: { builder: params => {
    const images = resolveUploadedImageSources(params)
    const videos = resolveUploadedVideoSources(params)
    if (videos.length > 1) throw new Error('Nano Banana 2.1 Fal 最多支持一段参考视频（15MB）')
    const body: JsonObject = {
      prompt: nano21Prompt(params), aspect_ratio: nano21Ratio(params.falNanoBanana21AspectRatio),
      resolution: nano21Choice(params.falNanoBanana21Resolution, NANO21_RESOLUTIONS, '1K'),
      num_images: nano21Count(params.falNanoBanana21NumImages, 4),
      thinking_level: nano21Choice(params.falNanoBanana21Thinking, ['minimal', 'medium', 'high'], 'medium'),
      output_format: nano21Choice(params.falNanoBanana21OutputFormat, ['png', 'jpeg', 'webp'], 'png'),
      enable_web_search: params.falNanoBanana21WebSearch === true,
      limit_generations: params.falNanoBanana21LimitGenerations !== false,
    }
    if (images.length) body.image_urls = images
    if (videos.length) body.video_url = videos[0]
    const pdf = pdfSource(params)
    if (pdf) body.pdf_url = pdf
    if (typeof params.falNanoBanana21SystemPrompt === 'string' && params.falNanoBanana21SystemPrompt.trim()) body.system_prompt = params.falNanoBanana21SystemPrompt
    return body
  } },
  pricing: {
    currency: '$', calculator: params => {
      // Fal 官方约 100 Token 短提示词、medium 思考的代表性成本；不是按张固定收费。
      const representative = { '1K': 0.04, '2K': 0.059, '4K': 0.134 }[String(params.falNanoBanana21Resolution ?? '1K')] ?? 0.04
      return (representative + resolveUploadedImageSources(params).length * 0.002) * nano21Count(params.falNanoBanana21NumImages, 4)
    },
    description: '按实际 Token 计费：每百万输入 $1.764、文字/思考输出 $8.823、图像输出 $35.294。短提示词与 medium 思考参考估算 1K $0.040、2K $0.059、4K $0.134；每张 1K 参考图约增 $0.002。搜索、思考没有固定附加费，视频/PDF/搜索内容及长提示词按实际用量结算。',
  },
})
export default falNanoBanana21Model
