import {
  ChevronDown,
  ChevronRight,
  CircleDashed,
  Eye,
  EyeOff,
  GripVertical,
  Image,
  Layers3,
  Lock,
  SlidersHorizontal,
  Sparkles,
  SquarePen,
  Unlock,
} from 'lucide-react'
import type { KeyboardEvent, MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { UiIconButton, UiOptionButton } from '@/components/ui'
import { UI_DURATION, uiTransition } from '@/components/ui/motion'
import type { ImageEditLayerTreeRowV3 } from './layerTreeV3'
import type { ImageEditorV3Controller } from './types'

interface ImageEditorLayerRowV3Props {
  controller: ImageEditorV3Controller
  row: ImageEditLayerTreeRowV3
  selected: boolean
  expanded: boolean
  onSelect: (row: ImageEditLayerTreeRowV3, event: MouseEvent<HTMLButtonElement>) => void
  onToggleExpanded: (groupId: string) => void
  itemRef: (element: HTMLDivElement | null) => void
  dragging: boolean
  dropTarget: boolean
  dragOffset: { x: number; y: number }
  onDragHandleMouseDown: (event: MouseEvent<HTMLSpanElement>) => void
  dragDisabled: boolean
}

const TYPE_ICON = {
  raster: Image,
  annotation: SquarePen,
  effect: Sparkles,
  adjustment: SlidersHorizontal,
  group: Layers3,
} as const

function focusAdjacentLayer(current: HTMLButtonElement, offset: -1 | 1): void {
  const items = Array.from(
    current.closest('[role="tree"]')?.querySelectorAll<HTMLButtonElement>('[data-layer-select]') ?? [],
  )
  const index = items.indexOf(current)
  items[index + offset]?.focus()
}

export function ImageEditorLayerRowV3({
  controller,
  row,
  selected,
  expanded,
  onSelect,
  onToggleExpanded,
  itemRef,
  dragging,
  dropTarget,
  dragOffset,
  onDragHandleMouseDown,
  dragDisabled,
}: ImageEditorLayerRowV3Props): JSX.Element {
  const { t } = useTranslation('ui')
  const LayerIcon = TYPE_ICON[row.layer.type]
  const ancestorLocked = row.ancestors.some((ancestor) => ancestor.locked)
  const editable = !row.layer.locked && !ancestorLocked

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'ArrowLeft' && row.layer.type === 'group' && expanded) {
      event.preventDefault()
      onToggleExpanded(row.layer.id)
      return
    }
    if (event.key === 'ArrowRight' && row.layer.type === 'group' && !expanded) {
      event.preventDefault()
      onToggleExpanded(row.layer.id)
      return
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'ArrowUp') {
      event.preventDefault()
      if (dragDisabled) return
      const index = Math.min(row.container.length - 1, row.index + 1)
      if (index !== row.index) controller.moveLayer(row.layer.id, row.parentId, index)
      return
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'ArrowDown') {
      event.preventDefault()
      if (dragDisabled) return
      const index = Math.max(0, row.index - 1)
      if (index !== row.index) controller.moveLayer(row.layer.id, row.parentId, index)
      return
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      focusAdjacentLayer(event.currentTarget, event.key === 'ArrowUp' ? -1 : 1)
    }
  }

  return (
    <div
      ref={itemRef}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-posinset={row.ariaPosition}
      aria-setsize={row.ariaSetSize}
      aria-selected={selected}
      aria-expanded={row.layer.type === 'group' ? expanded : undefined}
      data-layer-id={row.layer.id}
      data-layer-type={row.layer.type}
      className={`relative flex h-11 min-w-0 items-center gap-1 px-1.5 ${dropTarget ? 'ring-1 ring-inset ring-accent' : ''}`}
      style={{
        paddingInlineStart: `${row.depth * 16 + 6}px`,
        opacity: dragging ? 0.78 : 1,
        transform: dragging
          ? `translate(${dragOffset.x}px, ${dragOffset.y}px) scale(1.01)`
          : undefined,
        transition: dragging ? 'none' : uiTransition(['opacity', 'transform'], UI_DURATION.fast),
        zIndex: dragging ? 2 : undefined,
      }}
    >
      <span
        data-layer-drag-handle
        className={`flex h-7 w-4 shrink-0 items-center justify-center text-text-faint ${dragDisabled ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'}`}
        title={t('imageEditor.v3.layers.dragHint')}
        aria-hidden="true"
        onMouseDown={onDragHandleMouseDown}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </span>
      {row.layer.type === 'group' ? (
        <UiIconButton
          className="h-7 w-7 shrink-0"
          showBorder={false}
          appearance="hover-only"
          aria-label={expanded
            ? t('imageEditor.v3.layers.collapseGroup')
            : t('imageEditor.v3.layers.expandGroup')}
          onClick={() => onToggleExpanded(row.layer.id)}
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </UiIconButton>
      ) : <span className="w-7 shrink-0" aria-hidden="true" />}

      <UiIconButton
        className="h-7 w-7 shrink-0"
        showBorder={false}
        appearance="hover-only"
        aria-label={row.layer.visible
          ? t('imageEditor.v3.layers.hideLayer', { name: row.layer.name })
          : t('imageEditor.v3.layers.showLayer', { name: row.layer.name })}
        aria-pressed={row.layer.visible}
        disabled={!editable}
        onClick={() => {
          if (editable) controller.updateLayerCommon(row.layer.id, { visible: !row.layer.visible })
        }}
      >
        {row.layer.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
      </UiIconButton>

      <UiOptionButton
        type="button"
        data-layer-select
        variant="menu"
        active={selected}
        className="min-w-0 flex-1 gap-2 py-1"
        onClick={(event) => onSelect(row, event)}
        onKeyDown={handleKeyDown}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded bg-surface-dark text-text-muted">
          <LayerIcon className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-text-dark">{row.layer.name}</span>
        {row.layer.mask ? (
          <CircleDashed
            className="h-3.5 w-3.5 shrink-0 text-text-muted"
            aria-label={t('imageEditor.v3.layers.hasMask')}
          />
        ) : null}
      </UiOptionButton>

      <UiIconButton
        className="h-7 w-7 shrink-0"
        showBorder={false}
        appearance="hover-only"
        aria-label={row.layer.locked
          ? t('imageEditor.v3.layers.unlockLayer', { name: row.layer.name })
          : t('imageEditor.v3.layers.lockLayer', { name: row.layer.name })}
        aria-pressed={row.layer.locked}
        disabled={ancestorLocked}
        onClick={() => {
          if (!ancestorLocked) controller.updateLayerCommon(row.layer.id, { locked: !row.layer.locked })
        }}
      >
        {row.layer.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
      </UiIconButton>
    </div>
  )
}
