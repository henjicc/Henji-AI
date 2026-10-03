import React from 'react'
import type { ToastNotification } from '../types'
import { UI_TEXT_BODY_CLASS, UiPanel } from '@/components/ui'
import { Check, X } from 'lucide-react'

export interface NotificationToastProps {
  notification: ToastNotification | null
  visible: boolean
}

export function NotificationToast({ notification, visible }: NotificationToastProps): JSX.Element | null {
  if (!notification) return null

  const isSuccess = notification.type === 'success'

  return (
    <div
      className={`fixed top-12 left-1/2 z-toast -translate-x-1/2 transform transition-[opacity,transform] duration-240 ${
        visible ? 'translate-y-0 opacity-100' : '-translate-y-8 opacity-0 pointer-events-none'
      }`}
    >
      {/* 浮层通知：统一浮层表面，状态只进图标颜色 */}
      <UiPanel role="status" className="flex items-center gap-2.5 px-4 py-2.5">
        {isSuccess ? (
          <Check aria-hidden="true" className="h-4 w-4 text-success-text" />
        ) : (
          <X aria-hidden="true" className="h-4 w-4 text-danger-text" />
        )}
        <span className={UI_TEXT_BODY_CLASS}>{notification.message}</span>
      </UiPanel>
    </div>
  )
}

