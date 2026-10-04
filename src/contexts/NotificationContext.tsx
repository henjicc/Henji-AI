import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import { UI_TOAST_DISPLAY_MS, UI_TOAST_EXIT_MS } from '@/components/ui/motion'
import { UiToast, type UiToastTone } from '@/components/ui/UiToast'

interface NotificationState {
    message: string
    type: UiToastTone
}

interface NotificationContextValue {
    notification: NotificationState | null
    notificationVisible: boolean
    showNotification: (message: string, type?: UiToastTone) => void
}

const NotificationContext = createContext<NotificationContextValue | null>(null)

export const useNotification = () => {
    const context = useContext(NotificationContext)
    if (!context) {
        throw new Error('useNotification must be used within NotificationProvider')
    }
    return context
}

interface NotificationProviderProps {
    children: React.ReactNode
}

export const NotificationProvider: React.FC<NotificationProviderProps> = ({ children }) => {
    const [notification, setNotification] = useState<NotificationState | null>(null)
    const [notificationVisible, setNotificationVisible] = useState(false)
    const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const clearTimers = useCallback(() => {
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
        if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
        hideTimerRef.current = null
        clearTimerRef.current = null
    }, [])

    const showNotification = useCallback((message: string, type: UiToastTone = 'success') => {
        clearTimers()
        setNotification({ message, type })
        setNotificationVisible(true)
        // 停留后淡出，淡出结束再卸载（时长与 UiToast 的 duration-240 同档）
        hideTimerRef.current = setTimeout(() => {
            setNotificationVisible(false)
            clearTimerRef.current = setTimeout(() => setNotification(null), UI_TOAST_EXIT_MS)
        }, UI_TOAST_DISPLAY_MS)
    }, [clearTimers])

    useEffect(() => clearTimers, [clearTimers])

    return (
        <NotificationContext.Provider value={{ notification, notificationVisible, showNotification }}>
            {children}
            {notification && (
                <UiToast message={notification.message} tone={notification.type} visible={notificationVisible} />
            )}
        </NotificationContext.Provider>
    )
}

export default NotificationContext
