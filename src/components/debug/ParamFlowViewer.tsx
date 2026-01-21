/**
 * 参数流转可视化组件
 * 显示参数从 UI 输入到 API 请求的完整流程
 */

import React from 'react'
import type { ParamFlowRecord, FlowStage } from '@/core/debug/types'
import { ValueDisplay } from './ValueDisplay'
import { SourceBadge } from './SourceBadge'
import { useI18n } from '@/hooks/useI18n'

interface ParamFlowViewerProps {
  record: ParamFlowRecord
  onExport?: () => void
}

export function ParamFlowViewer({ record, onExport }: ParamFlowViewerProps) {
  const { t } = useI18n('ui')

  return (
    <div className="border border-gray-700 rounded-lg p-4 mt-4 bg-gray-900">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold text-white">参数流转追踪</h3>
        <div className="flex gap-2 items-center">
          <span className="text-xs text-gray-400">
            模型: {record.modelId}
          </span>
          {onExport && (
            <button
              onClick={onExport}
              className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
            >
              导出 JSON
            </button>
          )}
        </div>
      </div>

      <div className="space-y-6">
        {record.stages.map((stage, index) => (
          <StageView key={index} stage={stage} />
        ))}
      </div>
    </div>
  )
}

interface StageViewProps {
  stage: FlowStage
}

function StageView({ stage }: StageViewProps) {
  const getStageTitle = () => {
    switch (stage.stage) {
      case 'ui-input':
        return '1. UI 输入'
      case 'linkage':
        return '2. 参数联动'
      case 'transform':
        return '3. 值转换'
      case 'api-build':
        return '4. API 请求'
    }
  }

  const getStageColor = () => {
    switch (stage.stage) {
      case 'ui-input':
        return 'text-blue-400'
      case 'linkage':
        return 'text-orange-400'
      case 'transform':
        return 'text-purple-400'
      case 'api-build':
        return 'text-green-400'
    }
  }

  const paramEntries = Object.entries(stage.params)

  if (paramEntries.length === 0) {
    return null
  }

  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <h4 className={`text-sm font-semibold mb-3 ${getStageColor()}`}>
        {getStageTitle()}
      </h4>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700">
              <th className="text-left py-2 px-3 text-gray-400 font-medium">参数</th>
              <th className="text-left py-2 px-3 text-gray-400 font-medium">值</th>
              <th className="text-left py-2 px-3 text-gray-400 font-medium">来源/原因</th>
            </tr>
          </thead>
          <tbody>
            {paramEntries.map(([key, record]) => (
              <tr key={key} className="border-b border-gray-700 last:border-0">
                <td className="py-2 px-3 text-gray-300 font-mono text-xs">
                  {key}
                </td>
                <td className="py-2 px-3">
                  <ValueDisplay value={record.value} record={record} />
                </td>
                <td className="py-2 px-3">
                  <SourceBadge record={record} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
