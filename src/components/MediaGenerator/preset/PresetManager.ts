import { createLogger } from '@/core/logging'
import { registry } from '@/core/ModelRegistry'
import type { ModelDefinition } from '@/core/types'

const logger = createLogger('components.MediaGenerator.preset.PresetManager')

/**
 * 预设管理器（配置驱动）
 * 职责：加载/保存预设参数
 * 文件大小: < 200 行
 */
export class PresetManager {
  private static getModelOrWarn(modelId: string): ModelDefinition | null {
    const model = registry.getModel(modelId)
    if (!model) {
      logger.warn(`[PresetManager] Model not found: ${modelId}`)
      return null
    }
    return model
  }

  /**
   * 从预设加载参数
   *
   * @param presetData - 预设数据对象
   * @param modelId - 模型 ID
   * @returns 参数对象
   *
   * @example
   * ```typescript
   * const params = PresetManager.loadPreset(
   *   { duration: 10, aspectRatio: '16:9' },
   *   'wan-2.6'
   * )
   * // { duration: 10, aspectRatio: '16:9' }
   * ```
   */
  static loadPreset(presetData: Record<string, unknown>, modelId: string): Record<string, unknown> {
    const model = this.getModelOrWarn(modelId)
    if (!model) return {}

    const params: Record<string, unknown> = {}

    for (const paramDef of model.params) {
      const presetValue = presetData[paramDef.id]
      if (presetValue !== undefined) {
        params[paramDef.id] = presetValue
      }
    }

    logger.info(`[PresetManager] Loaded ${Object.keys(params).length} params for ${modelId}`)
    return params
  }

  /**
   * 保存参数为预设
   *
   * @param params - 当前参数对象
   * @param modelId - 模型 ID
   * @returns 预设数据对象
   *
   * @example
   * ```typescript
   * const presetData = PresetManager.savePreset(
   *   { duration: 10, aspectRatio: '16:9', uploadedImages: [...] },
   *   'wan-2.6'
   * )
   * // { duration: 10, aspectRatio: '16:9' }
   * // (uploadedImages 被过滤掉)
   * ```
   */
  static savePreset(params: Record<string, unknown>, modelId: string): Record<string, unknown> {
    const model = this.getModelOrWarn(modelId)
    if (!model) return {}

    const presetData: Record<string, unknown> = {}

    for (const paramDef of model.params) {
      const value = params[paramDef.id]
      if (value !== undefined && this.shouldSaveParam(paramDef.id)) {
        presetData[paramDef.id] = value
      }
    }

    logger.info(`[PresetManager] Saved ${Object.keys(presetData).length} params for ${modelId}`)
    return presetData
  }

  /**
   * 判断参数是否应该保存到预设
   *
   * @param paramId - 参数 ID
   * @returns 是否应该保存
   */
  private static shouldSaveParam(paramId: string): boolean {
    // 不保存的参数类型
    const excludeParams = [
      'uploadedImages',
      'uploadedVideos',
      'uploadedFilePaths',
      'uploadedVideoFilePaths',
      'uploadedVideoDuration',
      'fileOrder'
    ]

    return !excludeParams.includes(paramId)
  }

  /**
   * 批量加载预设到参数状态
   *
   * @param presetData - 预设数据对象
   * @param modelId - 模型 ID
   * @param setParam - 参数设置函数
   *
   * @example
   * ```typescript
   * PresetManager.applyPreset(
   *   presetData,
   *   'wan-2.6',
   *   (key, value) => modelState.setParam(key, value)
   * )
   * ```
   */
  static applyPreset(
    presetData: Record<string, unknown>,
    modelId: string,
    setParam: (key: string, value: unknown) => void
  ): void {
    const params = this.loadPreset(presetData, modelId)

    Object.entries(params).forEach(([key, value]) => {
      setParam(key, value)
    })

    logger.info(`[PresetManager] Applied preset to ${modelId}`)
  }

  /**
   * 验证预设数据是否与模型兼容
   *
   * @param presetData - 预设数据对象
   * @param modelId - 模型 ID
   * @returns 是否兼容
   */
  static isCompatible(presetData: Record<string, unknown>, modelId: string): boolean {
    const model = this.getModelOrWarn(modelId)
    if (!model) return false

    const modelParamIds = new Set(model.params.map((p) => p.id))
    const presetParamIds = Object.keys(presetData)

    // 计算兼容度
    const compatibleParams = presetParamIds.filter(id => modelParamIds.has(id))
    const compatibilityRatio = compatibleParams.length / presetParamIds.length

    // 如果至少 50% 的参数兼容，则认为兼容
    return compatibilityRatio >= 0.5
  }

  /**
   * 合并预设数据和当前参数
   *
   * @param presetData - 预设数据对象
   * @param currentParams - 当前参数对象
   * @param modelId - 模型 ID
   * @returns 合并后的参数对象
   */
  static merge(
    presetData: Record<string, unknown>,
    currentParams: Record<string, unknown>,
    modelId: string
  ): Record<string, unknown> {
    const presetParams = this.loadPreset(presetData, modelId)

    return {
      ...currentParams,
      ...presetParams
    }
  }
}

