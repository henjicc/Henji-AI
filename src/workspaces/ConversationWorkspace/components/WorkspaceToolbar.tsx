/**
 * 工具栏组件
 * 职责：显示工作区工具栏
 */

import React from 'react'
import { useI18n } from '@/hooks/useI18n'

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
  const { t } = useI18n('ui')
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
          <option value="all">{t('workspaceToolbar.filter.all')}</option>
          <option value="image">{t('workspaceToolbar.filter.image')}</option>
          <option value="video">{t('workspaceToolbar.filter.video')}</option>
          <option value="audio">{t('workspaceToolbar.filter.audio')}</option>
        </select>

        <select
          className="toolbar-select"
          value={sortBy}
          onChange={(e) => onSortChange(e.target.value as any)}
        >
          <option value="date">{t('workspaceToolbar.sort.date')}</option>
          <option value="name">{t('workspaceToolbar.sort.name')}</option>
          <option value="type">{t('workspaceToolbar.sort.type')}</option>
        </select>
      </div>

      <div className="toolbar-section view-mode">
        <button
          className={`view-mode-btn ${viewMode === 'grid' ? 'active' : ''}`}
          onClick={() => onViewModeChange('grid')}
          title={t('workspaceToolbar.view.grid')}
        >
          ⊞
        </button>
        <button
          className={`view-mode-btn ${viewMode === 'list' ? 'active' : ''}`}
          onClick={() => onViewModeChange('list')}
          title={t('workspaceToolbar.view.list')}
        >
          ☰
        </button>
      </div>
    </div>
  )
}
