import { useCallback, useEffect, useRef, useState } from 'react'
import { UI_TOAST_DISPLAY_MS, UI_TOAST_EXIT_MS } from '@/components/ui/motion'
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
  const exitTimerRef = useRef<number | null>(null)

  const clearTimers = useCallback((): void => {
    if (timerRef.current) window.clearTimeout(timerRef.current)
    if (exitTimerRef.current) window.clearTimeout(exitTimerRef.current)
    timerRef.current = null
    exitTimerRef.current = null
  }, [])

  const clear = useCallback((): void => {
    clearTimers()
    setVisible(false)
    setNotification(null)
  }, [clearTimers])

  const show = useCallback((message: string, type: ToastNotification['type'] = 'success'): void => {
    // 淡出中的上一条的卸载定时器也要取消，否则会把刚出现的新通知清掉
    clearTimers()

    setNotification({ message, type })
    // 用 setTimeout 避免某些平台下 rAF 暂停导致不显示
    window.setTimeout(() => setVisible(true), 0)

    timerRef.current = window.setTimeout(() => {
      setVisible(false)
      exitTimerRef.current = window.setTimeout(() => {
        setNotification(null)
      }, UI_TOAST_EXIT_MS)
    }, UI_TOAST_DISPLAY_MS)
  }, [clearTimers])

  useEffect(() => clear, [clear])

  return { notification, visible, show, clear }
}

