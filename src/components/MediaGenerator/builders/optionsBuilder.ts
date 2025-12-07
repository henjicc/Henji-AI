/**
 * Options Builder - 配置驱动架构
 * 使用声明式配置构建模型参数
 */

import { optionsBuilder, registerAllConfigs } from './configs'
import { BuildContext } from './core/types'
import type { BuildOptionsParams } from './optionsBuilder.backup'

// 确保配置已注册（只注册一次）
let configsRegistered = false
function ensureConfigsRegistered() {
  if (!configsRegistered) {
    registerAllConfigs()
    configsRegistered = true
    console.log('[OptionsBuilder] Configuration-driven architecture initialized with 28 models')
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

  console.log(`[OptionsBuilder] Building options for ${selectedModel} using configuration-driven architecture`)

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

    console.log(`[OptionsBuilder] ✓ Successfully built options for ${selectedModel}`)
    return options

  } catch (error) {
    console.error(`[OptionsBuilder] ✗ Error building options for ${selectedModel}:`, error)
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

// 导出类型
export type { BuildOptionsParams }
