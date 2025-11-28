/**
 * 模型参数自动加载
 *
 * 所有模型的参数定义都在独立的文件中
 * 这个索引文件负责导出所有模型参数
 */

import { ParamDef } from '../types/schema'

// 派欧云模型
export { seedream40Params } from './seedream-4.0'
export { klingTurbo25Params } from './kling-2.5-turbo'
export { minimaxHailuo23Params } from './minimax-hailuo-2.3'
export { viduQ1Params } from './vidu-q1'
export { pixverseV45Params } from './pixverse-v4.5'
export { wan25PreviewParams } from './wan-2.5-preview'
export { seedanceV1Params } from './seedance-v1'
export { minimaxSpeech26BasicParams, minimaxSpeech26AdvancedParams } from './minimax-speech-2.6'

// Fal 模型
export { falAiNanoBananaParams } from './fal-ai-nano-banana'
export { falAiNanoBananaProParams } from './fal-ai-nano-banana-pro'
export { falAiVeo31Params } from './fal-ai-veo-3.1'
export { bytedanceSeedreamV4Params } from './bytedance-seedream-v4'
export { falAiZImageTurboParams } from './fal-ai-z-image-turbo'

// 魔搭模型
export { modelscopeCommonParams, modelscopeCustomParams } from './modelscope-common'

// 为了向后兼容，保留旧的导出名称
export { seedream40Params as seedreamParams } from './seedream-4.0'
export { klingTurbo25Params as klingParams } from './kling-2.5-turbo'
export { minimaxHailuo23Params as hailuoParams } from './minimax-hailuo-2.3'
export { viduQ1Params as viduParams } from './vidu-q1'
export { pixverseV45Params as pixverseParams } from './pixverse-v4.5'
export { wan25PreviewParams as wan25Params } from './wan-2.5-preview'
export { seedanceV1Params as seedanceParams } from './seedance-v1'
export { minimaxSpeech26BasicParams as minimaxSpeechBasicParams } from './minimax-speech-2.6'
export { minimaxSpeech26AdvancedParams as minimaxSpeechAdvancedParams } from './minimax-speech-2.6'
export { falAiNanoBananaParams as nanoBananaParams } from './fal-ai-nano-banana'
export { falAiNanoBananaProParams as nanoBananaProParams } from './fal-ai-nano-banana-pro'
export { falAiVeo31Params as veoParams } from './fal-ai-veo-3.1'

// 导入所有模型参数
import { seedream40Params } from './seedream-4.0'
import { klingTurbo25Params } from './kling-2.5-turbo'
import { minimaxHailuo23Params } from './minimax-hailuo-2.3'
import { viduQ1Params } from './vidu-q1'
import { pixverseV45Params } from './pixverse-v4.5'
import { wan25PreviewParams } from './wan-2.5-preview'
import { seedanceV1Params } from './seedance-v1'
import { minimaxSpeech26BasicParams, minimaxSpeech26AdvancedParams } from './minimax-speech-2.6'
import { falAiNanoBananaParams } from './fal-ai-nano-banana'
import { falAiNanoBananaProParams } from './fal-ai-nano-banana-pro'
import { falAiVeo31Params } from './fal-ai-veo-3.1'
import { bytedanceSeedreamV4Params } from './bytedance-seedream-v4'
import { falAiZImageTurboParams } from './fal-ai-z-image-turbo'
import { modelscopeCommonParams, modelscopeCustomParams } from './modelscope-common'

/**
 * 模型 ID 到 Schema 的映射表
 */
export const modelSchemaMap: Record<string, ParamDef[]> = {
  'seedream-4.0': seedream40Params,
  'kling-2.5-turbo': klingTurbo25Params,
  'minimax-hailuo-2.3': minimaxHailuo23Params,
  'minimax-hailuo-02': minimaxHailuo23Params, // Hailuo 02 使用相同的 Schema
  'vidu-q1': viduQ1Params,
  'pixverse-v4.5': pixverseV45Params,
  'wan-2.5-preview': wan25PreviewParams,
  'seedance-v1': seedanceV1Params,
  'seedance-v1-lite': seedanceV1Params,
  'seedance-v1-pro': seedanceV1Params,
  'minimax-speech-2.6': [...minimaxSpeech26BasicParams, ...minimaxSpeech26AdvancedParams],
  'nano-banana': falAiNanoBananaParams,
  'nano-banana-pro': falAiNanoBananaProParams,
  'veo3.1': falAiVeo31Params,
  'bytedance-seedream-v4': bytedanceSeedreamV4Params,
  'fal-ai-z-image-turbo': falAiZImageTurboParams,
  // 魔搭模型（预设模型使用通用参数）
  'Tongyi-MAI/Z-Image-Turbo': modelscopeCommonParams,
  'MusePublic/Qwen-image': modelscopeCommonParams,
  'black-forest-labs/FLUX.1-Krea-dev': modelscopeCommonParams,
  'MusePublic/14_ckpt_SD_XL': modelscopeCommonParams,
  'MusePublic/majicMIX_realistic': modelscopeCommonParams,
  // 自定义模型使用特殊参数（包含模型选择）
  'modelscope-custom': modelscopeCustomParams
}

