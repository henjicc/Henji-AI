import React, { createContext, useContext, useState, useCallback, useRef } from 'react'

interface NotificationState {
    message: string
    type: 'success' | 'error'
}

interface NotificationContextValue {
    notification: NotificationState | null
    notificationVisible: boolean
    showNotification: (message: string, type?: 'success' | 'error') => void
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
    const notificationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const showNotification = useCallback((message: string, type: 'success' | 'error' = 'success') => {
        // 清除之前的定时器
        if (notificationTimeoutRef.current) {
            clearTimeout(notificationTimeoutRef.current)
        }

        // 设置新通知
        setNotification({ message, type })
        setNotificationVisible(true)

        // 2秒后开始淡出
        notificationTimeoutRef.current = setTimeout(() => {
            setNotificationVisible(false)
            // 淡出动画后清除通知
            setTimeout(() => {
                setNotification(null)
            }, 300)
        }, 2000)
    }, [])

    return (
        <NotificationContext.Provider value={{ notification, notificationVisible, showNotification }}>
            {children}
            {/* 通知 UI */}
            {notification && (
                <div
                    className={`fixed top-20 left-1/2 transform -translate-x-1/2 px-6 py-3 rounded-lg shadow-lg z-[9999] transition-opacity duration-300 ${notificationVisible ? 'opacity-100' : 'opacity-0'
                        }`}
                    style={{
                        backgroundColor: notification.type === 'success' ? 'rgba(34, 197, 94, 0.95)' : 'rgba(239, 68, 68, 0.95)',
                        color: 'white',
                        pointerEvents: 'none'
                    }}
                >
                    {notification.message}
                </div>
            )}
        </NotificationContext.Provider>
    )
}

export default NotificationContext
