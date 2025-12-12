/**
 * 配置驱动架构 - 核心构建器
 */

import {
  ModelConfig,
  BuildContext
} from './types'
import {
  handleSmartMatch,
  handleImageUpload,
  handleVideoUpload,
  getParamValue
} from './handlers'

/**
 * Options 构建器
 */
export class OptionsBuilder {
  private configs: Map<string, ModelConfig> = new Map()

  /**
   * 注册模型配置
   */
  registerConfig(config: ModelConfig): void {
    this.configs.set(config.id, config)
  }

  /**
   * 批量注册模型配置
   */
  registerConfigs(configs: ModelConfig[]): void {
    configs.forEach(config => this.registerConfig(config))
  }

  /**
   * 获取模型配置
   */
  getConfig(modelId: string): ModelConfig | undefined {
    return this.configs.get(modelId)
  }

  /**
   * 构建 options
   */
  async build(context: BuildContext): Promise<Record<string, any>> {
    const config = this.configs.get(context.selectedModel)

    if (!config) {
      throw new Error(`No configuration found for model: ${context.selectedModel}`)
    }

    const options: Record<string, any> = {}

    // 1. 执行 beforeBuild 处理器
    if (config.customHandlers?.beforeBuild) {
      await config.customHandlers.beforeBuild(context.params, context)
    }

    // 2. 验证参数
    if (config.customHandlers?.validateParams) {
      config.customHandlers.validateParams(context.params)
    }

    // 3. 处理模式切换（如果有）
    let effectiveConfig = config
    if (config.features?.modeSwitch) {
      effectiveConfig = this.resolveModeConfig(config, context)
    }

    // 4. 映射参数
    await this.mapParameters(options, effectiveConfig, context)

    // 5. 处理智能匹配
    if (effectiveConfig.features?.smartMatch) {
      await handleSmartMatch(options, effectiveConfig.features.smartMatch, context)

      // 重新应用 transform 到 smartMatch 参数
      // smartMatch 可能会将 'smart' 转换为实际比例（如 '16:9'），需要再次转换为 API 格式（如 'landscape'）
      const paramKey = effectiveConfig.features.smartMatch.paramKey
      const mapping = effectiveConfig.paramMapping[paramKey]
      if (mapping && typeof mapping === 'object' && mapping.transform) {
        const currentValue = options[paramKey]
        if (currentValue !== undefined && currentValue !== 'smart') {
          options[paramKey] = mapping.transform(currentValue, context)
        }
      }
    }

    // 6. 处理图片上传
    if (effectiveConfig.features?.imageUpload) {
      await handleImageUpload(options, effectiveConfig.features.imageUpload, context)
    }

    // 7. 处理视频上传
    if (effectiveConfig.features?.videoUpload) {
      await handleVideoUpload(options, effectiveConfig.features.videoUpload, context)
    }

    // 8. 执行 afterBuild 处理器
    if (config.customHandlers?.afterBuild) {
      await config.customHandlers.afterBuild(options, context)
    }

    return options
  }

  /**
   * 解析模式特定配置
   */
  private resolveModeConfig(config: ModelConfig, context: BuildContext): ModelConfig {
    const modeSwitchConfig = config.features!.modeSwitch!
    const currentMode = context.params[modeSwitchConfig.modeParamKey]

    if (!currentMode) {
      return config
    }

    const modeConfig = modeSwitchConfig.configs[currentMode]
    if (!modeConfig) {
      return config
    }

    // 合并模式特定配置
    return {
      ...config,
      paramMapping: {
        ...config.paramMapping,
        ...(modeConfig.paramMapping || {})
      },
      features: {
        ...config.features,
        ...(modeConfig.features || {})
      }
    }
  }

  /**
   * 映射参数
   */
  private async mapParameters(
    options: Record<string, any>,
    config: ModelConfig,
    context: BuildContext
  ): Promise<void> {
    for (const [optionKey, rule] of Object.entries(config.paramMapping)) {
      // 处理简单映射（字符串形式）
      if (typeof rule === 'string') {
        const value = context.params[rule]
        if (value !== undefined) {
          options[optionKey] = value
        }
        continue
      }

      // 处理复杂映射（对象形式）

      // 检查条件
      if (rule.condition && !rule.condition(context)) {
        continue
      }

      // 获取值
      let value = getParamValue(rule.source, context)

      // 使用默认值
      if (value === undefined && rule.defaultValue !== undefined) {
        value = rule.defaultValue
      }

      // 应用转换
      if (value !== undefined && rule.transform) {
        value = rule.transform(value, context)
      }

      // 设置值
      if (value !== undefined) {
        options[optionKey] = value
      }
    }
  }
}

/**
 * 创建全局 OptionsBuilder 实例
 */
export const optionsBuilder = new OptionsBuilder()
