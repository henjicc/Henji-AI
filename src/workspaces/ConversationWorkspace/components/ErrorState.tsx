/**
 * 错误状态组件
 * 职责：显示错误状态
 */

import React from 'react'

interface ErrorStateProps {
  error: Error | string
  onRetry?: () => void
  onDismiss?: () => void
  showDetails?: boolean
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  error,
  onRetry,
  onDismiss,
  showDetails = false
}) => {
  const errorMessage = typeof error === 'string' ? error : error.message
  const errorStack = typeof error === 'string' ? undefined : error.stack

  return (
    <div className="error-state">
      <div className="error-icon">❌</div>
      <div className="error-title">出错了</div>
      <div className="error-message">{errorMessage}</div>

      {showDetails && errorStack && (
        <details className="error-details">
          <summary>查看详情</summary>
          <pre className="error-stack">{errorStack}</pre>
        </details>
      )}

      <div className="error-actions">
        {onRetry && (
          <button className="error-btn retry" onClick={onRetry}>
            重试
          </button>
        )}
        {onDismiss && (
          <button className="error-btn dismiss" onClick={onDismiss}>
            关闭
          </button>
        )}
      </div>
    </div>
  )
}
