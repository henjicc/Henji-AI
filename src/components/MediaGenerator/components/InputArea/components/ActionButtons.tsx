/**
 * 操作按钮组件
 * 职责：提供生成、清空等操作按钮
 */

import React from 'react'

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
      <button
        className="btn-generate primary"
        onClick={onGenerate}
        disabled={!canGenerate || isGenerating}
      >
        {isGenerating ? '生成中...' : '生成'}
      </button>

      <button
        className="btn-clear secondary"
        onClick={onClear}
        disabled={isGenerating}
      >
        清空
      </button>

      {showPresetButton && onSavePreset && (
        <button
          className="btn-preset secondary"
          onClick={onSavePreset}
          disabled={isGenerating}
        >
          保存预设
        </button>
      )}
    </div>
  )
}
