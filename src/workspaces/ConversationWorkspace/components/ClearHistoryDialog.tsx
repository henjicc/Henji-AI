import React, { useEffect, useState } from 'react'
import { useI18n } from '@/hooks/useI18n'

export interface ClearHistoryDialogProps {
  open: boolean
  onClose: () => void
  onClearFailed: () => Promise<void>
  onClearAll: () => Promise<void>
}

export function ClearHistoryDialog({ open, onClose, onClearFailed, onClearAll }: ClearHistoryDialogProps): JSX.Element | null {
  const { t } = useI18n()
  const [opacity, setOpacity] = useState(0)
  const [needsConfirm, setNeedsConfirm] = useState(false)

  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => setOpacity(1))
  }, [open])

  if (!open) return null

  const close = () => {
    setOpacity(0)
    setNeedsConfirm(false)
    setTimeout(onClose, 180)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        style={{ opacity, transition: 'opacity 180ms ease' }}
        onClick={close}
      />
      <div
        className="relative bg-[#131313]/80 border border-zinc-700/50 rounded-xl p-4 w-[400px] shadow-2xl"
        style={{
          opacity,
          transform: `scale(${0.97 + 0.03 * opacity})`,
          transition: 'opacity 180ms ease, transform 180ms ease',
        }}
      >
        <div className="text-white text-base">{t('ui:workspace.clearDialog.title')}</div>
        <div className="text-zinc-300 text-sm mt-2">{t('ui:workspace.clearDialog.subtitle')}</div>

        <div className="mt-4 flex flex-col gap-2">
          <button
            onClick={async () => {
              await onClearFailed()
              close()
            }}
            className="h-9 px-3 inline-flex items-center justify-center rounded-md bg-yellow-600/70 hover:bg-yellow-600 text-white text-sm transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            {t('ui:workspace.clearDialog.failedOnly')}
          </button>

          <button
            onClick={async () => {
              if (needsConfirm) {
                await onClearAll()
                close()
                return
              }
              setNeedsConfirm(true)
            }}
            className={`h-9 px-3 inline-flex items-center justify-center rounded-md text-white text-sm transition-all ${
              needsConfirm ? 'bg-red-700 hover:bg-red-800 animate-pulse-scale' : 'bg-red-600/70 hover:bg-red-600'
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            {needsConfirm ? t('ui:workspace.clearDialog.confirmDelete') : t('ui:workspace.clearDialog.deleteAll')}
          </button>

          <button
            onClick={close}
            className="h-9 px-3 inline-flex items-center justify-center rounded-md bg-zinc-700/60 hover:bg-zinc-600/60 text-sm transition-colors"
          >
            {t('common:cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}

