import { useEffect, useRef } from 'react'
import { getMcpConnectionService } from '@/commands/mcp'
import { useNotification } from '@/contexts/NotificationContext'
import { createLogger } from '@/core/logging'
import { useI18n } from '@/hooks/useI18n'
import { openSettingsPanel } from '@/stores/uiStore'

const logger = createLogger('features.settings.mcp')

/** 根层只挂一次；每分钟和回到应用时检查，提醒与其他通知错开，不要求设置页打开。 */
export function McpExpiryNotifications(): null {
  const { notification, showNotification } = useNotification()
  const { t } = useI18n('settings')
  const occupied = useRef(Boolean(notification))
  occupied.current = Boolean(notification)
  useEffect(() => {
    let disposed = false
    let checking = false
    const check = async (): Promise<void> => {
      if (disposed || checking || occupied.current || document.visibilityState === 'hidden') return
      checking = true
      try {
        const service = getMcpConnectionService()
        const status = await service.status()
        if (disposed || occupied.current) return
        const connection = status.connections.find(item => item.reminder)
        if (!connection?.reminder) return
        const state = connection.reminder
        // 先持久化本次状态，再展示；重启不重复，续期后的新到期时间独立去重。
        const claimed = await service.acknowledgeReminder({ id: connection.id, expiresAt: connection.expiresAt, state })
        if (disposed || !claimed) return
        showNotification(t(state === 'expired' ? 'mcp.reminderExpired' : 'mcp.reminderExpiring', { name: connection.name }),
          state === 'expired' ? 'error' : 'warning', {
            label: t('mcp.openConnections'),
            onClick: () => openSettingsPanel({ tab: 'assistant', sectionId: 'assistant-mcp' }),
          })
      } catch (error) {
        logger.warn('检查外部连接到期提醒失败', { event: 'mcp.reminder.failed', error })
      } finally { checking = false }
    }
    const onVisible = (): void => { void check() }
    void check()
    const timer = setInterval(onVisible, 60_000)
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)
    return () => { disposed = true; clearInterval(timer); window.removeEventListener('focus', onVisible); document.removeEventListener('visibilitychange', onVisible) }
  }, [showNotification, t])
  return null
}
