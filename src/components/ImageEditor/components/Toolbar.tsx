/**
 * 工具栏组件
 * 职责：提供编辑工具按钮
 */

import React from 'react'

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
          title="撤销"
        >
          ↶
        </button>
        <button
          className="history-btn"
          onClick={onRedo}
          disabled={!canRedo}
          title="重做"
        >
          ↷
        </button>
      </div>

      <div className="toolbar-section actions">
        <button
          className="action-btn cancel"
          onClick={onCancel}
        >
          取消
        </button>
        <button
          className="action-btn save primary"
          onClick={onSave}
        >
          保存
        </button>
      </div>
    </div>
  )
}
