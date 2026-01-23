/**
 * 侧边栏组件
 * 职责：显示侧边栏面板
 */

import React from 'react'

interface SidebarProps {
  isOpen: boolean
  activePanel: 'tasks' | 'history' | 'files' | null
  onPanelChange: (panel: 'tasks' | 'history' | 'files' | null) => void
  onToggle: () => void
  children: React.ReactNode
}

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  activePanel,
  onPanelChange,
  onToggle,
  children
}) => {
  const panels = [
    { id: 'tasks' as const, name: '任务', icon: '📋' },
    { id: 'history' as const, name: '历史', icon: '📜' },
    { id: 'files' as const, name: '文件', icon: '📁' }
  ]

  return (
    <div className={`sidebar ${isOpen ? 'open' : 'closed'}`}>
      <div className="sidebar-tabs">
        {panels.map(panel => (
          <button
            key={panel.id}
            className={`sidebar-tab ${activePanel === panel.id ? 'active' : ''}`}
            onClick={() => onPanelChange(activePanel === panel.id ? null : panel.id)}
            title={panel.name}
          >
            <span className="tab-icon">{panel.icon}</span>
            {isOpen && <span className="tab-name">{panel.name}</span>}
          </button>
        ))}
      </div>

      <div className="sidebar-content">
        {isOpen && children}
      </div>

      <button
        className="sidebar-toggle"
        onClick={onToggle}
        title={isOpen ? '收起侧边栏' : '展开侧边栏'}
      >
        {isOpen ? '◀' : '▶'}
      </button>
    </div>
  )
}
