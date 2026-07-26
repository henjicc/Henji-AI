import React from 'react'
import type { ToastNotification } from '../types'

export interface NotificationToastProps {
  notification: ToastNotification | null
  visible: boolean
}

export function NotificationToast({ notification, visible }: NotificationToastProps): JSX.Element | null {
  if (!notification) return null

  const isSuccess = notification.type === 'success'

  return (
    <div
      className={`fixed top-12 left-1/2 z-toast -translate-x-1/2 transform transition-[opacity,transform] duration-500 ease-out ${
        visible ? 'translate-y-0 opacity-100' : '-translate-y-8 opacity-0 pointer-events-none'
      }`}
    >
      <div
        className={`px-6 py-3 rounded-xl shadow-panel border flex items-center gap-3 ${
          isSuccess
            ? 'bg-green-500/20 border-green-500/30 text-green-100'
            : 'bg-red-500/20 border-red-500/30 text-red-100'
        }`}
      >
        {isSuccess ? (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        )}
        <span className="font-medium text-sm">{notification.message}</span>
      </div>
    </div>
  )
}

