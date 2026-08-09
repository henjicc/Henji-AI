/**
 * useModelParams Hook
 *
 * 动态参数管理 Hook，替代 640 行、160+ useState 的状态管理
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { registry } from '@/core/ModelRegistry'
import type { ParamDef } from '@/core/types'
import { extractDefaults, validateParamValue, getParamDisplayName } from './utils/defaultExtractor'
import { setNestedValue, getNestedValue, batchSetNestedValues } from './utils/paramUtils'
import { ParamFlowTracker } from '@/core/debug/ParamFlowTracker'
import type { ParamFlowRecord } from '@/core/debug/types'
import { transferModelParamOverridesBetweenModels } from '@/core/params/modelParamTransfer'
import {
  reconcileGenerationParams,
  resolveGenerationParamOptions,
} from '@/features/generation/domain/generationParams'

/**
 * Hook 返回值接口
 */
export interface UseModelParamsReturn {
  /**
   * 当前参数值
   */
  params: DynamicValueMap

  /**
   * 设置单个参数
   */
  setParam: (key: string, value: DynamicValue) => void

  /**
   * 批量设置参数
   */
  setParams: (values: DynamicValueMap) => void

  /**
   * 重置所有参数为默认值
   */
  resetParams: () => void

  /**
   * 重置单个参数为默认值
   */
  resetParam: (key: string) => void

  /**
   * 获取过滤后的选项（用于 dropdown 和 radio）
   */
  getFilteredOptions: (paramId: string) => DynamicValue[]

  /**
   * 获取参数定义
   */
  getParamDef: (paramId: string) => ParamDef | undefined

  /**
   * 验证参数值
   */
  validateParam: (paramId: string, value: DynamicValue) => boolean

  /**
   * 参数 Schema
   */
  schema: ParamDef[]

  /**
   * 默认值
   */
  defaults: DynamicValueMap

  /**
   * 参数流转追踪记录（仅在启用追踪时可用）
   */
  flowRecords: ParamFlowRecord[]

  /**
   * 获取追踪器实例（用于外部集成）
   */
  getTracker: () => ParamFlowTracker | null

  /**
   * 清空追踪记录
   */
  clearFlowRecords: () => void
}

/**
 * 动态参数管理 Hook
 *
 * 自动从模型 Schema 提取默认值，提供统一的参数管理接口
 *
 * @param modelId - 模型 ID
 * @param enableTracking - 是否启用参数流转追踪（默认 false）
 * @returns 参数管理接口
 *
 * @example
 * ```tsx
 * function VideoGenerator() {
 *   const { params, setParam, resetParams } = useModelParams('wan-2.6')
 *
 *   return (
 *     <div>
 *       <input
 *         value={params.prompt}
 *         onChange={(e) => setParam('prompt', e.target.value)}
 *       />
 *
 *       <select
 *         value={params.duration}
 *         onChange={(e) => setParam('duration', Number(e.target.value))}
 *       >
 *         <option value={5}>5秒</option>
 *         <option value={10}>10秒</option>
 *       </select>
 *
 *       <button onClick={resetParams}>重置</button>
 *     </div>
 *   )
 * }
 * ```
 */
