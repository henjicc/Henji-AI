import { useCallback, useEffect, useState } from 'react'
import { ArchiveRestore } from 'lucide-react'
import { UiButton, UiEmpty, UiError, UiIconButton, UiLoading, UiModal, UiRecordItem, UiRecordList, UiVirtualList } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { listDeleted, restoreDeleted } from '@/services/recycle'
import type { RecycledItem } from '@/core/localRecords/recycle'

export function RecentlyDeleted(): JSX.Element {
  const { t } = useI18n('settings')
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<RecycledItem[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const load = useCallback(async (): Promise<void> => {
    setError('')
    try { setItems(await listDeleted()) } catch (reason) { setError(String(reason)) }
  }, [])
  useEffect(() => { if (open) void load() }, [open, load])
  const restore = async (id: string): Promise<void> => {
    setBusy(id); setError('')
    try { await restoreDeleted(id); await load() } catch (reason) { setError(String(reason)) }
    finally { setBusy(null) }
  }
  return <>
    <UiButton tooltip={t('recentlyDeleted.retention')} onClick={() => setOpen(true)}><ArchiveRestore />{t('recentlyDeleted.title')}</UiButton>
    <UiModal isOpen={open} title={t('recentlyDeleted.title')} onClose={() => setOpen(false)} size="form">
      {error && <UiError title={t('recentlyDeleted.failed')} message={error} onRetry={() => void load()} />}
      {!items ? <UiLoading /> : items.length === 0 ? <UiEmpty title={t('recentlyDeleted.empty')} /> : <UiRecordList>
        <UiVirtualList data={items} getKey={item => item.id} renderItem={(item, index) => <UiRecordItem index={index} density="compact" title={item.name}
          meta={[item.category, new Date(item.deletedAt).toLocaleString()]}
          actions={<UiIconButton size="sm" label={t('recentlyDeleted.restore')} tooltip={t('recentlyDeleted.restore')} disabled={busy !== null && busy !== item.id} loading={busy === item.id} onClick={() => void restore(item.id)}><ArchiveRestore /></UiIconButton>} />} />
      </UiRecordList>}
    </UiModal>
  </>
}
