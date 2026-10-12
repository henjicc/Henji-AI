import i18n from './config'
import type ui from './locales/en-US/ui.json'

export type NotificationKey = keyof typeof ui.notifications
export interface SystemNotification { key: NotificationKey; values?: Record<string, string | number> }
export type NotificationMessage = string | SystemNotification

/** Store system wording as a key so a visible toast follows language changes. */
export function notificationMessage(key: NotificationKey, values?: SystemNotification['values']): SystemNotification {
  return { key, ...(values ? { values } : {}) }
}

/** For existing string callbacks; resolve at the moment feedback is emitted. */
export function notificationText(key: NotificationKey, values?: SystemNotification['values']): string {
  return i18n.t(`ui:notifications.${key}`, values)
}