export function useModelParams(modelId: string, enableTracking = false): UseModelParamsReturn {
  // 1. 获取模型定义
  const model = useMemo(() => {
    return registry.getModel(modelId)
  }, [modelId])

  // 2. 获取模型 Schema
  const schema = useMemo(() => {
    return registry.getSchema(modelId)
  }, [modelId])

  // 3. 提取默认值
  const defaults = useMemo(() => {
    return extractDefaults(schema)
  }, [schema])

  // 4. 联动规则（5.2 起联动本身是纯函数，见 src/features/generation/domain/generationParams.ts）
  const linkages = useMemo(() => model?.linkages ?? [], [model])

  // 5. 创建追踪器（仅在启用追踪时）
  const trackerRef = useRef<ParamFlowTracker | null>(null)
  if (enableTracking && !trackerRef.current) {
    trackerRef.current = new ParamFlowTracker()
  }

  // 6. 参数状态
  const [params, setParamsState] = useState<DynamicValueMap>(defaults)
  const previousModelIdRef = useRef(modelId)

  // 6. 模型切换时保留用户改过且与目标 schema 兼容的通用参数
  useEffect(() => {
    const previousModelId = previousModelIdRef.current
    setParamsState((previousParams) => {
      if (previousModelId === modelId) return defaults
      const transferred = transferModelParamOverridesBetweenModels(
        previousModelId,
        modelId,
        previousParams
      )
      return { ...defaults, ...transferred }
    })
    previousModelIdRef.current = modelId
  }, [modelId, defaults])

  // 7. 设置单个参数（集成联动引擎和追踪）
  const setParam = useCallback((key: string, value: DynamicValue) => {
    setParamsState((prev) => {
      // 开始追踪
      if (enableTracking && trackerRef.current) {
        trackerRef.current.startTracking(modelId)
      }

      // 设置新值
      let newParams = prev
      if (key.includes('.')) {
        newParams = setNestedValue(prev, key, value)
      } else {
        newParams = { ...prev, [key]: value }
      }

      // 记录 UI 输入
      if (enableTracking && trackerRef.current) {
        trackerRef.current.recordUIInput({ [key]: value })
      }

      // 执行联动
      if (linkages.length > 0) {
        const beforeLinkage = { ...newParams }
        newParams = reconcileGenerationParams(schema, newParams, linkages, [key])

        // 记录联动变化
        if (enableTracking && trackerRef.current) {
          const changes: DynamicValueMap = {}
          Object.keys(newParams).forEach((k) => {
            if (newParams[k] !== beforeLinkage[k]) {
              changes[k] = newParams[k]
            }
          })

          if (Object.keys(changes).length > 0) {
            trackerRef.current.recordLinkage(
              key,
              changes,
              { trigger: key, effect: 'linkage', targets: Object.keys(changes) }
            )
          }
        }
      }

      // 结束追踪
      if (enableTracking && trackerRef.current) {
        trackerRef.current.finishTracking()
      }

      return newParams
    })
  }, [linkages, schema, enableTracking, modelId])

  // 6. 批量设置参数
  const setParams = useCallback((values: DynamicValueMap) => {
    setParamsState((prev) => {
      // 检查是否有嵌套路径
      const hasNestedPaths = Object.keys(values).some((key) => key.includes('.'))

      if (hasNestedPaths) {
        return batchSetNestedValues(prev, values)
      }

      return {
        ...prev,
        ...values
      }
    })
  }, [])

  // 7. 重置所有参数
  const resetParams = useCallback(() => {
    setParamsState(defaults)
  }, [defaults])

  // 8. 重置单个参数
  const resetParam = useCallback(
    (key: string) => {
      if (key.includes('.')) {
        const defaultValue = getNestedValue(defaults, key)
        if (defaultValue !== undefined) {
          setParam(key, defaultValue)
        }
      } else if (defaults[key] !== undefined) {
        setParam(key, defaults[key])
      }
    },
    [defaults, setParam]
  )

  // 9. 获取过滤后的选项（每次 params/schema/linkages 变化时算一次全部 dropdown/radio 参数
  //    的选项表；LinkageEngine 在没有匹配的 filterOptions 联动时本来就原样返回 schema 里的
  //    options，不需要再手写一个"没有联动引擎"的 fallback 分支）
  const paramOptions = useMemo(
    () => resolveGenerationParamOptions(schema, params, linkages),
    [schema, params, linkages]
  )
  const getFilteredOptions = useCallback(
    (paramId: string) => paramOptions[paramId] ?? [],
    [paramOptions]
  )

  // 10. 获取参数定义
  const getParamDef = useCallback(
    (paramId: string) => {
      return schema.find((p) => p.id === paramId)
    },
    [schema]
  )

  // 11. 验证参数值
  const validateParam = useCallback(
    (paramId: string, value: DynamicValue) => {
      const paramDef = getParamDef(paramId)
      if (!paramDef) {
        return false
      }

      return validateParamValue(paramDef, value)
    },
    [getParamDef]
  )

  // 12. 获取追踪器实例
  const getTracker = useCallback(() => {
    return trackerRef.current
  }, [])

  // 13. 清空追踪记录
  const clearFlowRecords = useCallback(() => {
    if (trackerRef.current) {
      trackerRef.current.clearRecords()
    }
  }, [])

  // 14. 获取追踪记录
  const flowRecords = useMemo(() => {
    if (!enableTracking || !trackerRef.current) {
      return []
    }
    return trackerRef.current.getRecords()
  }, [enableTracking]) // 依赖 params 以便在参数变化时更新

  return {
    params,
    setParam,
    setParams,
    resetParams,
    resetParam,
    getFilteredOptions,
    getParamDef,
    validateParam,
    schema,
    defaults,
    flowRecords,
    getTracker,
    clearFlowRecords
  }
}

/**
 * 获取参数显示名称的 Hook
 *
 * @param modelId - 模型 ID
 * @param paramId - 参数 ID
 * @param locale - 语言
 * @returns 显示名称
 *
 * @example
 * ```tsx
 * const displayName = useParamDisplayName('wan-2.6', 'duration', 'zh')
 * // "视频时长"
 * ```
 */
export function useParamDisplayName(
  modelId: string,
  paramId: string,
  locale: 'zh' | 'en' = 'zh'
): string {
  return useMemo(() => {
    const schema = registry.getSchema(modelId)
    const paramDef = schema.find((p) => p.id === paramId)

    if (!paramDef) {
      return paramId
    }

    return getParamDisplayName(paramDef, locale)
  }, [modelId, paramId, locale])
}
