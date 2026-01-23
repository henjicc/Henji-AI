import { useState, useCallback } from 'react'

/**
 * 通知管理 Hook
 * 职责：管理应用内通知
 */

export interface Notification {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  message: string
  duration?: number
  createdAt: number
}

export const useNotifications = () => {
  const [notifications, setNotifications] = useState<Notification[]>([])

  const addNotification = useCallback((
    type: Notification['type'],
    message: string,
    duration: number = 3000
  ) => {
    const notification: Notification = {
      id: `notif-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type,
      message,
      duration,
      createdAt: Date.now()
    }

    setNotifications(prev => [...prev, notification])

    if (duration > 0) {
      setTimeout(() => {
        removeNotification(notification.id)
      }, duration)
    }

    return notification.id
  }, [])

  const removeNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id))
  }, [])

  const clearNotifications = useCallback(() => {
    setNotifications([])
  }, [])

  const success = useCallback((message: string, duration?: number) => {
    return addNotification('success', message, duration)
  }, [addNotification])

  const error = useCallback((message: string, duration?: number) => {
    return addNotification('error', message, duration)
  }, [addNotification])

  const warning = useCallback((message: string, duration?: number) => {
    return addNotification('warning', message, duration)
  }, [addNotification])

  const info = useCallback((message: string, duration?: number) => {
    return addNotification('info', message, duration)
  }, [addNotification])

  return {
    notifications,
    addNotification,
    removeNotification,
    clearNotifications,
    success,
    error,
    warning,
    info
  }
}
