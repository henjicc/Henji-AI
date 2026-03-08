/**
 * 操作按钮组件
 * 职责：提供生成、清空等操作按钮
 */

import React from 'react'
import { UiButton } from '@/components/ui'

interface ActionButtonsProps {
  onGenerate: () => void
  onClear: () => void
  onSavePreset?: () => void
  isGenerating: boolean
  canGenerate: boolean
  showPresetButton?: boolean
}

export const ActionButtons: React.FC<ActionButtonsProps> = ({
  onGenerate,
  onClear,
  onSavePreset,
  isGenerating,
  canGenerate,
  showPresetButton = false
}) => {
  return (
    <div className="action-buttons">
      <UiButton
        variant="primary"
        size="sm"
        className="btn-generate primary"
        onClick={onGenerate}
        disabled={!canGenerate || isGenerating}
      >
        {isGenerating ? '生成中...' : '生成'}
      </UiButton>

      <UiButton
        variant="muted"
        size="sm"
        className="btn-clear secondary"
        onClick={onClear}
        disabled={isGenerating}
      >
        清空
      </UiButton>

      {showPresetButton && onSavePreset && (
        <UiButton
          variant="muted"
          size="sm"
          className="btn-preset secondary"
          onClick={onSavePreset}
          disabled={isGenerating}
        >
          保存预设
        </UiButton>
      )}
    </div>
  )
}
