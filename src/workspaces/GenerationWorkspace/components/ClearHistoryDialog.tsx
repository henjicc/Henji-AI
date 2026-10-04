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
      size="compact"
      contentClassName="p-4"
    >
      <div className={UI_TEXT_TITLE_CLASS}>{t('ui:workspace.clearDialog.title')}</div>
      <div className={`mt-2 ${UI_TEXT_BODY_CLASS}`}>{t('ui:workspace.clearDialog.subtitle')}</div>

      <div className="mt-4 flex flex-col gap-2">
        <UiButton size="lg" variant="secondary"
          onClick={async () => {
            await onClearFailed()
            close()
          }}
        >
          <TriangleAlert className="h-4 w-4" />
          {t('ui:workspace.clearDialog.failedOnly')}
        </UiButton>

        <UiButton size="lg" variant={needsConfirm ? 'dangerSolid' : 'danger'}
          onClick={async () => {
            if (needsConfirm) {
              await onClearAll()
              close()
              return
            }
            setNeedsConfirm(true)
          }}
        >
          <Trash2 className="h-4 w-4" />
          {needsConfirm ? t('ui:workspace.clearDialog.confirmDelete') : t('ui:workspace.clearDialog.deleteAll')}
        </UiButton>

        <UiButton size="lg" onClick={close}>
          {t('common:cancel')}
        </UiButton>
      </div>
    </UiModal>
  )
}
