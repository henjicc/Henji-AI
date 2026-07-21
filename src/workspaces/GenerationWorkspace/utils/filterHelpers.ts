/**
 * 筛选辅助函数
 * 职责：提供各种筛选功能
 */

interface Filterable {
  type?: string
  status?: string
  createdAt?: number
  [key: string]: DynamicValue
}

/**
 * 按类型筛选
 */
export function filterByType<T extends Filterable>(
  items: T[],
  type: string | 'all'
): T[] {
  if (type === 'all') {
    return items
  }
  return items.filter(item => item.type === type)
}

/**
 * 按状态筛选
 */
export function filterByStatus<T extends Filterable>(
  items: T[],
  status: string | 'all'
): T[] {
  if (status === 'all') {
    return items
  }
  return items.filter(item => item.status === status)
}

/**
 * 按关键词搜索
 */
export function searchItems<T extends DynamicValueMap>(
  items: T[],
  keyword: string,
  searchFields: (keyof T)[]
): T[] {
  if (!keyword.trim()) {
    return items
  }

  const lowerKeyword = keyword.toLowerCase()
  return items.filter(item =>
    searchFields.some(field => {
      const value = item[field]
      if (typeof value === 'string') {
        return value.toLowerCase().includes(lowerKeyword)
      }
      return false
    })
  )
}

/**
 * 按日期范围筛选
 */
export function filterByDateRange<T extends { createdAt?: number }>(
  items: T[],
  startDate?: number,
  endDate?: number
): T[] {
  return items.filter(item => {
    if (!item.createdAt) return false
    if (startDate && item.createdAt < startDate) return false
    if (endDate && item.createdAt > endDate) return false
    return true
  })
}

/**
 * 组合筛选
 */
export function applyFilters<T extends Filterable>(
  items: T[],
  filters: {
    type?: string
    status?: string
    keyword?: string
    searchFields?: (keyof T)[]
    startDate?: number
    endDate?: number
  }
): T[] {
  let result = items

  if (filters.type) {
    result = filterByType(result, filters.type)
  }

  if (filters.status) {
    result = filterByStatus(result, filters.status)
  }

  if (filters.keyword && filters.searchFields) {
    result = searchItems(result, filters.keyword, filters.searchFields)
  }

  if (filters.startDate || filters.endDate) {
    result = filterByDateRange(result, filters.startDate, filters.endDate)
  }

  return result
}
