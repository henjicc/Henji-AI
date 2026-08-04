/**
 * 通知组件
 * 职责：显示通知消息
 */

import React, { useEffect } from 'react'
import { UiIconButton } from '@/components/ui'

interface Notification {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  message: string
  duration?: number
  createdAt: number
}

interface NotificationListProps {
  notifications: Notification[]
  onRemove: (id: string) => void
}

export const NotificationList: React.FC<NotificationListProps> = ({
  notifications,
  onRemove
}) => {
  const getIcon = (type: Notification['type']) => {
    switch (type) {
      case 'success': return '✅'
      case 'error': return '❌'
      case 'warning': return '⚠️'
      case 'info': return 'ℹ️'
    }
  }

  return (
    <div className="notification-list">
      {notifications.map(notification => (
        <NotificationItem
          key={notification.id}
          notification={notification}
          onRemove={onRemove}
          icon={getIcon(notification.type)}
        />
      ))}
    </div>
  )
}

interface NotificationItemProps {
  notification: Notification
  onRemove: (id: string) => void
  icon: string
}

const NotificationItem: React.FC<NotificationItemProps> = ({
  notification,
  onRemove,
  icon
}) => {
  useEffect(() => {
    if (notification.duration && notification.duration > 0) {
      const timer = setTimeout(() => {
        onRemove(notification.id)
      }, notification.duration)

      return () => clearTimeout(timer)
    }
  }, [notification.id, notification.duration, onRemove])

  return (
    <div className={`notification notification-${notification.type}`}>
      <span className="notification-icon">{icon}</span>
      <span className="notification-message">{notification.message}</span>
      <UiIconButton
        appearance="hover-only"
        className="notification-close"
        onClick={() => onRemove(notification.id)}
      >
        ×
      </UiIconButton>
    </div>
  )
}
