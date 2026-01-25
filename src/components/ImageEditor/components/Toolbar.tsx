/**
 * 工具栏组件
 * 职责：提供编辑工具按钮
 */

import React from 'react'
import { useI18n } from '@/hooks/useI18n'

interface Tool {
  id: string
  name: string
  icon: string
  action: () => void
  disabled?: boolean
}

interface ToolbarProps {
  tools: Tool[]
  activeTool?: string
  onToolSelect: (toolId: string) => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onSave: () => void
  onCancel: () => void
}

export const Toolbar: React.FC<ToolbarProps> = ({
  tools,
  activeTool,
  onToolSelect,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onSave,
  onCancel
}) => {
  const { t } = useI18n()
  return (
    <div className="editor-toolbar">
      <div className="toolbar-section tools">
        {tools.map(tool => (
          <button
            key={tool.id}
            className={`tool-btn ${activeTool === tool.id ? 'active' : ''}`}
            onClick={() => {
              onToolSelect(tool.id)
              tool.action()
            }}
            disabled={tool.disabled}
            title={tool.name}
          >
            <span className="tool-icon">{tool.icon}</span>
            <span className="tool-name">{tool.name}</span>
          </button>
        ))}
      </div>

      <div className="toolbar-section history">
        <button
          className="history-btn"
          onClick={onUndo}
          disabled={!canUndo}
          title={t('ui:imageEditor.actions.undo')}
        >
          ↶
        </button>
        <button
          className="history-btn"
          onClick={onRedo}
          disabled={!canRedo}
          title={t('ui:imageEditor.actions.redo')}
        >
          ↷
        </button>
      </div>

      <div className="toolbar-section actions">
        <button
          className="action-btn cancel"
          onClick={onCancel}
        >
          {t('common:cancel')}
        </button>
        <button
          className="action-btn save primary"
          onClick={onSave}
        >
          {t('common:save')}
        </button>
      </div>
    </div>
  )
}
