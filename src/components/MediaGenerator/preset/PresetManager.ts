import { registry } from '@/core/ModelRegistry'

/**
 * 预设管理器（配置驱动）
 * 职责：加载/保存预设参数
 * 文件大小: < 200 行
 */
export class PresetManager {
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
  static loadPreset(presetData: any, modelId: string): Record<string, any> {
    const modelInfo = registry.getModelInfo(modelId)

    if (!modelInfo) {
      console.warn(`[PresetManager] Model not found: ${modelId}`)
      return {}
    }

    const params: Record<string, any> = {}

    // 从预设数据中提取参数
    modelInfo.params.forEach(param => {
      const presetValue = presetData[param.id]

      if (presetValue !== undefined) {
        params[param.id] = presetValue
      }
    })

    console.log(`[PresetManager] Loaded ${Object.keys(params).length} params for ${modelId}`)

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
  static savePreset(params: Record<string, any>, modelId: string): any {
    const modelInfo = registry.getModelInfo(modelId)

    if (!modelInfo) {
      console.warn(`[PresetManager] Model not found: ${modelId}`)
      return {}
    }

    const presetData: any = {}

    // 只保存模型相关的参数
    modelInfo.params.forEach(param => {
      const value = params[param.id]

      if (value !== undefined) {
        // 过滤掉不应该保存的参数（如上传的文件）
        if (this.shouldSaveParam(param.id)) {
          presetData[param.id] = value
        }
      }
    })

    console.log(`[PresetManager] Saved ${Object.keys(presetData).length} params for ${modelId}`)

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
    presetData: any,
    modelId: string,
    setParam: (key: string, value: any) => void
  ): void {
    const params = this.loadPreset(presetData, modelId)

    Object.entries(params).forEach(([key, value]) => {
      setParam(key, value)
    })

    console.log(`[PresetManager] Applied preset to ${modelId}`)
  }

  /**
   * 验证预设数据是否与模型兼容
   *
   * @param presetData - 预设数据对象
   * @param modelId - 模型 ID
   * @returns 是否兼容
   */
  static isCompatible(presetData: any, modelId: string): boolean {
    const modelInfo = registry.getModelInfo(modelId)

    if (!modelInfo) {
      return false
    }

    // 检查预设中的所有参数是否都在模型中定义
    const modelParamIds = new Set(modelInfo.params.map(p => p.id))
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
    presetData: any,
    currentParams: Record<string, any>,
    modelId: string
  ): Record<string, any> {
    const presetParams = this.loadPreset(presetData, modelId)

    return {
      ...currentParams,
      ...presetParams
    }
  }
}
