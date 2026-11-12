import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Trash2 } from 'lucide-react'
import { UiButton, UiError, UiGroup, UiIconButton } from '@/components/ui'
import { getPlatform } from '@/platform'
import type { RecoveredRecording } from '@/core/screenRecording/capture'
import { listInterruptedRecordings } from './application/recordingService'
import { recordingTimeLabel } from './useRecordingControlSnapshot'

/** 意外中断后已恢复、还没进剪辑的录制：在录制设置最上面列出来，可以直接打开剪辑或移到回收站。 */
export function RecordingRecoveryBanner(): JSX.Element | null {
  const { t } = useTranslation('ui')
  const [items, setItems] = useState<RecoveredRecording[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let disposed = false
    void listInterruptedRecordings().then(found => { if (!disposed) setItems(found) }).catch((raw: unknown) => { if (!disposed) setError(raw instanceof Error ? raw.message : String(raw)) })
    return () => { disposed = true }
  }, [])
  const run = async (documentId: string, operation: () => Promise<unknown>): Promise<void> => {
    setBusy(documentId); setError('')
    try { await operation(); setItems(current => current.filter(item => item.documentId !== documentId)) }
    catch (raw) { setError(raw instanceof Error ? raw.message : String(raw)) }
    finally { setBusy(null) }
  }
  if (!items.length && !error) return null
  return <UiGroup title={t('recording.interruptedTitle')} titleTone="compact">
    {items.map(item => <div key={item.documentId} className="flex min-w-0 items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-xs text-text2">{t('recording.interruptedItem', { name: item.name, duration: recordingTimeLabel(item.durationUs / 1000) })}</span>
      <UiButton variant="secondary" size="sm" loading={busy === item.documentId} disabled={busy !== null} disabledReason={t('recording.interruptedBusy')} onClick={() => void run(item.documentId, async () => (await import('./application/recordingVideoImport')).openRecordingInEditor(item.documentId))}>{t('recording.interruptedOpen')}</UiButton>
      <UiIconButton tone="danger" size="sm" tooltip={t('recording.interruptedTrash')} disabled={busy !== null} disabledReason={t('recording.interruptedBusy')} onClick={() => void run(item.documentId, () => getPlatform().documents.trashDocument({ id: item.documentId }))}><Trash2 /></UiIconButton>
    </div>)}
    {error && <UiError message={error} />}
  </UiGroup>
}
