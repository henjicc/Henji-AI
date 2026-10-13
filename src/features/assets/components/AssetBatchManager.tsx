import { UiSpinner } from '@/components/ui'
import { UI_ICON_SIZE_CLASS } from '@/components/ui/styleTokens'
import { UiFormRow } from '@/components/ui'
import React, { useEffect, useMemo, useState } from 'react'
import { Tags, Trash2 } from 'lucide-react'
import { Dropdown, UI_GLASS_ADAPTIVE_DIVIDER_CLASS, UI_TEXT_META_CLASS, UiButton, UiChipButton, UiError, UiGroup, UiInput } from '@/components/ui'
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
    // 批量操作侧栏：与左侧资产库侧栏同级，只用一条分隔线，不另铺更亮的底（那会浮成一张卡）。
    // 标题、已选数量与“完成”都在页头命令带里，这里不再重复一条头带。
    <aside aria-label={t('assetLibrary.batchManage')} aria-busy={busy} className={`flex w-80 shrink-0 flex-col border-l ${UI_GLASS_ADAPTIVE_DIVIDER_CLASS}`}>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <p className={`mb-3 flex items-center gap-1.5 ${UI_TEXT_META_CLASS}`}>{busy ? <UiSpinner /> : null}{t('assetLibrary.batchHint')}</p>
        <div className="mb-5 flex gap-2">
          <UiButton className="flex-1" disabled={busy || loadedCount === 0} onClick={onSelectAll}>{t('assetLibrary.batchSelectAll')}</UiButton>
          <UiButton className="flex-1" disabled={busy || selectedCount === 0} onClick={onClear}>{t('assetLibrary.batchClear')}</UiButton>
        </div>

        <UiGroup title={t('assetLibrary.batchTags')}>
          <div className="flex items-center gap-2">
            <Tags aria-hidden="true" className={`${UI_ICON_SIZE_CLASS.md} shrink-0 text-text3`} />
            <UiInput disabled={busy} className="min-w-0 flex-1" aria-label={t('assetLibrary.batchTags')} value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addDraftTags() }} placeholder={t('assetLibrary.tagPlaceholder')} />
          </div>
          {(tags.length > 0 || suggestions.length > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => <UiChipButton key={tag} active disabled={busy} size="sm" onClick={() => setTags((current) => current.filter((item) => item !== tag))}>{tag}</UiChipButton>)}
              {suggestions.map((tag) => <UiChipButton key={tag} disabled={busy} size="sm" onClick={() => { setTags((current) => [...current, tag]); setTagDraft('') }}>{tag}</UiChipButton>)}
            </div>
          )}
          <div className="flex gap-2">
            <UiButton variant="secondary" className="flex-1" disabled={disabled || tags.length === 0} onClick={() => void onUpdateTags(tags, 'add')}>{t('assetLibrary.batchTagAdd')}</UiButton>
            <UiButton variant="secondary" className="flex-1" disabled={disabled || tags.length === 0} onClick={() => void onUpdateTags(tags, 'remove')}>{t('assetLibrary.batchTagRemove')}</UiButton>
          </div>
        </UiGroup>

        <UiGroup labelWidth={96} divided title={t('assetLibrary.batchLibraries')} className="mt-5">
          <UiFormRow label={t('assetLibrary.batchLibraries')} density="compact" labelColumn="panel"><Dropdown<string> value={libraryId} options={libraries.map((library) => ({ value: library.id, label: library.name }))} onSelect={setLibraryId} className="w-full" buttonClassName="w-full" panelWidthStrategy="button" disabled={busy || libraries.length === 0} /></UiFormRow>
          <div className="flex gap-2">
            <UiButton variant="secondary" className="flex-1" disabled={disabled || !libraryId} onClick={() => void onUpdateLibrary(libraryId, 'add')}>{t('assetLibrary.batchLibraryAdd')}</UiButton>
            <UiButton variant="secondary" className="flex-1" disabled={disabled || !libraryId} onClick={() => void onUpdateLibrary(libraryId, 'remove')}>{t('assetLibrary.batchLibraryRemove')}</UiButton>
          </div>
        </UiGroup>

        <UiGroup divided className="mt-5">
          {error ? <UiError size="xs" align="start" className="pt-0" title={error} message="" /> : null}
          {/* 二次确认靠文案提示，保持 danger 档：危险实底只用于确认弹窗（同 A-28） */}
          <UiButton variant="danger"
            className="w-full"
            disabled={disabled}
            onClick={() => {
              if (!deleteArmed) { setDeleteArmed(true); return }
              setDeleteArmed(false)
              void onDelete()
            }}
          >
            <Trash2  />
            {deleteArmed ? t('assetLibrary.batchConfirmDelete') : t('assetLibrary.batchDelete')}
          </UiButton>
        </UiGroup>
      </div>
    </aside>
  )
}
