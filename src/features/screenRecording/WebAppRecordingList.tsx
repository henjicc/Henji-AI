import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, FolderOpen, ListChecks, Pencil, Trash2 } from 'lucide-react'
import ContextMenu from '@/components/ContextMenu'
import { UI_TEXT_META_CLASS, UiButton, UiIconButton, UiInput, UiModal, UiOptionButton, UiVirtualList } from '@/components/ui'
import { UI_TEXT_TIMECODE_CLASS } from '@/components/ui/styleTokens'
import { useNotification } from '@/contexts/NotificationContext'
import { useContextMenu } from '@/hooks/useContextMenu'
import { useMultiSelect } from '@/hooks/useMultiSelect'
import { getPlatform } from '@/platform'
import type { WebRecordingSummary } from '@/platform/contracts/webReplay'
import { recordingTimeLabel } from './useRecordingControlSnapshot'
import type { WebAppRecordingModel } from './useWebAppRecording'

/** The name a recording shows: what the user called it, or the app name plus when it was recorded. */
function webRecordingTitle(recording: WebRecordingSummary): string {
  return recording.title ?? `${recording.app.name} · ${new Date(recording.createdAt).toLocaleString()}`
}

/** Batch names follow the list order: “名称 01”, “名称 02”… (a single recording keeps the name as typed). */
function numberedTitles(base: string, count: number): string[] {
  const width = Math.max(2, String(count).length)
  return count === 1 ? [base] : Array.from({ length: count }, (_value, index) => `${base} ${String(index + 1).padStart(width, '0')}`)
}

function RenameDialog({ recordings, onClose, onRename }: { recordings: WebRecordingSummary[]; onClose(): void; onRename(titles: string[]): Promise<void> }): React.ReactElement {
  const { t } = useTranslation('ui')
  const [name, setName] = useState(() => recordings.length === 1 ? webRecordingTitle(recordings[0]) : '')
  const [busy, setBusy] = useState(false)
  const base = name.trim()
  const titles = base ? numberedTitles(base, recordings.length) : []
  const submit = async (): Promise<void> => {
    if (!base) return
    setBusy(true)
    try { await onRename(titles); onClose() } finally { setBusy(false) }
  }
  return <UiModal isOpen size="compact" title={recordings.length === 1 ? t('recording.webapp_rename') : t('recording.webapp_renameMany', { count: recordings.length })} onClose={onClose}
    footer={<><UiButton variant="secondary" onClick={onClose}>{t('recording.webapp_cancel')}</UiButton><UiButton variant="primary" loading={busy} disabled={!base} disabledReason={t('recording.webapp_nameRequired')} onClick={() => void submit()}>{t('recording.webapp_rename')}</UiButton></>}>
    <div className="flex flex-col gap-2">
      <UiInput autoFocus value={name} maxLength={110} aria-label={t('recording.webapp_name')} placeholder={t('recording.webapp_name')} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void submit() }} />
      {recordings.length > 1 && titles.length > 0 && <p className="text-xs text-text3">{t('recording.webapp_renamePreview', { first: titles[0], last: titles.at(-1) })}</p>}
    </div>
  </UiModal>
}

/**
 * Saved web recordings: click to preview, double-click or the menu to rename, right-click for the
 * rest. Multi-select renames (numbered), exports videos or deletes several at once; deleting can be undone.
 */
