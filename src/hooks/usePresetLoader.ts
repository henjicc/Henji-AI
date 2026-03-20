import { createLogger } from '@/core/logging'

const logger = createLogger('hooks.usePresetLoader')
/**
 * usePresetLoader Hook
 *
 * 预设加载 Hook，负责将预设应用到当前模型
 */

import { useCallback } from 'react'
import type { Preset } from '@/core/types/Preset'
import { useModelParams } from './useModelParams'
import { registry } from '@/core/ModelRegistry'

/**
 * 预设应用结果
 */
export interface PresetApplyResult {
  /** 成功应用的参数数量 */
  applied: number
  /** 被忽略的参数数量 */
  ignored: number
  /** 被忽略的参数列表 */
  ignoredParams: string[]
}

/**
 * 预设加载 Hook
 *
 * @param currentModelId - 当前模型 ID
 * @returns 预设加载接口
 *
 * @example
 * ```tsx
 * function VideoGenerator({ modelId }: { modelId: string }) {
 *   const { applyPreset, createPresetFromCurrent } = usePresetLoader(modelId)
 *
 *   const handleApplyPreset = (preset: Preset) => {
 *     const result = applyPreset(preset)
 *     logger.info(`Applied ${result.applied} params, ignored ${result.ignored}`)
 *   }
 *
 *   const handleSavePreset = () => {
 *     const presetData = createPresetFromCurrent('My Preset', 'Description')
 *     // Save to database...
 *   }
 * }
 * ```
 */
export function usePresetLoader(currentModelId: string) {
  const { setParams, params } = useModelParams(currentModelId)

  /**
   * 应用预设到当前模型
   */
  const applyPreset = useCallback((preset: Preset): PresetApplyResult => {
    // 检查预设是否兼容当前模型
    if (preset.modelId && preset.modelId !== currentModelId) {
      logger.warn(
        `[PresetLoader] Preset is for model ${preset.modelId}, but current model is ${currentModelId}`
      )
    }

    // 获取当前模型的参数定义
    const schema = registry.getSchema(currentModelId)
    const validParamIds = new Set(schema.map(p => p.id))

    // 过滤出有效参数（忽略无效参数）
    const validParams: Record<string, any> = {}
    const ignoredParams: string[] = []

    for (const [key, value] of Object.entries(preset.params)) {
      if (validParamIds.has(key)) {
        validParams[key] = value
      } else {
        ignoredParams.push(key)
        logger.debug(`[PresetLoader] Ignoring invalid parameter: ${key}`)
      }
    }

    // 应用参数
    setParams(validParams)

    return {
      applied: Object.keys(validParams).length,
      ignored: ignoredParams.length,
      ignoredParams
    }
  }, [currentModelId, setParams])

  /**
   * 从当前参数创建预设数据
   */
  const createPresetFromCurrent = useCallback((
    name: string,
    description?: string
  ) => {
    return {
      name,
      description,
      modelId: currentModelId,
      params: { ...params }
    }
  }, [currentModelId, params])

  return {
    applyPreset,
    createPresetFromCurrent
  }
}

