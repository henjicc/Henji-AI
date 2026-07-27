import React, { useEffect, useState } from 'react'
import { useI18n } from '@/hooks/useI18n'
import { UI_TEXT_BODY_CLASS, UI_TEXT_TITLE_CLASS, UiButton, UiModal } from '@/components/ui'

export interface ClearHistoryDialogProps {
  open: boolean
  onClose: () => void
  onClearFailed: () => Promise<void>
  onClearAll: () => Promise<void>
}

export function ClearHistoryDialog({ open, onClose, onClearFailed, onClearAll }: ClearHistoryDialogProps): JSX.Element {
  const { t } = useI18n()
  // 「全部删除」需要点两次：第一次进入待确认态，第二次才真正执行
  const [needsConfirm, setNeedsConfirm] = useState(false)

  useEffect(() => {
    if (!open) setNeedsConfirm(false)
  }, [open])

  const close = (): void => {
    setNeedsConfirm(false)
    onClose()
  }

  return (
    <UiModal
      isOpen={open}
      title={t('ui:workspace.clearDialog.title')}
      onClose={close}
      hideHeader
      widthClassName="w-[400px]"
      contentClassName="p-4"
    >
      <div className={UI_TEXT_TITLE_CLASS}>{t('ui:workspace.clearDialog.title')}</div>
      <div className={`mt-2 ${UI_TEXT_BODY_CLASS}`}>{t('ui:workspace.clearDialog.subtitle')}</div>

      <div className="mt-4 flex flex-col gap-2">
        <UiButton
          onClick={async () => {
            await onClearFailed()
            close()
          }}
          className="h-9 bg-yellow-600/70 text-white hover:bg-yellow-600"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          {t('ui:workspace.clearDialog.failedOnly')}
        </UiButton>

        <UiButton
          onClick={async () => {
            if (needsConfirm) {
              await onClearAll()
              close()
              return
            }
            setNeedsConfirm(true)
          }}
          className={`h-9 text-white transition-colors ${needsConfirm ? 'animate-pulse-scale bg-red-700 hover:bg-red-800' : 'bg-red-600/70 hover:bg-red-600'}`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          {needsConfirm ? t('ui:workspace.clearDialog.confirmDelete') : t('ui:workspace.clearDialog.deleteAll')}
        </UiButton>

        <UiButton onClick={close} variant="muted" className="h-9">
          {t('common:cancel')}
        </UiButton>
      </div>
    </UiModal>
  )
}
