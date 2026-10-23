import { createPortal } from 'react-dom'
import React, { useCallback, useMemo, useState } from 'react'

import AlertDialog, { type AlertDialogAction } from './AlertDialog'
import { formatPaidApprovalMessage } from '@/i18n/paidApproval'
import { useI18n } from '@/hooks/useI18n'
import { createLogger } from '@/core/logging'
import { useAlertDialogStore } from '@/stores/alertDialogStore'
import { useUiStore } from '@/stores/uiStore'
import type { AlertDialogRequest } from '@/stores/alertDialogStore'
import type { OperationReviewItem } from '@/core/application-control/operationReview'

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
  const review: Partial<OperationReviewItem> | undefined = current?.review
  const dialogKey = useMemo(() => current ? crypto.randomUUID() : undefined, [current])
  const dismissCurrent = useAlertDialogStore((state) => state.dismissCurrent)
  const confirmCurrent = useAlertDialogStore((state) => state.confirmCurrent)
  const openSettings = useUiStore((state) => state.openSettings)
  const [copied, setCopied] = useState(false)

  const handleClose = useCallback((): void => {
    if (useAlertDialogStore.getState().queue[0] !== current) return
    setCopied(false)
    dismissCurrent()
  }, [current, dismissCurrent])

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

    if (current.review) return (review?.executed
      ? [['completed', t('operationReview.acknowledge')]] as const
      : [['not_executed', t('operationReview.notExecuted')], ['completed', t('operationReview.completed')]] as const).map(([decision, label]) => ({
      label, variant: current.review?.preferred === decision ? 'primary' : 'quiet', onClick: () => {
        if (useAlertDialogStore.getState().queue[0] === current) current.review?.resolve(decision)
      },
    }))

    if (current.confirmation) {
      if (current.confirmation.project) result.push({ label: t('paidApproval.alwaysAllowProject'), variant: 'secondary', onClick: () => {
        if (useAlertDialogStore.getState().queue[0] === current) confirmCurrent(true)
      } })
      return [...result, { label: current.confirmation.paid ? t('paidApproval.allowOnce') : current.confirmation.label, variant: 'primary', tone: current.confirmation.tone, onClick: () => {
        if (useAlertDialogStore.getState().queue[0] === current) confirmCurrent()
      } }]
    }

    if (current.detail) {
      const detail = current.detail
      result.push({
        label: copied ? t('alertDialog.detailCopied') : t('alertDialog.copyDetail'),
        variant: 'secondary',
        onClick: () => { void handleCopyDetail(detail) },
      })
    }

    if (onAskAssistant && current.type !== 'info') {
      result.push({
        label: t('alertDialog.askAssistant'),
        variant: 'secondary',
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
        label: t(target.sectionId === 'providers'
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
  }, [copied, current, review, confirmCurrent, handleClose, handleCopyDetail, onAskAssistant, openSettings, t])

  if (!current) {
    return null
  }

  // 全局确认须与编辑器弹窗处于同一 DOM 层，避免被后挂载的 portal 遮住。
  return createPortal(
    <AlertDialog
      key={dialogKey}
      isOpen
      title={current.review ? t(review?.executed ? 'operationReview.executedTitle' : 'operationReview.title') : current.title}
      message={current.paidDetails ? `${current.message}\n\n${formatPaidApprovalMessage(current.paidDetails)}` : current.message}
      type={current.type ?? 'error'}
      actions={actions}
      closeLabel={current.review ? t('operationReview.later') : current.confirmation?.paid ? t('paidApproval.deny') : current.confirmation ? t('cancel') : undefined}
      closeVariant={current.review || current.confirmation?.paid ? 'quiet' : 'secondary'}
      actionLayout={current.review ? 'review' : 'standard'}
      closeImmediately={Boolean(current.confirmation || current.review)}
      onClose={handleClose}
    />,
    document.body,
  )
}
