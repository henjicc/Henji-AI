import type { I18nText } from '../types/I18nText'

/**
 * 图片、视频、音频生成模型的通用描述。
 *
 * 这里只描述模型本身更擅长的方向、风格或相对定位，不重复 tags、参数 schema
 * 已经能够表达的固有能力。不同供应商接入同一个模型时复用同一条描述。
 *
 * 新模型适配流程：
 * 1. 供应商模型文件只填写 meta.canonicalModelId，不填写 meta.description。
 * 2. 若这里已有对应 key，直接复用。
 * 3. 若这里没有对应 key，先新增空描述，再由维护者补充文案。
 */
export const GENERATION_MODEL_DESCRIPTIONS = {
  // 图片模型
  'flux-1-krea-dev': { zh: '', en: '' },
  'gpt-image-2': { zh: '', en: '' },
  'grok-imagine-image': { zh: '', en: '' },
  'kling-image-o1': { zh: '', en: '' },
  'majicmix-realistic': { zh: '', en: '' },
  'modelscope-custom': { zh: '', en: '' },
  'nano-banana': { zh: '', en: '' },
  'nano-banana-pro': { zh: '', en: '' },
  'nano-banana-2': { zh: '', en: '' },
  'nano-banana-2-lite': { zh: '', en: '' },
  'qwen-image': { zh: '', en: '' },
  'qwen-image-edit-2509': { zh: '', en: '' },
  'sdxl-14-checkpoint': { zh: '', en: '' },
  'seedream-4.0': { zh: '', en: '' },
  'seedream-4.5': { zh: '', en: '' },
  'seedream-5.0-lite': { zh: '', en: '' },
  'seedream-5.0-pro': { zh: '', en: '' },
  'z-image': { zh: '', en: '' },
  'z-image-turbo': { zh: '', en: '' },

  // 视频模型
  'gemini-omni-video': { zh: '', en: '' },
  'grok-imagine-video': { zh: '', en: '' },
  'hailuo-02': { zh: '', en: '' },
  'hailuo-2.3': { zh: '', en: '' },
  'kling-video-o1': { zh: '', en: '' },
  'kling-video-2.5-turbo': { zh: '', en: '' },
  'kling-video-2.6-pro': { zh: '', en: '' },
  'kling-video-3.0': { zh: '', en: '' },
  'ltx-2': { zh: '', en: '' },
  'pixverse-v4.5': { zh: '', en: '' },
  'pixverse-v5.5': { zh: '', en: '' },
  'seedance-v1': { zh: '', en: '' },
  'seedance-1.5-pro': { zh: '', en: '' },
  'seedance-2.0': { zh: '', en: '' },
  'seedance-2.0-fast': { zh: '', en: '' },
  'seedance-2.0-mini': { zh: '', en: '' },
  'veo-3.1': { zh: '', en: '' },
  'vidu-q1': { zh: '', en: '' },
  'vidu-q2': { zh: '', en: '' },
  'vidu-q3': { zh: '', en: '' },
  'wan-2.5-preview': { zh: '', en: '' },
  'wan-2.6': { zh: '', en: '' },
  'wan-2.7': { zh: '', en: '' },

  // 音频模型
  'minimax-speech-2.8': { zh: '', en: '' },
} as const satisfies Record<string, I18nText>

export type CanonicalGenerationModelId = keyof typeof GENERATION_MODEL_DESCRIPTIONS

export function hasGenerationModelDescription(
  canonicalModelId: string
): canonicalModelId is CanonicalGenerationModelId {
  return Object.prototype.hasOwnProperty.call(GENERATION_MODEL_DESCRIPTIONS, canonicalModelId)
}

export function getGenerationModelDescription(
  canonicalModelId: string
): I18nText | undefined {
  if (!hasGenerationModelDescription(canonicalModelId)) return undefined
  const description = GENERATION_MODEL_DESCRIPTIONS[canonicalModelId]
  return description.zh.trim() || description.en.trim() ? description : undefined
}
