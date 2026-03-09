import { useEffect, useRef } from 'react'

interface UseFilePickerExpandLockParams {
  beginExpandLock: () => void
  endExpandLock: (durationMs?: number) => void
  successHoldMs?: number
  cancelHoldMs?: number
}

interface UseFilePickerExpandLockReturn {
  beginFilePickerLock: () => void
  resolvePicker: (hasSelection: boolean) => void
}

export function useFilePickerExpandLock(params: UseFilePickerExpandLockParams): UseFilePickerExpandLockReturn {
  const {
    beginExpandLock,
    endExpandLock,
    successHoldMs = 2400,
    cancelHoldMs = 380
  } = params

  const pickerPendingRef = useRef(false)
  const pickerCloseListenerRef = useRef<(() => void) | null>(null)
  const pickerFallbackTimerRef = useRef<number | null>(null)

  const clearListeners = (): void => {
    pickerCloseListenerRef.current?.()
    pickerCloseListenerRef.current = null
    if (pickerFallbackTimerRef.current !== null) {
      window.clearTimeout(pickerFallbackTimerRef.current)
      pickerFallbackTimerRef.current = null
    }
  }

  const resolvePicker = (hasSelection: boolean): void => {
    pickerPendingRef.current = false
    clearListeners()
    endExpandLock(hasSelection ? successHoldMs : cancelHoldMs)
  }

  const beginFilePickerLock = (): void => {
    beginExpandLock()
    pickerPendingRef.current = true
    clearListeners()

    const handleWindowFocus = () => {
      pickerFallbackTimerRef.current = window.setTimeout(() => {
        pickerFallbackTimerRef.current = null
        if (!pickerPendingRef.current) return
        pickerPendingRef.current = false
        endExpandLock(cancelHoldMs)
      }, 420)
      window.removeEventListener('focus', handleWindowFocus)
    }

    window.addEventListener('focus', handleWindowFocus)
    pickerCloseListenerRef.current = () => {
      window.removeEventListener('focus', handleWindowFocus)
    }
  }

  useEffect(() => {
    return () => {
      clearListeners()
      pickerPendingRef.current = false
    }
  }, [])

  return {
    beginFilePickerLock,
    resolvePicker
  }
}
