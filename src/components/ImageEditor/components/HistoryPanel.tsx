/**
 * 历史面板组件
 * 职责：显示编辑历史记录
 */

import React from 'react'

interface HistoryEntry {
  id: string
  action: string
  timestamp: number
}

interface HistoryPanelProps {
  history: HistoryEntry[]
  currentIndex: number
  onJumpTo: (index: number) => void
  onClear: () => void
}

export const HistoryPanel: React.FC<HistoryPanelProps> = ({
  history,
  currentIndex,
  onJumpTo,
  onClear
}) => {
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  }

  return (
    <div className="history-panel">
      <div className="panel-header">
        <h3>历史记录</h3>
        <button
          className="clear-btn"
          onClick={onClear}
          disabled={history.length === 0}
        >
          清空
        </button>
      </div>

      <div className="panel-content">
        {history.length === 0 ? (
          <div className="history-empty">
            暂无历史记录
          </div>
        ) : (
          <div className="history-list">
            {history.map((entry, index) => (
              <div
                key={entry.id}
                className={`history-item ${index === currentIndex ? 'current' : ''} ${index > currentIndex ? 'future' : ''}`}
                onClick={() => onJumpTo(index)}
              >
                <div className="history-action">{entry.action}</div>
                <div className="history-time">{formatTime(entry.timestamp)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
