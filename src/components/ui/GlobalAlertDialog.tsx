import React, { useCallback, useMemo, useState } from 'react'

import AlertDialog, { type AlertDialogAction } from './AlertDialog'
import { useI18n } from '@/hooks/useI18n'
import { createLogger } from '@/core/logging'
import { useAlertDialogStore } from '@/stores/alertDialogStore'
import { useUiStore } from '@/stores/uiStore'
import type { AlertDialogRequest } from '@/stores/alertDialogStore'

const logger = createLogger('components.ui.globalAlertDialog')

/**
 * 全局报错/提示弹窗的唯一渲染点（在 App.tsx 挂载一次）。
 *
 * 业务侧只调用 `showAlertDialog({...})` 描述"发生了什么、能不能去设置、有没有细节可复制"，
 * 按钮的组装与行为都收在这里，避免各页面各写一套开关 state。
 */
interface GlobalAlertDialogProps {
  onAskAssistant?: (context: Pick<AlertDialogRequest, 'title' | 'message'> & NonNullable<AlertDialogRequest['diagnostic']>) => void
}

export const GlobalAlertDialog: React.FC<GlobalAlertDialogProps> = ({ onAskAssistant }) => {
  const { t } = useI18n('common')
  const current = useAlertDialogStore((state) => state.queue[0] ?? null)
  const dismissCurrent = useAlertDialogStore((state) => state.dismissCurrent)
  const openSettings = useUiStore((state) => state.openSettings)
  const [copied, setCopied] = useState(false)

  const handleClose = useCallback((): void => {
    setCopied(false)
    dismissCurrent()
  }, [dismissCurrent])

  const handleCopyDetail = useCallback(async (detail: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(detail)
      setCopied(true)
    } catch (error) {
      logger.error('alert_dialog.copy_detail.failed', { error: String(error) })
    }
  }, [])

  const actions = useMemo<AlertDialogAction[]>(() => {
    if (!current) {
      return []
    }
    const result: AlertDialogAction[] = []

    if (current.detail) {
      const detail = current.detail
      result.push({
        label: copied ? t('alertDialog.detailCopied') : t('alertDialog.copyDetail'),
        variant: 'muted',
        onClick: () => { void handleCopyDetail(detail) },
      })
    }

    if (onAskAssistant && current.type !== 'info') {
      result.push({
        label: '问助手',
        variant: 'muted',
        onClick: () => {
          const context = { title: current.title, message: current.message, ...current.diagnostic }
          handleClose()
          onAskAssistant(context)
        },
      })
    }

    if (current.settingsTarget) {
      const target = current.settingsTarget
      result.push({
        label: t(target.sectionId === 'api-keys'
          ? 'alertDialog.goToConfigure'
          : 'alertDialog.goToSettings'),
        variant: 'primary',
        onClick: () => {
          // 先关掉弹窗再开设置，避免两层遮罩叠在一起
          handleClose()
          openSettings(target)
        },
      })
    }

    return result
  }, [copied, current, handleClose, handleCopyDetail, onAskAssistant, openSettings, t])

  if (!current) {
    return null
  }

  return (
    <AlertDialog
      isOpen
      title={current.title}
      message={current.message}
      type={current.type ?? 'error'}
      actions={actions}
      onClose={handleClose}
    />
  )
}
