/**
 * 加载状态组件
 * 职责：显示加载状态
 */

import React from 'react'

interface LoadingStateProps {
  isLoading: boolean
  message?: string
  progress?: number
  size?: 'small' | 'medium' | 'large'
}

export const LoadingState: React.FC<LoadingStateProps> = ({
  isLoading,
  message = '加载中...',
  progress,
  size = 'medium'
}) => {
  if (!isLoading) {
    return null
  }

  return (
    <div className={`loading-state loading-${size}`}>
      <div className="loading-spinner">
        <div className="spinner"></div>
      </div>
      <div className="loading-message">{message}</div>
      {progress !== undefined && (
        <div className="loading-progress">
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="progress-text">{progress}%</div>
        </div>
      )}
    </div>
  )
}
