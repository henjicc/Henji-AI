/**
 * 联动优先级定义
 *
 * 定义不同联动效果的默认执行优先级
 */

import { LinkageEffect } from '../types/Linkage'

/**
 * 默认优先级映射
 *
 * 数值越小优先级越高
 *
 * 执行顺序逻辑：
 * 1. reset: 最先执行，清空受影响的参数
 * 2. setValue: 其次执行，设置基础值
 * 3. autoSwitch: 然后执行，根据条件自动切换
 * 4. filterOptions: 过滤下拉选项
 * 5. filterRange: 调整数值范围
 * 6. disable: 禁用参数
 * 7. hide: 隐藏参数
 * 8. custom: 最后执行，自定义逻辑
 */
export const DEFAULT_LINKAGE_PRIORITY: Record<LinkageEffect, number> = {
  reset: 1,
  setValue: 2,
  autoSwitch: 3,
  filterOptions: 4,
  filterRange: 5,
  disable: 6,
  hide: 7,
  custom: 8
}

/**
 * 获取联动的优先级
 *
 * @param linkage - 联动配置
 * @returns 优先级数值（越小优先级越高）
 */
export function getLinkagePriority(linkage: { effect: LinkageEffect; priority?: number }): number {
  // 如果联动配置中指定了优先级，使用指定的优先级
  if (linkage.priority !== undefined) {
    return linkage.priority
  }

  // 否则使用默认优先级
  return DEFAULT_LINKAGE_PRIORITY[linkage.effect]
}

/**
 * 对联动数组进行排序
 *
 * @param linkages - 联动配置数组
 * @returns 按优先级排序后的联动数组
 */
export function sortLinkagesByPriority<T extends { effect: LinkageEffect; priority?: number }>(
  linkages: T[]
): T[] {
  return [...linkages].sort((a, b) => {
    const priorityA = getLinkagePriority(a)
    const priorityB = getLinkagePriority(b)
    return priorityA - priorityB
  })
}
