import React from 'react'
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
  const close = (): void => {
    onClose()
  }

  return (
    <UiModal
      isOpen={open}
      title={t('ui:workspace.clearDialog.title')}
      onClose={close}
      hideHeader
      size="compact"
      contentPadding="default" contentScroll="auto"
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
          <TriangleAlert  />
          {t('ui:workspace.clearDialog.failedOnly')}
        </UiButton>

        <UiButton size="lg" variant="danger"
          onClick={async () => {
            await onClearAll()
            close()
          }}
        >
          <Trash2  />
          {t('ui:workspace.clearDialog.deleteAll')}
        </UiButton>

        <UiButton size="lg" onClick={close}>
          {t('common:cancel')}
        </UiButton>
      </div>
    </UiModal>
  )
}
