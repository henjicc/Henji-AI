/**
 * 参数流转可视化组件
 * 显示参数从 UI 输入到 API 请求的完整流程
 */

import React from 'react'
import type { ParamFlowRecord, FlowStage } from '@/core/debug/types'
import { ValueDisplay } from './ValueDisplay'
import { SourceBadge } from './SourceBadge'
import { useI18n } from '@/hooks/useI18n'
import { UiButton, UiPanel } from '@/components/ui'

interface ParamFlowViewerProps {
  record: ParamFlowRecord
  onExport?: () => void
}

export function ParamFlowViewer({ record, onExport }: ParamFlowViewerProps) {
  const { t } = useI18n('ui')

  return (
    <UiPanel variant="inset" className="mt-4 p-4">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold text-white">{t('debug.paramFlow.title')}</h3>
        <div className="flex gap-2 items-center">
          <span className="text-xs text-text-muted">
            {t('debug.paramFlow.modelLabel')}: {record.modelId}
          </span>
          {onExport && (
            <UiButton
              variant="primary"
              size="sm"
              onClick={onExport}
              className="px-3 py-1 text-xs"
            >
              {t('debug.paramFlow.exportJson')}
            </UiButton>
          )}
        </div>
      </div>

      <div className="space-y-6">
        {record.stages.map((stage, index) => (
          <StageView key={index} stage={stage} />
        ))}
      </div>
    </UiPanel>
  )
}

interface StageViewProps {
  stage: FlowStage
}

function StageView({ stage }: StageViewProps) {
  const { t } = useI18n('ui')
  const getStageTitle = () => {
    switch (stage.stage) {
      case 'ui-input':
        return t('debug.paramFlow.stage.uiInput')
      case 'linkage':
        return t('debug.paramFlow.stage.linkage')
      case 'transform':
        return t('debug.paramFlow.stage.transform')
      case 'api-build':
        return t('debug.paramFlow.stage.apiBuild')
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
    <div className="bg-surface-dark rounded-lg p-4">
      <h4 className={`text-sm font-semibold mb-3 ${getStageColor()}`}>
        {getStageTitle()}
      </h4>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-dark">
              <th className="text-left py-2 px-3 text-text-muted font-medium">{t('debug.paramFlow.table.param')}</th>
              <th className="text-left py-2 px-3 text-text-muted font-medium">{t('debug.paramFlow.table.value')}</th>
              <th className="text-left py-2 px-3 text-text-muted font-medium">{t('debug.paramFlow.table.source')}</th>
            </tr>
          </thead>
          <tbody>
            {paramEntries.map(([key, record]) => (
              <tr key={key} className="border-b border-border-dark last:border-0">
                <td className="py-2 px-3 text-text-soft font-mono text-xs">
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
