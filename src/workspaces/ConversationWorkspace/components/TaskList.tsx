/**
 * 任务列表组件
 * 职责：显示生成任务列表
 */

import React from 'react'

interface GenerationTask {
  id: string
  type: 'image' | 'video' | 'audio'
  prompt: string
  model: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  progress?: number
  result?: any
  error?: string
  createdAt: number
}

interface TaskListProps {
  tasks: GenerationTask[]
  onTaskClick: (taskId: string) => void
  onTaskRemove: (taskId: string) => void
  onTaskRetry?: (taskId: string) => void
}

export const TaskList: React.FC<TaskListProps> = ({
  tasks,
  onTaskClick,
  onTaskRemove,
  onTaskRetry
}) => {
  const getStatusIcon = (status: GenerationTask['status']) => {
    switch (status) {
      case 'pending': return '⏳'
      case 'processing': return '⚙️'
      case 'completed': return '✅'
      case 'failed': return '❌'
    }
  }

  const getTypeIcon = (type: GenerationTask['type']) => {
    switch (type) {
      case 'image': return '🖼️'
      case 'video': return '🎬'
      case 'audio': return '🎵'
    }
  }

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  return (
    <div className="task-list">
      {tasks.length === 0 ? (
        <div className="task-list-empty">
          暂无任务
        </div>
      ) : (
        tasks.map(task => (
          <div
            key={task.id}
            className={`task-item ${task.status}`}
            onClick={() => onTaskClick(task.id)}
          >
            <div className="task-header">
              <span className="task-type">{getTypeIcon(task.type)}</span>
              <span className="task-status">{getStatusIcon(task.status)}</span>
              <span className="task-time">{formatTime(task.createdAt)}</span>
              <button
                className="task-remove"
                onClick={(e) => {
                  e.stopPropagation()
                  onTaskRemove(task.id)
                }}
              >
                ×
              </button>
            </div>

            <div className="task-content">
              <div className="task-model">{task.model}</div>
              <div className="task-prompt">{task.prompt}</div>
            </div>

            {task.status === 'processing' && task.progress !== undefined && (
              <div className="task-progress">
                <div
                  className="task-progress-bar"
                  style={{ width: `${task.progress}%` }}
                />
                <span className="task-progress-text">{task.progress}%</span>
              </div>
            )}

            {task.status === 'failed' && task.error && (
              <div className="task-error">
                <span className="error-message">{task.error}</span>
                {onTaskRetry && (
                  <button
                    className="retry-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      onTaskRetry(task.id)
                    }}
                  >
                    重试
                  </button>
                )}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  )
}
