import {
  ChevronDown,
  ChevronRight,
  CircleDashed,
  Eye,
  EyeOff,
  Image,
  Layers3,
  Lock,
  SlidersHorizontal,
  Sparkles,
  SquarePen,
  Unlock,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { UiIconButton, UiInput, UiOptionButton } from '@/components/ui'
import { UI_DURATION, uiTransition } from '@/components/ui/motion'
import { Z_LAYERS } from '@/core/theme/zLayers'
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
  dropping: boolean
  avoidanceDirection: -1 | 0 | 1
  dropIndicator: 'before' | 'after' | null
  dragOffset: { x: number; y: number }
  dropOffsetRows: number
  onDragMouseDown: (event: MouseEvent<HTMLDivElement>) => void
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
  dropping,
  avoidanceDirection,
  dropIndicator,
  dragOffset,
  dropOffsetRows,
  onDragMouseDown,
  dragDisabled,
}: ImageEditorLayerRowV3Props): JSX.Element {
  const { t } = useTranslation('ui')
  const LayerIcon = TYPE_ICON[row.layer.type]
  const ancestorLocked = row.ancestors.some((ancestor) => ancestor.locked)
  const editable = !row.layer.locked && !ancestorLocked
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState(row.layer.name)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const cancelRenameRef = useRef(false)
  const transform = dragging
    ? `translate(${dragOffset.x}px, ${dragOffset.y}px) scale(1.01)`
    : dropping
      ? `translate(0, ${dropOffsetRows * 100}%) scale(1.01)`
      : avoidanceDirection !== 0
        ? `translateY(${avoidanceDirection * 100}%)`
        : undefined

  useEffect(() => {
    if (!renaming) setDraftName(row.layer.name)
  }, [renaming, row.layer.id, row.layer.name])

  useEffect(() => {
    if (!renaming) return
    renameInputRef.current?.focus()
    renameInputRef.current?.select()
  }, [renaming])

  const finishRename = (): void => {
    if (cancelRenameRef.current) {
      cancelRenameRef.current = false
      setDraftName(row.layer.name)
      setRenaming(false)
      return
    }
    const trimmed = draftName.trim()
    if (editable && trimmed && trimmed !== row.layer.name) {
      controller.updateLayerCommon(row.layer.id, { name: trimmed })
    } else {
      setDraftName(row.layer.name)
    }
    setRenaming(false)
  }

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
      data-layer-drag-state={dragging
        ? 'dragging'
        : dropping
          ? 'dropping'
          : avoidanceDirection !== 0
            ? 'avoiding'
            : undefined}
      className="relative flex h-11 min-w-0 items-center gap-1 px-1.5"
      onMouseDown={(event) => {
        if (renaming || !(event.target as HTMLElement).closest('[data-layer-select]')) return
        onDragMouseDown(event)
      }}
      style={{
        paddingInlineStart: `${row.depth * 16 + 6}px`,
        opacity: dragging ? 0.78 : 1,
        pointerEvents: dragging || dropping ? 'none' : undefined,
        transform,
        transition: dragging ? 'none' : uiTransition(['opacity', 'transform'], UI_DURATION.fast),
        zIndex: dragging || dropping ? Z_LAYERS.drag : undefined,
      }}
    >
      {dropIndicator ? (
        <span
          data-layer-drop-indicator
          data-position={dropIndicator}
          className={`pointer-events-none absolute left-1.5 right-1.5 z-raised h-px bg-accent ${
            dropIndicator === 'before' ? 'top-0' : 'bottom-0'
          }`}
        />
      ) : null}
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
      ) : null}

      <div className="relative min-w-0 flex-1">
        <UiOptionButton
          type="button"
          data-layer-select
          variant="menu"
          active={selected}
          className={`h-10 w-full min-w-0 gap-2 py-1 ${dragDisabled ? '' : 'cursor-grab active:cursor-grabbing'}`}
          onClick={(event) => onSelect(row, event)}
          onKeyDown={handleKeyDown}
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded bg-surface-dark text-text-muted">
            <LayerIcon className="h-3.5 w-3.5" />
          </span>
          <span
            data-layer-name
            className="min-w-0 flex-1 truncate text-xs text-text-dark"
            onDoubleClick={(event) => {
              event.stopPropagation()
              if (!editable) return
              setDraftName(row.layer.name)
              setRenaming(true)
            }}
          >
            {row.layer.name}
          </span>
          {row.layer.mask ? (
            <CircleDashed
              className="h-3.5 w-3.5 shrink-0 text-text-muted"
              aria-label={t('imageEditor.v3.layers.hasMask')}
            />
          ) : null}
        </UiOptionButton>
        {renaming ? (
          <div className={`absolute left-12 top-1/2 -translate-y-1/2 ${row.layer.mask ? 'right-8' : 'right-2'}`}>
            <UiInput
              ref={renameInputRef}
              data-layer-name-input
              className="h-7 px-2 py-0 text-xs"
              aria-label={t('imageEditor.v3.properties.name')}
              value={draftName}
              onChange={(event) => setDraftName(event.currentTarget.value)}
              onBlur={finishRename}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  event.currentTarget.blur()
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  cancelRenameRef.current = true
                  event.currentTarget.blur()
                }
              }}
            />
          </div>
        ) : null}
      </div>

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
