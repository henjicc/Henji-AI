import React, { useState } from 'react'
import { GripVertical, Trash2 } from 'lucide-react'
import { UiButton, UiIconButton, UiInput } from '@/components/ui'
import type { StageShot } from '../domain/shotTypes'

interface ShotCardProps {
  shot: StageShot
  index: number
  selected: boolean
  active: boolean
  dragging: boolean
  dropping: boolean
  offsetX: number
  onMouseDown: (event: React.MouseEvent) => void
  onRename: (name: string) => void
  onTimingChange: (patch: Partial<Pick<StageShot, 'hold' | 'transitionDuration'>>) => void
  onRemove: () => void
}

const ShotCard: React.FC<ShotCardProps> = ({
  shot, index, selected, active, dragging, dropping, offsetX, onMouseDown, onRename, onTimingChange, onRemove,
}) => {
  const [editingName, setEditingName] = useState(false)
  const [draftName, setDraftName] = useState(shot.name)

  const commitName = (): void => {
    onRename(draftName)
    setEditingName(false)
  }

  const shellState = selected
    ? 'border-accent bg-accent/10'
    : active
      ? 'border-border-dark bg-layer'
      : 'border-border-dark bg-surface-dark hover:bg-layer'

  return (
    <div
      className={`relative flex h-24 w-48 shrink-0 cursor-grab flex-col rounded-lg border p-2 transition-[transform,opacity,background-color] ${shellState} ${dragging ? 'z-10 opacity-80 shadow-lg' : ''} ${dropping ? 'opacity-60' : ''}`}
      style={{ transform: `translateX(${offsetX}px)` }}
      onMouseDown={onMouseDown}
    >
      {active && <div className="absolute inset-x-2 top-0 h-0.5 rounded-full bg-accent" />}
      <div className="flex min-w-0 items-center gap-1">
        <GripVertical size={13} className="shrink-0 text-text-muted" />
        <span className="shrink-0 text-xs text-text-muted">{index + 1}</span>
        {editingName ? (
          <UiInput autoFocus value={draftName} className="h-6 min-w-0 px-1 text-xs" onChange={(event) => setDraftName(event.target.value)}
            onBlur={commitName} onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              else if (event.key === 'Escape') setEditingName(false)
            }} />
        ) : (
          <UiButton variant="ghost" className="h-6 min-w-0 flex-1 justify-start truncate border-0 bg-transparent px-1 text-xs"
            title="双击重命名" onDoubleClick={() => { setDraftName(shot.name); setEditingName(true) }}>
            {shot.name}
          </UiButton>
        )}
        <UiIconButton showBorder={false} appearance="hover-only" hoverVariant="danger" className="h-6 w-6 shrink-0"
          title="删除片段" onClick={onRemove}>
          <Trash2 size={12} />
        </UiIconButton>
      </div>
      <div className="mt-auto grid grid-cols-2 gap-2 text-[11px] text-text-muted">
        <label className="flex flex-col gap-1">停留
          <UiInput type="number" min={0} step={0.1} value={shot.hold} className="h-7 px-2 text-xs"
            onChange={(event) => onTimingChange({ hold: Number(event.target.value) })} />
        </label>
        <label className="flex flex-col gap-1">过渡
          <UiInput type="number" min={0} step={0.1} value={shot.transitionDuration} className="h-7 px-2 text-xs"
            onChange={(event) => onTimingChange({ transitionDuration: Number(event.target.value) })} />
        </label>
      </div>
    </div>
  )
}

export default ShotCard
