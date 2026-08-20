import React, { useEffect, useMemo, useState } from 'react'
import { CheckSquare2, LoaderCircle, Tags, Trash2, X } from 'lucide-react'
import { Dropdown, UI_TEXT_META_CLASS, UiButton, UiChipButton, UiError, UiGroup, UiIconButton, UiInput } from '@/components/ui'
import type { AssetLibraryRecord } from '@/platform/contracts/assetLibrary'
import { useI18n } from '@/hooks/useI18n'

interface Props {
  selectedCount: number
  loadedCount: number
  libraries: AssetLibraryRecord[]
  availableTags: string[]
  busy: boolean
  error: string | null
  onSelectAll: () => void
  onClear: () => void
  onUpdateTags: (tags: string[], mode: 'add' | 'remove') => Promise<void>
  onUpdateLibrary: (libraryId: string, mode: 'add' | 'remove') => Promise<void>
  onDelete: () => Promise<void>
  onDone: () => void
}

export const AssetBatchManager: React.FC<Props> = ({
  selectedCount,
  loadedCount,
  libraries,
  availableTags,
  busy,
  error,
  onSelectAll,
  onClear,
  onUpdateTags,
  onUpdateLibrary,
  onDelete,
  onDone,
}) => {
  const { t } = useI18n('ui')
  const [tagDraft, setTagDraft] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [libraryId, setLibraryId] = useState(libraries[0]?.id ?? '')
  const [deleteArmed, setDeleteArmed] = useState(false)
  const disabled = busy || selectedCount === 0
  const suggestions = useMemo(() => availableTags.filter((tag) => !tags.includes(tag) && tag.toLocaleLowerCase().includes(tagDraft.trim().toLocaleLowerCase())).slice(0, 10), [availableTags, tagDraft, tags])

  useEffect(() => {
    if (!libraries.some((library) => library.id === libraryId)) setLibraryId(libraries[0]?.id ?? '')
  }, [libraries, libraryId])
  useEffect(() => { if (selectedCount === 0) setDeleteArmed(false) }, [selectedCount])

  const addDraftTags = (): void => {
    const nextTags = tagDraft.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean)
    if (nextTags.length === 0) return
    setTags((current) => [...new Set([...current, ...nextTags])])
    setTagDraft('')
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-border-dark bg-surface-dark">
      <div className="flex h-14 shrink-0 items-center gap-2 px-4">
        {busy ? <LoaderCircle className="h-4 w-4 animate-spin text-text-muted" /> : <CheckSquare2 className="h-4 w-4 text-text-muted" />}
        <div className="min-w-0 flex-1">
          <div className="font-medium text-text-dark">{t('assetLibrary.batchManage')}</div>
          <div className={UI_TEXT_META_CLASS}>{t('assetLibrary.batchSelected', { count: selectedCount })}</div>
        </div>
        <UiIconButton appearance="hover-only" showBorder={false} disabled={busy} className="!h-8 !w-8" onClick={onDone} title={t('assetLibrary.batchDone')}><X className="h-4 w-4" /></UiIconButton>
      </div>
      <div className="ui-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <p className={`mb-3 ${UI_TEXT_META_CLASS}`}>{t('assetLibrary.batchHint')}</p>
        <div className="mb-5 flex gap-2">
          <UiButton size="sm" className="flex-1" disabled={busy || loadedCount === 0} onClick={onSelectAll}>{t('assetLibrary.batchSelectAll')}</UiButton>
          <UiButton size="sm" variant="plain" className="flex-1" disabled={busy || selectedCount === 0} onClick={onClear}>{t('assetLibrary.batchClear')}</UiButton>
        </div>

        <UiGroup title={t('assetLibrary.batchTags')}>
          <div className="relative">
            <Tags className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <UiInput disabled={busy} className="!h-9 pl-8 text-xs" value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addDraftTags() }} placeholder={t('assetLibrary.tagPlaceholder')} />
          </div>
          {(tags.length > 0 || suggestions.length > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => <UiChipButton key={tag} active disabled={busy} className="!h-7 !px-2 text-xs" onClick={() => setTags((current) => current.filter((item) => item !== tag))}>{tag}</UiChipButton>)}
              {suggestions.map((tag) => <UiChipButton key={tag} disabled={busy} className="!h-7 !px-2 text-xs" onClick={() => { setTags((current) => [...current, tag]); setTagDraft('') }}>{tag}</UiChipButton>)}
            </div>
          )}
          <div className="flex gap-2">
            <UiButton size="sm" className="flex-1" disabled={disabled || tags.length === 0} onClick={() => void onUpdateTags(tags, 'add')}>{t('assetLibrary.batchTagAdd')}</UiButton>
            <UiButton size="sm" className="flex-1" disabled={disabled || tags.length === 0} onClick={() => void onUpdateTags(tags, 'remove')}>{t('assetLibrary.batchTagRemove')}</UiButton>
          </div>
        </UiGroup>

        <UiGroup divided title={t('assetLibrary.batchLibraries')} className="mt-5">
          <Dropdown<string> value={libraryId} options={libraries.map((library) => ({ value: library.id, label: library.name }))} onSelect={setLibraryId} className="w-full" buttonClassName="!h-9 w-full" panelWidthStrategy="button" disabled={busy || libraries.length === 0} />
          <div className="flex gap-2">
            <UiButton size="sm" className="flex-1" disabled={disabled || !libraryId} onClick={() => void onUpdateLibrary(libraryId, 'add')}>{t('assetLibrary.batchLibraryAdd')}</UiButton>
            <UiButton size="sm" className="flex-1" disabled={disabled || !libraryId} onClick={() => void onUpdateLibrary(libraryId, 'remove')}>{t('assetLibrary.batchLibraryRemove')}</UiButton>
          </div>
        </UiGroup>

        <UiGroup divided className="mt-5">
          {error ? <UiError size="xs" message={error} /> : null}
          <UiButton
            size="sm"
            className="w-full text-danger hover:bg-danger/35"
            disabled={disabled}
            onClick={() => {
              if (!deleteArmed) { setDeleteArmed(true); return }
              setDeleteArmed(false)
              void onDelete()
            }}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            {deleteArmed ? t('assetLibrary.batchConfirmDelete') : t('assetLibrary.batchDelete')}
          </UiButton>
        </UiGroup>
      </div>
    </aside>
  )
}
