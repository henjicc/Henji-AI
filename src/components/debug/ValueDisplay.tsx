/**
 * 值显示组件
 * 显示参数值，并高亮显示变化
 */

import React from 'react'
import type { ParamValueRecord } from '@/core/debug/types'

interface ValueDisplayProps {
  value: DynamicValue
  previousValue?: DynamicValue
  record?: ParamValueRecord
}

export function ValueDisplay({ value, previousValue, record }: ValueDisplayProps) {
  const hasChanged = previousValue !== undefined && value !== previousValue
  const hasTransform = record?.transformedFrom !== undefined

  const formatValue = (val: DynamicValue): string => {
    if (val === null) return 'null'
    if (val === undefined) return 'undefined'
    if (typeof val === 'string') return `"${val}"`
    if (typeof val === 'object') return JSON.stringify(val, null, 2)
    return String(val)
  }

  return (
    <div className="flex flex-col gap-1">
      <span className={hasChanged || hasTransform ? 'text-orange-500 font-semibold' : 'text-text-muted'}>
        {formatValue(value)}
      </span>

      {hasTransform && (
        <span className="text-xs text-text-faint">
          (转换前: {formatValue(record.transformedFrom)})
        </span>
      )}

      {hasChanged && !hasTransform && (
        <span className="text-xs text-text-faint">
          (之前: {formatValue(previousValue)})
        </span>
      )}
    </div>
  )
}
