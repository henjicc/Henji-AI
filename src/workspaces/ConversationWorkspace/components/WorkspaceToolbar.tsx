/**
 * 工具栏组件
 * 职责：显示工作区工具栏
 */

import React from 'react'

interface ToolbarAction {
  id: string
  name: string
  icon: string
  action: () => void
  disabled?: boolean
  badge?: number
}

interface ToolbarProps {
  actions: ToolbarAction[]
  viewMode: 'grid' | 'list'
  onViewModeChange: (mode: 'grid' | 'list') => void
  sortBy: 'date' | 'name' | 'type'
  onSortChange: (sortBy: 'date' | 'name' | 'type') => void
  filterType: 'all' | 'image' | 'video' | 'audio'
  onFilterChange: (filterType: 'all' | 'image' | 'video' | 'audio') => void
}

export const WorkspaceToolbar: React.FC<ToolbarProps> = ({
  actions,
  viewMode,
  onViewModeChange,
  sortBy,
  onSortChange,
  filterType,
  onFilterChange
}) => {
  return (
    <div className="workspace-toolbar">
      <div className="toolbar-section actions">
        {actions.map(action => (
          <button
            key={action.id}
            className="toolbar-btn"
            onClick={action.action}
            disabled={action.disabled}
            title={action.name}
          >
            <span className="btn-icon">{action.icon}</span>
            <span className="btn-name">{action.name}</span>
            {action.badge !== undefined && action.badge > 0 && (
              <span className="btn-badge">{action.badge}</span>
            )}
          </button>
        ))}
      </div>

      <div className="toolbar-section filters">
        <select
          className="toolbar-select"
          value={filterType}
          onChange={(e) => onFilterChange(e.target.value as any)}
        >
          <option value="all">全部类型</option>
          <option value="image">图片</option>
          <option value="video">视频</option>
          <option value="audio">音频</option>
        </select>

        <select
          className="toolbar-select"
          value={sortBy}
          onChange={(e) => onSortChange(e.target.value as any)}
        >
          <option value="date">按日期</option>
          <option value="name">按名称</option>
          <option value="type">按类型</option>
        </select>
      </div>

      <div className="toolbar-section view-mode">
        <button
          className={`view-mode-btn ${viewMode === 'grid' ? 'active' : ''}`}
          onClick={() => onViewModeChange('grid')}
          title="网格视图"
        >
          ⊞
        </button>
        <button
          className={`view-mode-btn ${viewMode === 'list' ? 'active' : ''}`}
          onClick={() => onViewModeChange('list')}
          title="列表视图"
        >
          ☰
        </button>
      </div>
    </div>
  )
}
