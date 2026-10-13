import { useCallback } from 'react'
import { useTimedToast } from '@/components/ui/useDialogTransition'
import type { ToastNotification } from '../types'

export interface UseToastReturn {
  notification: ToastNotification | null
  visible: boolean
  show: (message: string, type?: ToastNotification['type']) => void
  clear: () => void
}

export function useToast(): UseToastReturn {
  const { notification, visible, show: showToast, clear } = useTimedToast<ToastNotification>()
  const show = useCallback((message: string, type: ToastNotification['type'] = 'success'): void => {
    showToast({ message, type })
  }, [showToast])
  return { notification, visible, show, clear }
}
