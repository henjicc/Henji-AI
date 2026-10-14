import type { NotificationMessage } from '@/i18n/notifications'
import React, { createContext, useContext, useCallback, useEffect } from 'react'
import { useTimedToast } from '@/components/ui/useDialogTransition'
import { UiToast, type UiToastTone, type UiToastAction } from '@/components/ui/UiToast'

interface NotificationState {
    message: NotificationMessage
    type: UiToastTone
    action?: UiToastAction
}

interface NotificationContextValue {
    notification: NotificationState | null
    notificationVisible: boolean
    showNotification: (message: NotificationMessage, type?: UiToastTone, action?: UiToastAction) => void
}

const NotificationContext = createContext<NotificationContextValue | null>(null)

const notificationEvents = new EventTarget()
/** Domain services use the existing root toast without mounting another provider. */
export function notifyUser(message: NotificationMessage, type: UiToastTone = 'success', action?: UiToastAction): void {
    notificationEvents.dispatchEvent(new CustomEvent<NotificationState>('notification', { detail: { message, type, ...(action ? { action } : {}) } }))
}

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
    const { notification, visible: notificationVisible, show } = useTimedToast<NotificationState>()
    const showNotification = useCallback((message: NotificationMessage, type: UiToastTone = 'success', action?: UiToastAction) => {
        show({ message, type, ...(action ? { action } : {}) })
    }, [show])

    useEffect(() => {
        const receive = (event: Event): void => { const { message, type, action } = (event as CustomEvent<NotificationState>).detail; showNotification(message, type, action) }
        notificationEvents.addEventListener('notification', receive)
        return () => notificationEvents.removeEventListener('notification', receive)
    }, [showNotification])

    return (
        <NotificationContext.Provider value={{ notification, notificationVisible, showNotification }}>
            {children}
            {notification && (
                <UiToast message={notification.message} tone={notification.type} visible={notificationVisible} action={notification.action} />
            )}
        </NotificationContext.Provider>
    )
}

export default NotificationContext
