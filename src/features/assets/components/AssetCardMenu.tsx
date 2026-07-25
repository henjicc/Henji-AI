import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Trash2 } from 'lucide-react'
import { UiButton, UiChipButton, UiInput, UiPanel } from '@/components/ui'
import type { AssetLibraryRecord, AssetRecord } from '@/platform/contracts/assetLibrary'
import { useI18n } from '@/hooks/useI18n'

interface Props {
  asset: AssetRecord
  anchor: DOMRect
  libraries: AssetLibraryRecord[]
  availableTags: string[]
  onToggleLibrary: (libraryId: string, included: boolean) => Promise<void>
  onSetTags: (tags: string[]) => Promise<void>
  onDelete: () => Promise<void>
  onClose: () => void
}

export const AssetCardMenu: React.FC<Props> = ({ asset, anchor, libraries, availableTags, onToggleLibrary, onSetTags, onDelete, onClose }) => {
  const { t } = useI18n('ui')
  const ref = useRef<HTMLDivElement>(null)
  const closeTimerRef = useRef<number | null>(null)
  const [visible, setVisible] = useState(false)
  const [librarySearch, setLibrarySearch] = useState('')
  const [tagDraft, setTagDraft] = useState('')
  const [libraryIds, setLibraryIds] = useState(asset.libraryIds)
  const [tags, setTags] = useState(asset.tags)
  const filteredLibraries = useMemo(() => libraries.filter((library) => library.name.toLocaleLowerCase().includes(librarySearch.trim().toLocaleLowerCase())), [libraries, librarySearch])
  const suggestions = useMemo(() => availableTags.filter((tag) => !tags.includes(tag) && tag.toLocaleLowerCase().includes(tagDraft.trim().toLocaleLowerCase())).slice(0, 8), [availableTags, tagDraft, tags])
  const menuWidth = 320
  const menuHeight = 410
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
    const handlePointerDown = (event: PointerEvent): void => { if (!ref.current?.contains(event.target as Node)) requestClose() }
    const handleKeyDown = (event: KeyboardEvent): void => { if (event.key === 'Escape') requestClose() }
    document.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => { document.removeEventListener('pointerdown', handlePointerDown); window.removeEventListener('keydown', handleKeyDown) }
  }, [requestClose])

  const toggleLibrary = async (libraryId: string): Promise<void> => {
    const included = libraryIds.includes(libraryId)
    setLibraryIds((current) => included ? current.filter((id) => id !== libraryId) : [...current, libraryId])
    await onToggleLibrary(libraryId, !included)
  }
  const applyTags = async (nextTags: string[]): Promise<void> => { setTags(nextTags); await onSetTags(nextTags) }
  const addDraftTag = async (): Promise<void> => {
    const name = tagDraft.trim()
    if (!name || tags.includes(name)) return
    setTagDraft('')
    await applyTags([...tags, name])
  }

  return createPortal(
    <UiPanel ref={ref} className={`fixed z-dropdown w-80 p-3 transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none ${visible ? 'translate-y-0 scale-100 opacity-100' : `${placeAbove ? 'translate-y-1' : '-translate-y-1'} scale-[0.98] opacity-0`}`} style={{ left, top, transformOrigin: placeAbove ? 'bottom center' : 'top center' }} data-asset-card-menu>
      <div className="mb-3 truncate font-medium text-text-dark">{asset.displayName}</div>
      <div className="mb-1.5 text-xs text-text-muted">{t('assetLibrary.tags')}</div>
      <div className="mb-2 flex flex-wrap gap-1.5"><UiChipButton active disabled className="!h-7 !px-2 text-xs">{t(`assetLibrary.${asset.mediaType}`)}</UiChipButton>{tags.map((tag) => <UiChipButton key={tag} active className="!h-7 !px-2 text-xs" onClick={() => void applyTags(tags.filter((item) => item !== tag))}>{tag}</UiChipButton>)}</div>
      <UiInput className="!h-8 !px-2 text-xs" value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void addDraftTag() }} placeholder={t('assetLibrary.tagPlaceholder')} />
      {tagDraft && suggestions.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{suggestions.map((tag) => <UiChipButton key={tag} className="!h-7 !px-2 text-xs" onClick={() => { setTagDraft(''); void applyTags([...tags, tag]) }}>{tag}</UiChipButton>)}</div>}
      <div className="mb-1.5 mt-3 text-xs text-text-muted">{t('assetLibrary.membership')}</div>
      {libraries.length > 6 && <UiInput className="mb-2 !h-8 !px-2 text-xs" value={librarySearch} onChange={(event) => setLibrarySearch(event.target.value)} placeholder={t('assetLibrary.searchLibraries')} />}
      <div className="max-h-32 overflow-y-auto"><div className="flex flex-wrap gap-1.5">{filteredLibraries.map((library) => <UiChipButton key={library.id} active={libraryIds.includes(library.id)} className="!h-8 !px-2.5 text-xs" onClick={() => void toggleLibrary(library.id)}>{library.name}</UiChipButton>)}</div></div>
      <UiButton className="mt-3 w-full text-red-300 hover:bg-red-600/35" size="sm" onClick={() => void onDelete()}><Trash2 className="mr-2 h-4 w-4" />{t('assetLibrary.deleteAsset')}</UiButton>
    </UiPanel>, document.body,
  )
}