/**
 * 获取模型的 Schema
 */
export function getModelSchema(modelId: string): ParamDef[] | undefined {
  return modelSchemaMap[modelId]
}

/**
 * 提取模型 Schema 中定义的所有默认值
 * @returns 包含所有默认值的对象 { paramId: defaultValue }
 */
export function getModelDefaultValues(modelId: string): Record<string, any> {
  const schema = getModelSchema(modelId)
  if (!schema) return {}

  const defaults: Record<string, any> = {}
  for (const param of schema) {
    if (param.defaultValue !== undefined) {
      defaults[param.id] = param.defaultValue
    }
  }
  return defaults
}

/**
 * 检查并应用模型 Schema 中定义的自动切换规则
 * @param modelId 模型 ID
 * @param currentValues 当前参数值
 * @returns 需要自动切换的参数 { paramId: newValue }
 */
export function getAutoSwitchValues(modelId: string, currentValues: any): Record<string, any> {
  const schema = getModelSchema(modelId)
  if (!schema) return {}

  const switches: Record<string, any> = {}
  for (const param of schema) {
    if (param.autoSwitch) {
      const shouldSwitch = param.autoSwitch.condition(currentValues)
      if (shouldSwitch) {
        // 获取目标值（支持函数类型）
        const targetValue = typeof param.autoSwitch.value === 'function'
          ? param.autoSwitch.value(currentValues)
          : param.autoSwitch.value

        // 只有当前值与目标值不同时才切换
        if (currentValues[param.id] !== targetValue) {
          switches[param.id] = targetValue
        }
      } else {
        // 条件不满足时，如果当前值是 autoSwitch 的值，则恢复为默认值
        const targetValue = typeof param.autoSwitch.value === 'function'
          ? param.autoSwitch.value(currentValues)
          : param.autoSwitch.value

        if (currentValues[param.id] === targetValue && param.defaultValue !== undefined) {
          switches[param.id] = param.defaultValue
        }
      }
    }
  }
  return switches
}

/**
 * 获取模型中启用智能匹配的参数
 * @param modelId 模型 ID
 * @returns 启用智能匹配的参数列表
 */
export function getSmartMatchParams(modelId: string): ParamDef[] {
  const schema = getModelSchema(modelId)
  if (!schema) return []

  return schema.filter(param => param.resolutionConfig?.smartMatch === true)
}

/**
 * 根据上传的图片，智能匹配最接近的参数值
 * @param modelId 模型 ID
 * @param imageDataUrl 图片的 Data URL
 * @param currentValues 当前参数值
 * @returns Promise<Record<string, any>> 需要更新的参数 { paramId: newValue }
 */
export async function getSmartMatchValues(
  modelId: string,
  imageDataUrl: string,
  currentValues: any
): Promise<Record<string, any>> {
  const { getImageAspectRatio, matchClosestAspectRatio } = await import('../utils/aspectRatio')

  const smartMatchParams = getSmartMatchParams(modelId)
  if (smartMatchParams.length === 0) return {}

  try {
    // 获取图片的宽高比
    const imageRatio = await getImageAspectRatio(imageDataUrl)

    const matches: Record<string, any> = {}
    for (const param of smartMatchParams) {
      const config = param.resolutionConfig!
      if (!config.extractRatio) continue

      // 只处理 dropdown 类型的参数
      if (param.type !== 'dropdown') continue

      // 获取当前参数的选项
      const dropdownParam = param as any
      let options = dropdownParam.options
      if (typeof options === 'function') {
        options = options(currentValues)
      }

      if (!Array.isArray(options)) continue

      // 过滤掉 'auto' 或 '智能' 选项
      const validOptions = options.filter((opt: any) => {
        const ratio = config.extractRatio!(opt.value)
        return ratio !== null
      })

      // 匹配最接近的值
      const matchedValue = matchClosestAspectRatio(
        imageRatio,
        validOptions,
        config.extractRatio
      )

      // 总是更新为匹配的值（智能匹配）
      matches[param.id] = matchedValue
    }

    return matches
  } catch (error) {
    console.error('[Smart Match] Failed to match aspect ratio:', error)
    return {}
  }
}
