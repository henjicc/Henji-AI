import React, { useState } from 'react'
import { Check, Clock3, FileAudio, Film, Folder, Image as ImageIcon, Pencil, Plus, Trash2, X } from 'lucide-react'
import { ICON_ASSET_LIBRARY } from '@/core/theme/icons'
import { UI_GLASS_ADAPTIVE_DIVIDER_CLASS, UI_GLASS_ADAPTIVE_SURFACE_CLASS, UI_TEXT_LABEL_CLASS, UiIconButton, UiInput, UiNavButton } from '@/components/ui'
import type { AssetLibraryRecord, AssetMediaType } from '@/platform/contracts/assetLibrary'

interface SidebarLabels {
  all: string
  recent: string
  image: string
  video: string
  audio: string
  categories: string
  create: string
  placeholder: string
  confirmDelete: string
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
    <aside className={`flex w-52 shrink-0 flex-col border-r ${UI_GLASS_ADAPTIVE_DIVIDER_CLASS} ${UI_GLASS_ADAPTIVE_SURFACE_CLASS}`}>
      <nav className="space-y-1 p-2">
        <UiNavButton active={activeId === null && activeMediaType === null && activeSort === 'created'} onClick={onShowAll} className="!h-10 !rounded-lg !px-3">
          <ICON_ASSET_LIBRARY className="h-4 w-4" />{labels.all}
        </UiNavButton>
        <UiNavButton active={activeId === null && activeSort === 'recent'} onClick={onShowRecent} className="!h-9 !rounded-lg !px-3">
          <Clock3 className="h-4 w-4" />{labels.recent}
        </UiNavButton>
        {([
          ['image', ImageIcon, labels.image],
          ['video', Film, labels.video],
          ['audio', FileAudio, labels.audio],
        ] as const).map(([type, Icon, label]) => (
          <UiNavButton key={type} active={activeId === null && activeMediaType === type && activeSort === 'created'} onClick={() => onShowMediaType(type)} className="!h-9 !rounded-lg !px-3">
            <Icon className="h-4 w-4" />{label}
          </UiNavButton>
        ))}
      </nav>

      <div className={`flex items-center justify-between px-3 pb-1 pt-2 ${UI_TEXT_LABEL_CLASS}`}>
        <span>{labels.categories}</span>
        <UiIconButton appearance="hover-only" className="!h-7 !w-7" onClick={() => setCreating(true)} title={labels.create}><Plus className="h-3.5 w-3.5" /></UiIconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 [scrollbar-gutter:stable]">
        {creating && (
          <div className="mb-1 flex items-center gap-1">
            <UiInput autoFocus className="!h-8 min-w-0 !px-2" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void submitCreate(); if (event.key === 'Escape') setCreating(false) }} placeholder={labels.placeholder} />
            <UiIconButton className="!h-7 !w-7" onClick={() => void submitCreate()}><Check className="h-3.5 w-3.5" /></UiIconButton>
          </div>
        )}
        {libraries.map((library) => (
          <div key={library.id} className="group relative flex min-h-9 items-center">
            {editingId === library.id ? (
              <div className="flex w-full items-center gap-1">
                <UiInput autoFocus className="!h-8 min-w-0 flex-1 !px-2" value={editingName} onChange={(event) => setEditingName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void submitRename(library); if (event.key === 'Escape') setEditingId(null) }} />
                <UiIconButton className="!h-7 !w-7" onClick={() => void submitRename(library)}><Check className="h-3.5 w-3.5" /></UiIconButton>
              </div>
            ) : (
              <>
                {/* 名称按钮占满整行，静息态不为悬浮操作预留宽度——那两个图标按钮
                    是覆盖在它之上的同级元素，不挤占布局空间，避免长名称被过早截断。 */}
                <UiNavButton active={activeId === library.id} onClick={() => onSelect(library.id)} className="!h-9 w-full !rounded-lg !px-3">
                  <Folder className="h-4 w-4 shrink-0" /><span className="truncate">{library.name}</span>
                </UiNavButton>
                <div className={`pointer-events-none absolute right-1 top-1/2 flex -translate-y-1/2 ${deletingId === library.id ? 'pointer-events-auto opacity-100' : 'opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100'}`}>
                  {deletingId === library.id ? (
                    <>
                      <UiIconButton className="!h-7 !w-7" hoverVariant="danger" title={labels.confirmDelete} onClick={() => { void onDelete(library); setDeletingId(null) }}><Check className="h-3.5 w-3.5" /></UiIconButton>
                      <UiIconButton className="!h-7 !w-7" onClick={() => setDeletingId(null)}><X className="h-3.5 w-3.5" /></UiIconButton>
                    </>
                  ) : (
                    <>
                      <UiIconButton appearance="hover-only" className="!h-7 !w-7" onClick={() => { setEditingId(library.id); setEditingName(library.name) }}><Pencil className="h-3 w-3" /></UiIconButton>
                      <UiIconButton appearance="hover-only" className="!h-7 !w-7" hoverVariant="danger" onClick={() => setDeletingId(library.id)}><Trash2 className="h-3 w-3" /></UiIconButton>
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
