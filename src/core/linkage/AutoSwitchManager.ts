/**
 * AutoSwitch 管理器
 *
 * 管理 autoSwitch 联动的原始值记录和恢复
 */

import type { Linkage } from '../types'

/**
 * AutoSwitch 状态
 */
interface AutoSwitchState {
  originalValue: DynamicValue
  isActive: boolean
}

/**
 * AutoSwitch 管理器类
 */
export class AutoSwitchManager {
  /**
   * 记录每个参数的原始值
   * Key: 参数 ID
   * Value: 原始值状态
   */
  private originalValues: Map<string, AutoSwitchState> = new Map()

  /**
   * 执行 AutoSwitch
   *
   * @param linkage - AutoSwitch 联动配置
   * @param triggerValue - 触发器参数的值
   * @param params - 当前所有参数值
   * @param changedKey - 发生变化的参数 ID
   * @returns 参数变更对象，如果没有变更则返回 null
   */
  execute(
    linkage: Linkage & { effect: 'autoSwitch' },
    triggerValue: DynamicValue,
    params: DynamicValueMap,
    _changedKey: string
  ): DynamicValueMap | null {
    const target = linkage.target
    if (!target) return null

    // 检查条件
    const shouldSwitch = linkage.condition ? linkage.condition(triggerValue, params) : false

    if (shouldSwitch) {
      // 条件满足，应用切换
      return this.applySwitch(target, linkage.value, params, linkage.noRestore)
    } else if (!linkage.noRestore) {
      // 条件不满足且 noRestore 为 false，恢复原始值
      return this.restoreOriginal(target)
    }

    return null
  }

  /**
   * 应用切换
   *
   * @param target - 目标参数 ID
   * @param value - 新值（可以是固定值或函数）
   * @param params - 当前参数值
   * @param noRestore - 是否禁止恢复
   * @returns 参数变更对象
   */
  private applySwitch(
    target: string,
    value: DynamicValue,
    params: DynamicValueMap,
    _noRestore?: boolean
  ): DynamicValueMap {
    // 如果没有记录原始值，记录当前值
    if (!this.originalValues.has(target)) {
      this.originalValues.set(target, {
        originalValue: params[target],
        isActive: true
      })
    }

    // 计算新值
    const newValue = typeof value === 'function' ? value(params[target], params) : value

    return { [target]: newValue }
  }

  /**
   * 恢复原始值
   *
   * @param target - 目标参数 ID
   * @returns 参数变更对象，如果没有需要恢复的值则返回 null
   */
  private restoreOriginal(target: string): DynamicValueMap | null {
    const state = this.originalValues.get(target)

    if (!state || !state.isActive) {
      return null
    }

    const result = { [target]: state.originalValue }

    // 清理记录
    this.originalValues.delete(target)

    return result
  }

  /**
   * 清理所有状态
   */
  reset(): void {
    this.originalValues.clear()
  }

  /**
   * 获取统计信息（调试用）
   */
  getStats(): {
    activeCount: number
    targets: string[]
  } {
    const activeTargets = Array.from(this.originalValues.entries())
      .filter(([_, state]) => state.isActive)
      .map(([target]) => target)

    return {
      activeCount: activeTargets.length,
      targets: activeTargets
    }
  }
}
