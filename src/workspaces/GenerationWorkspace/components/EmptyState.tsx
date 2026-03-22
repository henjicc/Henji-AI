/**
 * 空状态组件
 * 职责：显示空状态提示
 */

import React from 'react'
import { UiButton } from '@/components/ui'

interface EmptyStateProps {
  icon?: string
  title: string
  description?: string
  action?: {
    label: string
    onClick: () => void
  }
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon = '📭',
  title,
  description,
  action
}) => {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <div className="empty-title">{title}</div>
      {description && (
        <div className="empty-description">{description}</div>
      )}
      {action && (
        <UiButton
          variant="primary"
          size="sm"
          className="empty-action"
          onClick={action.onClick}
        >
          {action.label}
        </UiButton>
      )}
    </div>
  )
}
