import React, { useState } from 'react'
import { Check, Clock3, FileAudio, Film, Folder, Image as ImageIcon, Pencil, Plus, Trash2, X } from 'lucide-react'
import { ICON_ASSET_CODE, ICON_ASSET_LIBRARY } from '@/core/theme/icons'
import { UI_GLASS_ADAPTIVE_DIVIDER_CLASS, UI_GLASS_ADAPTIVE_SURFACE_CLASS, UI_TEXT_META_CLASS, UiIconButton, UiInput, UiNavButton } from '@/components/ui'
import type { AssetLibraryRecord, AssetMediaType } from '@/platform/contracts/assetLibrary'

interface SidebarLabels {
  all: string
  recent: string
  image: string
  video: string
  audio: string
  code: string
  categories: string
  create: string
  placeholder: string
  confirmDelete: string
  rename: string
  delete: string
  confirm: string
  cancel: string
}

interface Props {
  libraries: AssetLibraryRecord[]
  activeId: string | null
  activeMediaType: AssetMediaType | null
  activeSort: 'created' | 'recent'
  labels: SidebarLabels
  onShowAll: () => void
  onShowRecent: () => void
  onShowMediaType: (type: AssetMediaType) => void
  onSelect: (id: string) => void
  onCreate: (name: string) => Promise<void>
  onRename: (library: AssetLibraryRecord, name: string) => Promise<void>
  onDelete: (library: AssetLibraryRecord) => Promise<void>
  width?: number
}

export const AssetLibrarySidebar: React.FC<Props> = ({
  libraries,
  activeId,
  activeMediaType,
  activeSort,
  labels,
  onShowAll,
  onShowRecent,
  onShowMediaType,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  width,
}) => {
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const submitCreate = async (): Promise<void> => {
    const name = draft.trim()
    if (!name) return
    await onCreate(name)
    setDraft('')
    setCreating(false)
  }
  const submitRename = async (library: AssetLibraryRecord): Promise<void> => {
    const name = editingName.trim()
    if (!name || name === library.name) {
      setEditingId(null)
      return
    }
    await onRename(library, name)
    setEditingId(null)
  }

  return (
    <aside className={`flex shrink-0 flex-col border-r ${width === undefined ? 'w-52' : ''} ${UI_GLASS_ADAPTIVE_DIVIDER_CLASS} ${UI_GLASS_ADAPTIVE_SURFACE_CLASS}`} style={width === undefined ? undefined : { width }}>
      <nav className="space-y-0.5 p-2">
        <UiNavButton active={activeId === null && activeMediaType === null && activeSort === 'created'} onClick={onShowAll} size="md">
          <ICON_ASSET_LIBRARY className="h-4 w-4" />{labels.all}
        </UiNavButton>
        <UiNavButton active={activeId === null && activeSort === 'recent'} onClick={onShowRecent} size="md">
          <Clock3 className="h-4 w-4" />{labels.recent}
        </UiNavButton>
        {([
          ['image', ImageIcon, labels.image],
          ['video', Film, labels.video],
          ['audio', FileAudio, labels.audio],
          ['code', ICON_ASSET_CODE, labels.code],
        ] as const).map(([type, Icon, label]) => (
          <UiNavButton key={type} active={activeId === null && activeMediaType === type && activeSort === 'created'} onClick={() => onShowMediaType(type)} size="md">
            <Icon className="h-4 w-4" />{label}
          </UiNavButton>
        ))}
      </nav>

      {/* 分组标签：元信息档，与上方系统视图之间只靠间距分开，不画线 */}
      <div className={`flex items-center justify-between pb-1 pl-4 pr-2 pt-3 ${UI_TEXT_META_CLASS}`}>
        <span>{labels.categories}</span>
        <UiIconButton size="sm" onClick={() => setCreating(true)} title={labels.create} aria-label={labels.create}><Plus className="h-3.5 w-3.5" /></UiIconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 [scrollbar-gutter:stable]">
        {creating && (
          <div className="mb-1 flex items-center gap-1">
            <UiInput autoFocus className="min-w-0" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void submitCreate(); if (event.key === 'Escape') setCreating(false) }} placeholder={labels.placeholder} aria-label={labels.placeholder} />
            <UiIconButton onClick={() => void submitCreate()} title={labels.confirm} aria-label={labels.confirm}><Check className="h-3.5 w-3.5" /></UiIconButton>
          </div>
        )}
        {libraries.map((library) => (
          <div key={library.id} className="group relative flex min-h-8 items-center">
            {editingId === library.id ? (
              <div className="flex w-full items-center gap-1">
                <UiInput autoFocus className="min-w-0 flex-1" value={editingName} aria-label={labels.rename} onChange={(event) => setEditingName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void submitRename(library); if (event.key === 'Escape') setEditingId(null) }} />
                <UiIconButton onClick={() => void submitRename(library)} title={labels.confirm} aria-label={labels.confirm}><Check className="h-3.5 w-3.5" /></UiIconButton>
              </div>
            ) : (
              <>
                {/* 名称按钮占满整行，静息态不为悬浮操作预留宽度——那两个图标按钮
                    是覆盖在它之上的同级元素，不挤占布局空间，避免长名称被过早截断。 */}
                <UiNavButton active={activeId === library.id} onClick={() => onSelect(library.id)} size="md" className="w-full">
                  <Folder className="h-4 w-4 shrink-0" /><span className="truncate">{library.name}</span>
                </UiNavButton>
                <div className={`pointer-events-none absolute right-1 top-1/2 flex -translate-y-1/2 bg-gradient-to-l from-hover via-hover/95 to-transparent pl-6 ${deletingId === library.id ? 'pointer-events-auto opacity-100' : 'opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100'}`}>
                  {deletingId === library.id ? (
                    <>
                      <UiIconButton size="sm" tone="danger" title={labels.confirmDelete} aria-label={labels.confirmDelete} onClick={() => { void onDelete(library); setDeletingId(null) }}><Check className="h-3.5 w-3.5" /></UiIconButton>
                      <UiIconButton size="sm" title={labels.cancel} aria-label={labels.cancel} onClick={() => setDeletingId(null)}><X className="h-3.5 w-3.5" /></UiIconButton>
                    </>
                  ) : (
                    <>
                      <UiIconButton size="sm" title={labels.rename} aria-label={labels.rename} onClick={() => { setEditingId(library.id); setEditingName(library.name) }}><Pencil className="h-3.5 w-3.5" /></UiIconButton>
                      <UiIconButton size="sm" tone="danger" title={labels.delete} aria-label={labels.delete} onClick={() => setDeletingId(library.id)}><Trash2 className="h-3.5 w-3.5" /></UiIconButton>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </aside>
  )
}
