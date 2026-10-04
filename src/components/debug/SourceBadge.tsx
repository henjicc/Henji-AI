/**
 * 来源标记组件
 * 显示参数值的来源和变化原因
 */

import React from 'react'
import type { ParamValueRecord } from '@/core/debug/types'

interface SourceBadgeProps {
  record: ParamValueRecord
}

export function SourceBadge({ record }: SourceBadgeProps) {
  const getBadgeClass = () => {
    switch (record.source) {
      case 'user-input':
        return 'bg-accent text-on-accent'
      case 'linkage':
        return 'bg-warning-solid text-on-warning'
      case 'transform':
        return 'bg-selected text-text1'
      case 'api-build':
        return 'bg-success-solid text-on-success'
      case 'default':
        return 'bg-hover text-text1'
      default:
        return 'bg-raised text-text2'
    }
  }

  const getSourceLabel = () => {
    switch (record.source) {
      case 'user-input':
        return '用户输入'
      case 'linkage':
        return '参数联动'
      case 'transform':
        return '值转换'
      case 'api-build':
        return 'API 构建'
      case 'default':
        return '默认值'
      default:
        return '未知'
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${getBadgeClass()}`}>
        {getSourceLabel()}
      </span>

      {record.changedBy && (
        <span className="text-xs text-text3">
          触发者: {record.changedBy}
        </span>
      )}

      {record.reason && (
        <span className="text-xs text-text3">
          {record.reason}
        </span>
      )}
    </div>
  )
}
