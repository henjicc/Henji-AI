/**
 * 排序辅助函数
 * 职责：提供各种排序功能
 */

interface Sortable {
  id: string
  createdAt?: number
  name?: string
  type?: string
  [key: string]: any
}

/**
 * 按日期排序
 */
export function sortByDate<T extends Sortable>(
  items: T[],
  order: 'asc' | 'desc' = 'desc'
): T[] {
  return [...items].sort((a, b) => {
    const timeA = a.createdAt || 0
    const timeB = b.createdAt || 0
    return order === 'asc' ? timeA - timeB : timeB - timeA
  })
}

/**
 * 按名称排序
 */
export function sortByName<T extends Sortable>(
  items: T[],
  order: 'asc' | 'desc' = 'asc'
): T[] {
  return [...items].sort((a, b) => {
    const nameA = (a.name || a.id).toLowerCase()
    const nameB = (b.name || b.id).toLowerCase()
    const comparison = nameA.localeCompare(nameB, 'zh-CN')
    return order === 'asc' ? comparison : -comparison
  })
}

/**
 * 按类型排序
 */
export function sortByType<T extends Sortable>(
  items: T[],
  order: 'asc' | 'desc' = 'asc'
): T[] {
  return [...items].sort((a, b) => {
    const typeA = a.type || ''
    const typeB = b.type || ''
    const comparison = typeA.localeCompare(typeB)
    return order === 'asc' ? comparison : -comparison
  })
}

/**
 * 通用排序函数
 */
export function sortItems<T extends Sortable>(
  items: T[],
  sortBy: 'date' | 'name' | 'type',
  order: 'asc' | 'desc' = 'desc'
): T[] {
  switch (sortBy) {
    case 'date':
      return sortByDate(items, order)
    case 'name':
      return sortByName(items, order)
    case 'type':
      return sortByType(items, order)
    default:
      return items
  }
}
