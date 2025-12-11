/**
 * Options Builder - 配置驱动架构
 * 使用声明式配置构建模型参数
 */

import { optionsBuilder, registerAllConfigs } from './configs'
import { BuildContext, BuildOptionsParams } from './core/types'
import { logError, logInfo } from '../../../utils/errorLogger'

// 确保配置已注册（只注册一次）
let configsRegistered = false
function ensureConfigsRegistered() {
  if (!configsRegistered) {
    registerAllConfigs()
    configsRegistered = true
    logInfo('', '[OptionsBuilder] Configuration-driven architecture initialized with 28 models')
  }
}

/**
 * 构建生成选项 - 使用配置驱动架构
 * @param params 构建参数
 * @returns 生成选项对象
 */
export async function buildGenerateOptions(params: BuildOptionsParams): Promise<any> {
  ensureConfigsRegistered()

  const { selectedModel, uploadedImages, uploadedVideos } = params

  // 检查是否有配置
  const config = optionsBuilder.getConfig(selectedModel)

  if (!config) {
    throw new Error(
      `[OptionsBuilder] No configuration found for model: ${selectedModel}. ` +
      `Please add model configuration in configs/ directory.`
    )
  }

  logInfo('', `[OptionsBuilder] Building options for ${selectedModel} using configuration-driven architecture`)

  try {
    // 将参数格式转换为 BuildContext 格式
    const context: BuildContext = {
      selectedModel,
      params: convertParamsToContext(params),
      uploadedImages: uploadedImages || [],
      uploadedVideos: uploadedVideos || [],
      prompt: (params as any).prompt,
      negativePrompt: (params as any).negativePrompt
    }

    // 使用配置驱动的 OptionsBuilder 构建选项
    const options = await optionsBuilder.build(context)

    logInfo('', `[OptionsBuilder] ✓ Successfully built options for ${selectedModel}`)
    logInfo(`[OptionsBuilder] Built options keys:`, Object.keys(options))
    logInfo(`[OptionsBuilder] Built options:`, options)
    return options

  } catch (error) {
    logError(`[OptionsBuilder] ✗ Error building options for ${selectedModel}:`, error)
    throw error
  }
}

/**
 * 将参数格式转换为上下文格式
 */
function convertParamsToContext(params: BuildOptionsParams): Record<string, any> {
  // 直接返回所有参数，使用类型断言避免类型检查问题
  // 这样可以确保所有参数都被传递，而不会因为类型不匹配而报错
  return params as any
}

/**
 * 反向映射：将 API 参数转换回 UI 状态参数
 * 用于从历史记录恢复参数时使用
 * @param modelId 模型 ID
 * @param apiOptions API 参数对象
 * @returns UI 状态参数对象
 */
export function reverseMapOptions(modelId: string, apiOptions: Record<string, any>): Record<string, any> {
  ensureConfigsRegistered()

  logInfo('[OptionsBuilder] ReverseMap - Model:', modelId)
  logInfo('[OptionsBuilder] ReverseMap - API options keys:', Object.keys(apiOptions))

  const config = optionsBuilder.getConfig(modelId)
  if (!config || !config.paramMapping) {
    logInfo('[OptionsBuilder] ReverseMap - No config or paramMapping, returning original options', {})
    // 如果没有配置，直接返回原始参数
    return apiOptions
  }

  logInfo('[OptionsBuilder] ReverseMap - ParamMapping keys:', Object.keys(config.paramMapping))

  const uiParams: Record<string, any> = {}

  // 遍历配置中的参数映射
  for (const [apiKey, mapping] of Object.entries(config.paramMapping)) {
    // 检查 API 参数中是否有这个 key
    if (!(apiKey in apiOptions)) {
      logInfo('', `[OptionsBuilder] ReverseMap - Skipped (not in API options): ${apiKey}`)
      continue
    }

    const value = apiOptions[apiKey]

    // 获取 UI 参数名
    let uiKey: string | undefined

    if (typeof mapping === 'string') {
      // 简单映射：直接使用字符串作为 UI 参数名
      uiKey = mapping
    } else if (typeof mapping === 'object' && mapping !== null) {
      // 复杂映射：从 source 中获取
      if ('source' in mapping) {
        const source = mapping.source
        if (typeof source === 'string') {
          uiKey = source
        } else if (Array.isArray(source) && source.length > 0) {
          // 使用 source 数组的第一个值（模型特定参数）
          uiKey = source[0]
        }
      }
    }

    // 如果找到了 UI 参数名，添加到结果中
    if (uiKey) {
      uiParams[uiKey] = value
      logInfo('', `[OptionsBuilder] ReverseMap - Mapped: ${apiKey} -> ${uiKey} = ${JSON.stringify(value)}`)
    } else {
      logInfo('', `[OptionsBuilder] ReverseMap - No UI key found for: ${apiKey}`)
    }
  }

  logInfo('', `[OptionsBuilder] ReverseMap - Result: ${Object.keys(uiParams).length} parameters`)
  logInfo('[OptionsBuilder] ReverseMap - UI params:', uiParams)

  return uiParams
}
