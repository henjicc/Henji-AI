import React, { useEffect, useState } from 'react'
import { useI18n } from '@/hooks/useI18n'
import { UI_TEXT_BODY_CLASS, UI_TEXT_TITLE_CLASS, UiButton, UiModal } from '@/components/ui'
import { Trash2, TriangleAlert } from 'lucide-react'

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
          <TriangleAlert className="mr-2 h-4 w-4" />
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
          <Trash2 className="mr-2 h-4 w-4" />
          {needsConfirm ? t('ui:workspace.clearDialog.confirmDelete') : t('ui:workspace.clearDialog.deleteAll')}
        </UiButton>

        <UiButton onClick={close} variant="muted" className="h-9">
          {t('common:cancel')}
        </UiButton>
      </div>
    </UiModal>
  )
}