export function WebAppRecordingList({ model }: { model: WebAppRecordingModel }): React.ReactElement {
  const { t } = useTranslation('ui')
  const { showNotification } = useNotification()
  const menu = useContextMenu()
  const ids = useMemo(() => model.recordings.map(item => item.id), [model.recordings])
  const selection = useMultiSelect(ids)
  const [renaming, setRenaming] = useState<WebRecordingSummary[] | null>(null)
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null)
  const chosen = model.recordings.filter(item => selection.isSelected(item.id))
  const remove = async (items: WebRecordingSummary[]): Promise<void> => {
    const removed = await model.removeMany(items.map(item => item.id))
    if (!removed.length) return
    selection.exit()
    showNotification(t('recording.webapp_removedCount', { count: removed.length }), 'success', { label: t('recording.webapp_undo'), onClick: () => void model.restoreMany(removed) })
  }
  const exportVideos = async (items: WebRecordingSummary[]): Promise<void> => {
    const picked = await getPlatform().system.dialog.open({ directory: true, multiple: false })
    const directory = Array.isArray(picked) ? picked[0] : picked
    if (!directory) return
    const result = await model.exportVideos(items.map(item => item.id), directory)
    if (!result) return
    showNotification(result.files.length ? t('recording.webapp_exported', { count: result.files.length }) + (result.skipped ? t('recording.webapp_exportSkipped', { count: result.skipped }) : '') : t('recording.webapp_exportNothing'), result.files.length ? 'success' : 'warning')
  }
  const commitInline = async (): Promise<void> => {
    if (!editing) return
    const recording = model.recordings.find(item => item.id === editing.id)
    const title = editing.draft.trim()
    setEditing(null)
    if (recording && title && title !== webRecordingTitle(recording)) await model.rename([{ recordingId: recording.id, title: title.slice(0, 120) }])
  }
  const openMenu = (event: React.MouseEvent, recording: WebRecordingSummary): void => {
    event.preventDefault()
    const items = selection.active && selection.isSelected(recording.id) && chosen.length > 1 ? chosen : [recording]
    menu.showMenu(event, [
      { id: 'rename', label: items.length > 1 ? t('recording.webapp_renameMany', { count: items.length }) : t('recording.webapp_rename'), icon: <Pencil />, onClick: () => setRenaming(items) },
      { id: 'export', label: t('recording.webapp_exportVideos'), icon: <Download />, onClick: () => void exportVideos(items) },
      ...(items.length === 1 ? [{ id: 'reveal', label: t('recording.webapp_reveal'), icon: <FolderOpen />, onClick: () => void model.reveal(recording.id) }] : []),
      { id: 'delete', label: t('recording.webapp_delete'), icon: <Trash2 />, divider: true, disabled: Boolean(model.activeId && items.some(item => item.id === model.activeId)), onClick: () => void remove(items) },
    ])
  }
  return <aside className="flex w-72 shrink-0 flex-col border-r border-gap bg-panel" aria-label={t('recording.webapp_recordings')}>
    <div className="flex h-11 shrink-0 items-center gap-2 px-3">
      {selection.active ? <>
        <span className={`${UI_TEXT_META_CLASS} min-w-0 flex-1`}>{t('recording.webapp_selected', { count: selection.count })}</span>
        <UiButton size="sm" onClick={selection.toggleAll}>{selection.isAllSelected ? t('recording.webapp_selectNone') : t('recording.webapp_selectAll')}</UiButton>
        <UiButton size="sm" onClick={selection.exit}>{t('recording.webapp_done')}</UiButton>
      </> : <>
        <span className="min-w-0 flex-1 text-xs font-semibold text-text2">{t('recording.webapp_recordings')}<span className="ml-1 font-normal text-text3">{model.recordings.length || ''}</span></span>
        <UiIconButton size="sm" disabled={!model.recordings.length} disabledReason={t('recording.webapp_noRecordings')} tooltip={t('recording.webapp_multiSelect')} aria-label={t('recording.webapp_multiSelect')} onClick={() => selection.enter(model.selectedRecording?.id)}><ListChecks /></UiIconButton>
      </>}
    </div>
    <div className="min-h-0 flex-1 px-2" role="listbox" aria-multiselectable={selection.active} aria-label={t('recording.webapp_recordings')}>
      <UiVirtualList data={model.recordings} getKey={item => item.id}
        emptyState={<p className="px-2 py-1 text-xs text-text3">{t('recording.webapp_noRecordings')}</p>}
        renderItem={item => <div className="pb-1">{editing?.id === item.id
          ? <UiInput autoFocus size="sm" value={editing.draft} maxLength={120} aria-label={t('recording.webapp_name')} onChange={event => setEditing({ id: item.id, draft: event.target.value })} onBlur={() => void commitInline()} onKeyDown={event => { if (event.key === 'Enter') void commitInline(); if (event.key === 'Escape') setEditing(null) }} />
          : <UiOptionButton variant="menu" className="w-full" {...(selection.active ? { selection: 'multiple' as const, active: selection.isSelected(item.id) } : { active: item.id === model.selectedRecording?.id })}
            onClick={() => selection.active ? selection.toggle(item.id) : model.selectRecording(item.id)}
            onDoubleClick={() => { if (!selection.active) setEditing({ id: item.id, draft: webRecordingTitle(item) }) }}
            onContextMenu={event => openMenu(event, item)}>
            <span className="flex min-w-0 flex-col items-start gap-0.5">
              <span className="w-full truncate text-left">{webRecordingTitle(item)}</span>
              <span className={`${UI_TEXT_TIMECODE_CLASS} text-xs text-text3`}>{recordingTimeLabel(item.durationUs / 1000)}{item.title ? ` · ${new Date(item.createdAt).toLocaleString()}` : ''}{item.status === 'complete' ? '' : ` · ${t(`recording.webapp_status_${item.status}`)}`}</span>
            </span>
          </UiOptionButton>}</div>} />
    </div>
    {selection.active && <div className="flex shrink-0 items-center gap-1 border-t border-gap px-2 py-2">
      <UiButton size="sm" disabled={!chosen.length} disabledReason={t('recording.webapp_selectFirst')} onClick={() => setRenaming(chosen)}><Pencil />{t('recording.webapp_rename')}</UiButton>
      <UiButton size="sm" disabled={!chosen.length} disabledReason={t('recording.webapp_selectFirst')} onClick={() => void exportVideos(chosen)}><Download />{t('recording.webapp_export')}</UiButton>
      <span className="flex-1" />
      <UiButton size="sm" variant="danger" disabled={!chosen.length} disabledReason={t('recording.webapp_selectFirst')} onClick={() => void remove(chosen)}><Trash2 />{t('recording.webapp_delete')}</UiButton>
    </div>}
    {renaming && <RenameDialog recordings={renaming} onClose={() => setRenaming(null)} onRename={titles => model.rename(renaming.map((item, index) => ({ recordingId: item.id, title: titles[index] })))} />}
    <ContextMenu visible={menu.menuVisible} position={menu.menuPosition} items={menu.menuItems} onClose={menu.hideMenu} />
  </aside>
}
