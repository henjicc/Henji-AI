import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckSquare2, Pencil, Trash2 } from 'lucide-react'
import { UI_TEXT_LABEL_CLASS, UiButton, UiChipButton, UiError, UiIconButton, UiInput, UiPanel } from '@/components/ui'
import type { AssetLibraryRecord, AssetRecord } from '@/platform/contracts/assetLibrary'
import { useI18n } from '@/hooks/useI18n'
import { createLogger } from '@/core/logging'
import { isAssetCardMenuTriggerTarget } from '../assetOverlayOwnership'
import type { AssetMenuAnchor } from './AssetCard'

const logger = createLogger('features.assets')

interface Props {
  asset: AssetRecord
  anchor: AssetMenuAnchor
  libraries: AssetLibraryRecord[]
  availableTags: string[]
  onToggleLibrary: (libraryId: string, included: boolean) => Promise<void>
  onSetTags: (tags: string[]) => Promise<void>
  onRename: (name: string) => Promise<void>
  onDelete: () => Promise<void>
  onOpenBatchManagement: () => void
  onClose: () => void
}

export const AssetCardMenu: React.FC<Props> = ({ asset, anchor, libraries, availableTags, onToggleLibrary, onSetTags, onRename, onDelete, onOpenBatchManagement, onClose }) => {
  const { t } = useI18n('ui')
  const ref = useRef<HTMLDivElement>(null)
  const closeTimerRef = useRef<number | null>(null)
  const pendingActionRef = useRef(false)
  const [visible, setVisible] = useState(false)
  const [librarySearch, setLibrarySearch] = useState('')
  const [tagDraft, setTagDraft] = useState('')
  const [libraryIds, setLibraryIds] = useState(asset.libraryIds)
  const [tags, setTags] = useState(asset.tags)
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [editingName, setEditingName] = useState(false)
  const [name, setName] = useState(asset.displayName)
  const [nameDraft, setNameDraft] = useState(asset.displayName)
  const filteredLibraries = useMemo(() => libraries.filter((library) => library.name.toLocaleLowerCase().includes(librarySearch.trim().toLocaleLowerCase())), [libraries, librarySearch])
  const suggestions = useMemo(() => availableTags.filter((tag) => !tags.includes(tag) && tag.toLocaleLowerCase().includes(tagDraft.trim().toLocaleLowerCase())).slice(0, 8), [availableTags, tagDraft, tags])
  const menuWidth = 320
  const menuHeight = Math.min(460, window.innerHeight - 24)
  const spaceBelow = window.innerHeight - anchor.bottom
  const placeAbove = spaceBelow < menuHeight + 12 && anchor.top > spaceBelow
  const left = Math.max(12, Math.min(anchor.left + anchor.width / 2 - menuWidth / 2, window.innerWidth - menuWidth - 12))
  const top = placeAbove ? Math.max(12, anchor.top - menuHeight - 8) : Math.max(12, Math.min(anchor.bottom + 8, window.innerHeight - menuHeight - 12))

  const requestClose = useCallback((): void => {
    setVisible(false)
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = window.setTimeout(onClose, 150)
  }, [onClose])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setVisible(true))
    return () => {
      window.cancelAnimationFrame(frame)
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current)
    }
  }, [])

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent): void => {
      if (isAssetCardMenuTriggerTarget(event.target)) return
      if (!ref.current?.contains(event.target as Node)) requestClose()
    }
    const handleKeyDown = (event: KeyboardEvent): void => { if (event.key === 'Escape') requestClose() }
    const handleViewportChange = (event: Event): void => {
      if (event.type === 'scroll' && ref.current?.contains(event.target as Node)) return
      requestClose()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('scroll', handleViewportChange, true)
    window.addEventListener('resize', handleViewportChange)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('scroll', handleViewportChange, true)
      window.removeEventListener('resize', handleViewportChange)
    }
  }, [requestClose])

  const runAction = async (action: string, operation: () => Promise<void>): Promise<boolean> => {
    if (pendingActionRef.current) return false
    pendingActionRef.current = true
    setPendingAction(action)
    setActionError(null)
    try {
      await operation()
      return true
    } catch (cause) {
      logger.error('资产卡片菜单操作失败', cause, { event: 'asset.ui.card_menu_action.failed', context: { action, assetId: asset.id } })
      setActionError(cause instanceof Error ? cause.message : t('assetLibrary.error'))
      return false
    } finally {
      pendingActionRef.current = false
      setPendingAction(null)
    }
  }

  const toggleLibrary = async (libraryId: string): Promise<void> => {
    const included = libraryIds.includes(libraryId)
    const previous = libraryIds
    setLibraryIds(included ? previous.filter((id) => id !== libraryId) : [...previous, libraryId])
    const succeeded = await runAction('toggle_library', () => onToggleLibrary(libraryId, !included))
    if (!succeeded) setLibraryIds(previous)
  }
  const applyTags = async (nextTags: string[]): Promise<void> => {
    const previous = tags
    setTags(nextTags)
    const succeeded = await runAction('set_tags', () => onSetTags(nextTags))
    if (!succeeded) setTags(previous)
  }
  const addDraftTag = async (): Promise<void> => {
    const name = tagDraft.trim()
    if (!name || tags.includes(name)) return
    setTagDraft('')
    await applyTags([...tags, name])
  }
  const deleteCurrentAsset = async (): Promise<void> => {
    if (await runAction('delete', onDelete)) requestClose()
  }
  const applyName = async (): Promise<void> => {
    const nextName = nameDraft.trim()
    if (!nextName || nextName === name) { setEditingName(false); setNameDraft(name); return }
    if (await runAction('rename', () => onRename(nextName))) {
      setName(nextName)
      setEditingName(false)
    }
  }

  return createPortal(
    <UiPanel ref={ref} variant="glass" className={`fixed z-modal w-80 overflow-y-auto p-3 transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none ${visible ? 'translate-y-0 scale-100 opacity-100' : `${placeAbove ? 'translate-y-1' : '-translate-y-1'} scale-[0.98] opacity-0`}`} style={{ left, top, maxHeight: menuHeight, transformOrigin: placeAbove ? 'bottom center' : 'top center' }} data-asset-card-menu>
      <div className="mb-3 flex min-w-0 items-center gap-1">
        {editingName ? (
          <UiInput autoFocus disabled={pendingAction !== null} className="!h-8 min-w-0 flex-1 !px-2 text-sm" value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} onBlur={() => void applyName()} onKeyDown={(event) => { if (event.key === 'Enter') void applyName(); if (event.key === 'Escape') { setEditingName(false); setNameDraft(name) } }} />
        ) : (
          <div className="min-w-0 flex-1 truncate font-medium text-text-dark" title={t('assetLibrary.renameAsset')} onDoubleClick={() => setEditingName(true)}>{name}</div>
        )}
        {!editingName && <UiIconButton appearance="hover-only" showBorder={false} className="!h-7 !w-7 shrink-0" onClick={() => setEditingName(true)} title={t('assetLibrary.renameAsset')}><Pencil className="h-3.5 w-3.5" /></UiIconButton>}
      </div>
      <div className={`mb-1.5 ${UI_TEXT_LABEL_CLASS}`}>{t('assetLibrary.tags')}</div>
      <UiInput disabled={pendingAction !== null} className="!h-8 !px-2 text-xs" value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void addDraftTag() }} placeholder={t('assetLibrary.tagPlaceholder')} />
      <div className="mt-2 flex flex-wrap gap-1.5"><UiChipButton active disabled className="!h-7 !px-2 text-xs">{t(`assetLibrary.${asset.mediaType}`)}</UiChipButton>{tags.map((tag) => <UiChipButton key={tag} active disabled={pendingAction !== null} className="!h-7 !px-2 text-xs" onClick={() => void applyTags(tags.filter((item) => item !== tag))}>{tag}</UiChipButton>)}{tagDraft && suggestions.map((tag) => <UiChipButton key={tag} disabled={pendingAction !== null} className="!h-7 !px-2 text-xs" onClick={() => { setTagDraft(''); void applyTags([...tags, tag]) }}>{tag}</UiChipButton>)}</div>
      <div className={`mb-1.5 mt-3 ${UI_TEXT_LABEL_CLASS}`}>{t('assetLibrary.membership')}</div>
      {libraries.length > 6 && <UiInput className="mb-2 !h-8 !px-2 text-xs" value={librarySearch} onChange={(event) => setLibrarySearch(event.target.value)} placeholder={t('assetLibrary.searchLibraries')} />}
      <div className="max-h-32 overflow-y-auto"><div className="flex flex-wrap gap-1.5">{filteredLibraries.map((library) => <UiChipButton key={library.id} active={libraryIds.includes(library.id)} disabled={pendingAction !== null} className="!h-8 !px-2.5 text-xs" onClick={() => void toggleLibrary(library.id)}>{library.name}</UiChipButton>)}</div></div>
      {actionError ? <UiError size="xs" message={actionError} /> : null}
      <div className="mt-3 flex gap-2">
        <UiButton disabled={pendingAction !== null} className="flex-1 text-danger hover:bg-danger/35" size="sm" onClick={() => void deleteCurrentAsset()}><Trash2 className="mr-2 h-4 w-4" />{t('assetLibrary.deleteAsset')}</UiButton>
        <UiButton disabled={pendingAction !== null} className="flex-1" size="sm" onClick={() => { requestClose(); onOpenBatchManagement() }}><CheckSquare2 className="mr-2 h-4 w-4" />{t('assetLibrary.batchManage')}</UiButton>
      </div>
    </UiPanel>, document.body,
  )
}
