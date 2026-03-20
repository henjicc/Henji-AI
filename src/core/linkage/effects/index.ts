import { createLogger } from '@/core/logging'

const logger = createLogger('core.linkage.effects.index')
/**
 * 联动效果处理器
 *
 * 执行各种联动效果
 */

import type { Linkage, ParamDef } from '../../types'

/**
 * 执行联动效果
 *
 * @param linkage - 联动配置
 * @param triggerValue - 触发器参数的值
 * @param params - 所有参数的当前值
 * @param schema - 参数 Schema
 * @returns 参数变更对象，如果没有变更则返回 null
 */
export function executeEffect(
  linkage: Linkage,
  triggerValue: any,
  params: Record<string, any>,
  schema: ParamDef[]
): Record<string, any> | null {
  switch (linkage.effect) {
    case 'reset':
      return executeResetEffect(linkage, params, schema)

    case 'setValue':
      return executeSetValueEffect(linkage, triggerValue, params)

    case 'autoSwitch':
      return executeAutoSwitchEffect(linkage, triggerValue, params)

    case 'filterOptions':
      // filterOptions 不修改参数值，只影响可选项
      // 在 getFilteredOptions 中处理
      return null

    case 'filterRange':
      // filterRange 不修改参数值，只影响范围
      // 在组件渲染时处理
      return null

    case 'disable':
      // disable 不修改参数值，只影响禁用状态
      // 在组件渲染时处理
      return null

    case 'hide':
      // hide 不修改参数值，只影响显示状态
      // 在组件渲染时处理
      return null

    case 'custom':
      return executeCustomEffect(linkage, triggerValue, params)

    default:
      return null
  }
}

/**
 * 执行重置效果
 */
function executeResetEffect(
  linkage: Linkage & { effect: 'reset' },
  params: Record<string, any>,
  schema: ParamDef[]
): Record<string, any> | null {
  // 检查条件（如果有）
  if (linkage.condition && !linkage.condition(params[linkage.trigger as string], params)) {
    return null
  }

  const changes: Record<string, any> = {}
  const targets = linkage.targets || []

  for (const targetId of targets) {
    const paramDef = schema.find((p) => p.id === targetId)
    if (paramDef && paramDef.default !== undefined) {
      changes[targetId] = paramDef.default
    }
  }

  return Object.keys(changes).length > 0 ? changes : null
}

/**
 * 执行设置值效果
 */
function executeSetValueEffect(
  linkage: Linkage & { effect: 'setValue' },
  triggerValue: any,
  params: Record<string, any>
): Record<string, any> | null {
  if (!linkage.target) return null

  // 检查条件（如果有）
  if (linkage.condition && !linkage.condition(triggerValue, params)) {
    return null
  }

  // 计算新值
  const value =
    typeof linkage.value === 'function' ? linkage.value(triggerValue, params) : linkage.value

  return { [linkage.target]: value }
}

/**
 * 执行自动切换效果
 */
function executeAutoSwitchEffect(
  linkage: Linkage & { effect: 'autoSwitch' },
  triggerValue: any,
  params: Record<string, any>
): Record<string, any> | null {
  if (!linkage.target) return null

  // 检查条件
  const shouldSwitch = linkage.condition ? linkage.condition(triggerValue, params) : false

  if (shouldSwitch) {
    // 条件满足，切换值
    const value =
      typeof linkage.value === 'function' ? linkage.value(triggerValue, params) : linkage.value

    return { [linkage.target]: value }
  }

  // 条件不满足
  // 如果 noRestore 为 false，应该恢复原值
  // 但原值管理在 AutoSwitchManager 中处理
  return null
}

/**
 * 执行自定义效果
 */
function executeCustomEffect(
  linkage: Linkage & { effect: 'custom' },
  triggerValue: any,
  params: Record<string, any>
): Record<string, any> | null {
  if (!linkage.handler) return null

  const changes: Record<string, any> = {}

  // 自定义处理器
  const updateParam = (paramId: string, value: any) => {
    changes[paramId] = value
  }

  try {
    linkage.handler(triggerValue, params, updateParam)
    return Object.keys(changes).length > 0 ? changes : null
  } catch (error) {
    logger.error('[LinkageEffect] Custom handler error:', error)
    return null
  }
}

