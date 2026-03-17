/**
 * 联动引擎
 *
 * 管理参数间的联动关系，按优先级执行联动效果
 */

import type { Linkage, ParamDef } from '../types'
import { executeEffect } from './effects'
import { sortLinkagesByPriority } from './priority'

/**
 * 联动引擎类
 */
export class LinkageEngine {
  private linkages: Linkage[] = []
  private executionDepth = 0
  private readonly maxDepth = 10

  /**
   * 创建联动引擎
   *
   * @param linkages - 联动配置数组
   */
  constructor(linkages: Linkage[]) {
    // 按优先级排序
    this.linkages = sortLinkagesByPriority(linkages)
  }

  /**
   * 执行联动
   *
   * @param changedKey - 发生变化的参数 ID
   * @param params - 当前所有参数值
   * @param schema - 参数 Schema
   * @returns 更新后的参数值
   */
  execute(
    changedKey: string,
    params: Record<string, any>,
    schema: ParamDef[]
  ): Record<string, any> {
    // 防止循环联动
    if (this.executionDepth >= this.maxDepth) {
      console.warn(
        `[LinkageEngine] Max execution depth (${this.maxDepth}) reached, stopping to prevent infinite loop`
      )
      return params
    }

    this.executionDepth++

    try {
      let result = { ...params }
      const triggerValue = result[changedKey]

      // 遍历所有联动规则
      for (const linkage of this.linkages) {
        // 检查是否应该触发
        if (!this.shouldTrigger(linkage, changedKey)) {
          continue
        }

        // 执行联动效果
        const changes = executeEffect(linkage, triggerValue, result, schema)

        if (changes && Object.keys(changes).length > 0) {
          // 应用变更
          result = { ...result, ...changes }

          // 递归执行联动（如果有参数被修改）
          for (const key of Object.keys(changes)) {
            if (key !== changedKey) {
              result = this.execute(key, result, schema)
            }
          }
        }
      }

      return result
    } finally {
      this.executionDepth--
    }
  }

  /**
   * 判断是否应该触发联动
   *
   * @param linkage - 联动配置
   * @param changedKey - 发生变化的参数 ID
   * @returns 是否应该触发
   */
  private shouldTrigger(linkage: Linkage, changedKey: string): boolean {
    const trigger = linkage.trigger

    if (Array.isArray(trigger)) {
      return trigger.includes(changedKey)
    }

    return trigger === changedKey
  }

  /**
   * 获取指定参数的过滤选项
   *
   * @param paramId - 参数 ID
   * @param params - 当前参数值
   * @param schema - 参数 Schema
   * @returns 过滤后的选项数组
   */
  getFilteredOptions(
    paramId: string,
    params: Record<string, any>,
    schema: ParamDef[]
  ): any[] {
    const paramDef = schema.find((p) => p.id === paramId)

    if (!paramDef) {
      return []
    }

    // 只有 dropdown 和 radio 有 options
    if (paramDef.type !== 'dropdown' && paramDef.type !== 'radio') {
      return []
    }

    if (!('options' in paramDef) || !paramDef.options) {
      return []
    }

    let options = paramDef.options

    // 查找所有 filterOptions 联动
    for (const linkage of this.linkages) {
      if (linkage.effect !== 'filterOptions') {
        continue
      }

      if (linkage.target !== paramId) {
        continue
      }

      // 获取触发器的值
      const trigger = Array.isArray(linkage.trigger) ? linkage.trigger[0] : linkage.trigger
      const triggerValue = params[trigger]

      // 应用过滤函数
      if (linkage.filter) {
        options = linkage.filter(triggerValue, options, params)
      }
    }

    return options
  }

  /**
   * 获取参数的数值范围
   *
   * @param paramId - 参数 ID
   * @param params - 当前参数值
   * @param schema - 参数 Schema
   * @returns 范围配置 { min, max, step }
   */
  getFilteredRange(
    paramId: string,
    params: Record<string, any>,
    schema: ParamDef[]
  ): { min?: number; max?: number; step?: number } | null {
    const paramDef = schema.find((p) => p.id === paramId)

    if (!paramDef) {
      return null
    }

    // 只有 number 有范围
    if (paramDef.type !== 'number') {
      return null
    }

    if (!('min' in paramDef) || !('max' in paramDef)) {
      return null
    }

    let range = {
      min: paramDef.min,
      max: paramDef.max,
      step: 'step' in paramDef ? paramDef.step : 1
    }

    // 查找所有 filterRange 联动
    for (const linkage of this.linkages) {
      if (linkage.effect !== 'filterRange') {
        continue
      }

      if (linkage.target !== paramId) {
        continue
      }

      // 获取触发器的值
      const trigger = Array.isArray(linkage.trigger) ? linkage.trigger[0] : linkage.trigger
      const triggerValue = params[trigger]

      // 应用过滤函数
      if (linkage.filter) {
        const filteredRange = linkage.filter(triggerValue, params)
        range = { ...range, ...filteredRange }
      }
    }

    return range
  }

  /**
   * 检查参数是否应该被禁用
   *
   * @param paramId - 参数 ID
   * @param params - 当前参数值
   * @returns 是否禁用
   */
  isParamDisabled(paramId: string, params: Record<string, any>): boolean {
    for (const linkage of this.linkages) {
      if (linkage.effect !== 'disable') {
        continue
      }

      if (!linkage.targets || !linkage.targets.includes(paramId)) {
        continue
      }

      // 获取触发器的值
      const trigger = Array.isArray(linkage.trigger) ? linkage.trigger[0] : linkage.trigger
      const triggerValue = params[trigger]

      // 检查条件
      if (linkage.condition && linkage.condition(triggerValue, params)) {
        return true
      }
    }

    return false
  }

  /**
   * 检查参数是否应该被隐藏
   *
   * @param paramId - 参数 ID
   * @param params - 当前参数值
   * @returns 是否隐藏
   */
  isParamHidden(paramId: string, params: Record<string, any>): boolean {
    for (const linkage of this.linkages) {
      if (linkage.effect !== 'hide') {
        continue
      }

      if (!linkage.targets || !linkage.targets.includes(paramId)) {
        continue
      }

      // 获取触发器的值
      const trigger = Array.isArray(linkage.trigger) ? linkage.trigger[0] : linkage.trigger
      const triggerValue = params[trigger]

      // 检查条件
      if (linkage.condition && linkage.condition(triggerValue, params)) {
        return true
      }
    }

    return false
  }

  /**
   * 获取统计信息（调试用）
   */
  getStats(): {
    totalLinkages: number
    byEffect: Record<string, number>
  } {
    const byEffect: Record<string, number> = {}

    for (const linkage of this.linkages) {
      byEffect[linkage.effect] = (byEffect[linkage.effect] || 0) + 1
    }

    return {
      totalLinkages: this.linkages.length,
      byEffect
    }
  }
}
