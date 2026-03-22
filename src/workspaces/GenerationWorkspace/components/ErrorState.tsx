/**
 * 错误状态组件
 * 职责：显示错误状态
 */

import React from 'react'
import { useI18n } from '@/hooks/useI18n'
import { UiButton } from '@/components/ui'

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
  const { t } = useI18n()
  const errorMessage = typeof error === 'string' ? error : error.message
  const errorStack = typeof error === 'string' ? undefined : error.stack

  return (
      <div className="error-state">
      <div className="error-icon">❌</div>
      <div className="error-title">{t('ui:errorState.title')}</div>
      <div className="error-message">{errorMessage}</div>

      {showDetails && errorStack && (
        <details className="error-details">
          <summary>{t('ui:errorState.details')}</summary>
          <pre className="error-stack">{errorStack}</pre>
        </details>
      )}

      <div className="error-actions">
        {onRetry && (
          <UiButton variant="primary" size="sm" className="error-btn retry" onClick={onRetry}>
            {t('common:actions.retry')}
          </UiButton>
        )}
        {onDismiss && (
          <UiButton variant="muted" size="sm" className="error-btn dismiss" onClick={onDismiss}>
            {t('common:close')}
          </UiButton>
        )}
      </div>
    </div>
  )
}
