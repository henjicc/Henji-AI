import { useCallback, useEffect, useRef, useState } from 'react'
import type { ToastNotification } from '../types'

export interface UseToastReturn {
  notification: ToastNotification | null
  visible: boolean
  show: (message: string, type?: ToastNotification['type']) => void
  clear: () => void
}

export function useToast(): UseToastReturn {
  const [notification, setNotification] = useState<ToastNotification | null>(null)
  const [visible, setVisible] = useState(false)
  const timerRef = useRef<number | null>(null)

  const clear = useCallback((): void => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setVisible(false)
    setNotification(null)
  }, [])

  const show = useCallback((message: string, type: ToastNotification['type'] = 'success'): void => {
    if (timerRef.current) window.clearTimeout(timerRef.current)

    setNotification({ message, type })
    // 用 setTimeout 避免某些平台下 rAF 暂停导致不显示
    window.setTimeout(() => setVisible(true), 0)

    timerRef.current = window.setTimeout(() => {
      setVisible(false)
      window.setTimeout(() => {
        setNotification(null)
      }, 500)
    }, 3000)
  }, [])

  useEffect(() => clear, [clear])

  return { notification, visible, show, clear }
}

