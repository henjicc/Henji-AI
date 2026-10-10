import {
  ArrowDown,
  ArrowUp,
  Copy,
  Plus,
  Trash2,
  FolderPlus,
  Ungroup,
  CornerUpLeft,
  MoreHorizontal,
} from 'lucide-react'
import type { MouseEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'

import { PanelTrigger, UiButton, UiEmpty, UiError, UiIconButton, UiOptionButton } from '@/components/ui'
import { useReorderDrag } from '@/components/ui/fileUploader/useReorderDrag'
import { collectImageEditLayerIdsV3, type ImageEditLayerV3 } from '@/core/imageEdit/v3/layerTypes'
import type { ImageEditorCapabilityReadinessV3 } from '../application/imageEditorHostProfiles'
import { useImageEditorSessionStoreV3 } from '../store'
import {
  canDragImageEditLayerRowV3,
  canDeleteImageEditLayersV3,
  createImageEditLayerFromChoiceV3,
  findImageEditLayerLocationV3,
  flattenImageEditLayerTreeV3,
  isImageEditLayerLocationEditableV3,
  canGroupImageEditLayersV3,
  canUngroupImageEditLayerV3,
  type ImageEditLayerCreationChoiceV3,
  type ImageEditLayerTreeRowV3,
} from './layerTreeV3'
import { ImageEditorLayerRowV3 } from './ImageEditorLayerRowV3'
import { resolveImageEditorReadinessReasonV3 } from './readinessPresentationV3'
import type { ImageEditorV3Controller } from './types'
import { resolveImageEditLayerMovesV3 } from '../panels/layers/treeDrop'
import { selectImageEditTargetV3 } from '../panels/layers/editTarget'
import { ImageEditThumbnailsV3 } from '../panels/thumbnails'
import { useImageEditorDisposableV3 } from '../execution/useImageEditorDisposableV3'

interface ImageEditorLayersPanelV3Props {
  controller: ImageEditorV3Controller
  embedded?: boolean
}

const EFFECT_SUBTYPES = ['image.fast-blur-v3', 'image.diffusion', 'image.vgpu-glow'] as const
const ADJUSTMENT_SUBTYPES = ['color_grade', 'exposure', 'curves', 'temperature-tint', 'hsl'] as const
const EMPTY_LAYER_IDS: readonly string[] = []

interface ImageEditorLayerCreationCapabilityV3 {
  choice: ImageEditLayerCreationChoiceV3
  readiness: ImageEditorCapabilityReadinessV3
}

function getEffectiveSelectedIds(
  index: ReadonlyMap<string, ImageEditLayerTreeRowV3>,
  selectedLayerIds: readonly string[],
): string[] {
  const selected = new Set(selectedLayerIds)
  return selectedLayerIds.filter((id) => {
    const location = index.get(id)
    return location && !location.ancestors.some((ancestor) => selected.has(ancestor.id))
  })
}

/** 新效果默认作用于图片内容，不吞掉最上方的标注交互层。 */
function resolveCreationIndex(
  layers: readonly ImageEditLayerV3[],
  choice: ImageEditLayerCreationChoiceV3,
): number {
  if (choice.kind !== 'effect' && choice.kind !== 'adjustment') return layers.length
  let index = layers.length
  while (index > 0 && ['text','shape','path'].includes(layers[index - 1].type)) index -= 1
  return index
}

function getCreationChoices(
  controller: ImageEditorV3Controller,
  translate: (key: string) => string,
): ImageEditorLayerCreationCapabilityV3[] {
  const choices: ImageEditorLayerCreationCapabilityV3[] = []
  for (const kind of controller.profile.layerKinds) {
    if (kind === 'effect') {
      for (const subtype of EFFECT_SUBTYPES) {
        const capability = controller.profile.effects.find(({ id }) => id === subtype)
        if (capability) {
          choices.push({
            choice: { kind, subtype, name: translate(`imageEditor.v3.effect.${subtype}`) },
            readiness: capability.readiness,
          })
        }
      }
      continue
    }
    if (kind === 'adjustment') {
      for (const subtype of ADJUSTMENT_SUBTYPES) {
        if (controller.profile.adjustments.includes(subtype)) {
          choices.push({
            choice: { kind, subtype, name: translate(`imageEditor.v3.adjustment.${subtype}`) },
            readiness: { state: 'ready' },
          })
        }
      }
      continue
    }
    choices.push({
      choice: { kind, name: translate(`imageEditor.v3.layerType.${kind}`) },
      readiness: { state: 'ready' },
    })
  }
  return choices
}

export function ImageEditorLayersPanelV3({
  controller,
  embedded = false,
}: ImageEditorLayersPanelV3Props): JSX.Element {
  const { t } = useTranslation('ui')
  const thumbnailResource = useMemo(() => {
    const renderer = controller.historyPort ? new ImageEditThumbnailsV3({ sessionId: controller.sessionId,
      historyResourceDescriptors: controller.historyResourceDescriptors }) : null
    return { renderer, dispose: () => renderer?.dispose() }
  }, [controller.sessionId, controller.historyResourceDescriptors, controller.historyPort])
  useImageEditorDisposableV3(thumbnailResource)
  const thumbnails = thumbnailResource.renderer
  const [creationError, setCreationError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [creationProgress, setCreationProgress] = useState(0)
  const creationAbort = useRef<AbortController | null>(null)
  useEffect(() => () => creationAbort.current?.abort(), [])
  const layerViewportRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<VirtuosoHandle>(null)
  const pendingFocus = useRef<number | null>(null)
  const selectedLayerIds = useImageEditorSessionStoreV3(
    (state) => state.sessions[controller.sessionId]?.selectedLayerIds ?? EMPTY_LAYER_IDS,
  )
  const expandedGroupIds = useImageEditorSessionStoreV3(
    (state) => state.sessions[controller.sessionId]?.expandedGroupIds ?? EMPTY_LAYER_IDS,
  )
  const setSelectedLayerIds = useImageEditorSessionStoreV3((state) => state.setSelectedLayerIds)
  const toggleGroupExpanded = useImageEditorSessionStoreV3((state) => state.toggleGroupExpanded)
  const expanded = useMemo(() => new Set(expandedGroupIds), [expandedGroupIds])
  const rows = useMemo(
    () => flattenImageEditLayerTreeV3(controller.document.layers, expanded),
    [controller.document.layers, expanded],
  )
  const allRows = useMemo(() => flattenImageEditLayerTreeV3(controller.document.layers, new Set(collectImageEditLayerIdsV3(controller.document.layers))), [controller.document.layers])
  const treeIndex = useMemo(() => new Map(allRows.map(row => [row.layer.id, row])), [allRows])
  const selectedSet = useMemo(() => new Set(selectedLayerIds), [selectedLayerIds])
  const effectiveSelectedIds = getEffectiveSelectedIds(treeIndex, selectedLayerIds)
  const primaryLocation = effectiveSelectedIds.length === 1
    ? (treeIndex.get(effectiveSelectedIds[0]) ?? null)
    : null
  const primaryEditable = Boolean(
    primaryLocation && isImageEditLayerLocationEditableV3(primaryLocation),
  )
  const canDelete = canDeleteImageEditLayersV3(
    controller.document.layers,
    effectiveSelectedIds,
  )
  const creationChoices = useMemo(
    () => getCreationChoices(controller, t),
    [controller, t],
  )
  const creationChoiceLabels = useMemo(
    () => creationChoices.map(({ choice }) => choice.name),
    [creationChoices],
  )
  const reorderRows = useCallback((fromIndex: number, toIndex: number): void => {
    const moves = resolveImageEditLayerMovesV3(rows, fromIndex, toIndex, selectedLayerIds, allRows)
    if (!moves) return
    try {
      if (controller.moveLayers) controller.moveLayers(moves)
      else if (moves.length === 1) controller.moveLayer(moves[0].layerId, moves[0].parentId, moves[0].index)
      else throw new Error('请重新打开编辑器后移动多个图层')
      const groupId = moves[0].parentId
      if (groupId && !expanded.has(groupId)) toggleGroupExpanded(controller.sessionId, groupId)
      setCreationError(null)
    } catch (error) { setCreationError(error instanceof Error ? error.message : String(error)) }
  }, [controller, rows, selectedLayerIds, allRows, expanded, toggleGroupExpanded])
  const { dragState, itemRefs, handleMouseDown } = useReorderDrag({
    disabled: rows.length < 2,
    isCustomDragging: false,
    files: rows.map((row) => row.layer.id),
    layout: 'vertical',
    virtualVertical: true,
    dragThreshold: 5,
    dragBoundaryRef: layerViewportRef,
    allowButtonTarget: true,
    onReorder: reorderRows,
  })
  const focusPendingRow = useCallback(() => {
    const index = pendingFocus.current
    if (index === null) return
    const button = itemRefs.current[index]?.querySelector<HTMLButtonElement>('[data-layer-select]')
    if (button) { button.focus(); pendingFocus.current = null }
  }, [itemRefs])

  useEffect(() => {
    if (dragState.isDragging || dragState.isDropping) return
    const index = rows.findIndex(row => row.layer.id === selectedLayerIds[0])
    if (index >= 0) listRef.current?.scrollIntoView({ index })
  }, [rows, selectedLayerIds, dragState.isDragging, dragState.isDropping])

  const addChoice = (choice: ImageEditLayerCreationChoiceV3): void => {
    if (creationAbort.current) return
    const layer = createImageEditLayerFromChoiceV3(choice, controller.document.color.workingSpace, controller.document)
    setCreationError(null)
    const task = new AbortController(); creationAbort.current = task; setCreating(true); setCreationProgress(0)
    void Promise.resolve().then(() => controller.addLayer(layer, null, resolveCreationIndex(controller.document.layers, choice), task.signal, (done, total) => setCreationProgress(Math.floor(done / total * 100)))).then(() => {
      setSelectedLayerIds(controller.sessionId, [layer.id])
    }).catch((error: unknown) => { if (!task.signal.aborted) setCreationError(error instanceof Error ? error.message : String(error)) })
      .finally(() => { creationAbort.current = null; setCreating(false) })
  }

  const handleSelect = (row: ImageEditLayerTreeRowV3, event: MouseEvent<HTMLButtonElement>): void => {
    if (dragState.isDragging || dragState.isDropping) { event.preventDefault(); return }
    if (event.metaKey || event.ctrlKey) {
      const next = selectedSet.has(row.layer.id)
        ? selectedLayerIds.filter((id) => id !== row.layer.id)
        : [...selectedLayerIds, row.layer.id]
      setSelectedLayerIds(controller.sessionId, next)
      return
    }
    if (event.shiftKey && selectedLayerIds.length > 0) {
      const anchorIndex = rows.findIndex((entry) => entry.layer.id === selectedLayerIds[0])
      const currentIndex = rows.findIndex((entry) => entry.layer.id === row.layer.id)
      if (anchorIndex >= 0 && currentIndex >= 0) {
        const start = Math.min(anchorIndex, currentIndex)
        const end = Math.max(anchorIndex, currentIndex)
        setSelectedLayerIds(controller.sessionId, rows.slice(start, end + 1).map((entry) => entry.layer.id))
        return
      }
    }
    selectImageEditTargetV3(controller, row.layer.id, 'pixels')
  }

  const runAction = (work: () => void): void => {
    try { work(); setCreationError(null) } catch (error) { setCreationError(error instanceof Error ? error.message : String(error)) }
  }
  const renderRow = (row: ImageEditLayerTreeRowV3, index: number): JSX.Element => {
    const fromIndex = dragState.fromIndex
    const toIndex = dragState.toIndex
    const reordering = (dragState.isDragging || dragState.isDropping)
      && fromIndex !== null
      && toIndex !== null
    let avoidanceDirection: -1 | 0 | 1 = 0
    if (reordering && fromIndex < toIndex && index > fromIndex && index <= toIndex) {
      avoidanceDirection = -1
    } else if (reordering && fromIndex > toIndex && index < fromIndex && index >= toIndex) {
      avoidanceDirection = 1
    }
    const dropIndicator = dragState.isDragging
      && fromIndex !== null
      && toIndex !== null
      && fromIndex !== toIndex
      && toIndex === index
      ? (fromIndex < toIndex ? 'after' : 'before')
      : null

    return (
      <ImageEditorLayerRowV3
      key={row.layer.id}
      controller={controller}
      thumbnails={thumbnails}
      onError={setCreationError}
      row={row}
      selected={selectedSet.has(row.layer.id)}
      expanded={expanded.has(row.layer.id)}
      onSelect={handleSelect}
      onToggleExpanded={(groupId) => toggleGroupExpanded(controller.sessionId, groupId)}
      itemRef={(element) => { itemRefs.current[index] = element }}
      dragging={dragState.isDragging && dragState.fromIndex === index}
      dropping={dragState.isDropping && dragState.fromIndex === index}
      avoidanceDirection={avoidanceDirection}
      dropIndicator={dropIndicator}
      dragOffsetY={dragState.currentY - dragState.startY}
      dropOffsetRows={fromIndex !== null && toIndex !== null ? toIndex - fromIndex : 0}
      onDragMouseDown={(event) => {
        if (canDragImageEditLayerRowV3(row)) handleMouseDown(index, event)
      }}
      dragDisabled={!canDragImageEditLayerRowV3(row)}
    />
    )
  }

  return (
    <section data-layers-panel className="flex min-h-0 flex-1 flex-col">
      {creationError ? <UiError size="xs" message={creationError} /> : null}
      {creating ? <div className="flex items-center gap-2 px-3 text-xs text-text2" role="status">{t('imageEditor.v3.selection.progress', { percent: creationProgress })}<UiButton size="sm" onClick={() => creationAbort.current?.abort()}>{t('imageEditor.v3.selection.cancel-task')}</UiButton></div> : null}
      <div className="flex h-10 shrink-0 items-center gap-1 px-3">
        {embedded ? <div className="min-w-0 flex-1" /> : (
          <h2 className="min-w-0 flex-1 truncate text-xs font-semibold text-text2">
            {t('imageEditor.v3.layers.title')}
          </h2>
        )}
        <PanelTrigger
          panelWidthLabels={creationChoiceLabels}
          closeOnPanelClick
          renderPanel={() => (
            <div
              data-layer-add-menu
              className="flex flex-col gap-0.5 p-1"
              role="menu"
              aria-label={t('imageEditor.v3.layers.addLayer')}
            >
              {creationChoices.map(({ choice, readiness }) => {
                const key = `${choice.kind}:${choice.subtype ?? ''}`
                const disabled = creating || readiness.state !== 'ready'
                const reason = resolveImageEditorReadinessReasonV3(readiness, t)
                const unavailableLabel = reason
                  ? t('imageEditor.v3.readiness.unavailableWithReason', {
                      label: choice.name,
                      reason,
                    })
                  : t('imageEditor.v3.readiness.unavailable', { label: choice.name })
                return (
                  <UiOptionButton
                    key={key}
                    type="button"
                    role="menuitem"
                    variant="menu"
                    size="sm" className="w-full text-left"
                    disabled={disabled}
                    aria-label={disabled ? unavailableLabel : choice.name}
                    title={disabled ? unavailableLabel : undefined}
                    onClick={() => addChoice(choice)}
                  >
                    <span className="whitespace-nowrap">{choice.name}</span>
                  </UiOptionButton>
                )
              })}
            </div>
          )}
        >
          {({ togglePanel, open }) => (
            <UiIconButton
              data-panel-trigger-button
              on={open}
              aria-label={t('imageEditor.v3.layers.addLayer')}
              title={t('imageEditor.v3.layers.addLayer')}
              aria-expanded={open}
              onClick={togglePanel}
            >
              <Plus className="h-3.5 w-3.5" />
            </UiIconButton>
          )}
        </PanelTrigger>
        <UiIconButton
          disabled={!primaryEditable || !primaryLocation
            || primaryLocation.index >= primaryLocation.container.length - 1}
          aria-label={t('imageEditor.v3.layers.moveUp')}
          title={t('imageEditor.v3.layers.moveUp')}
          onClick={() => {
            if (!primaryLocation || !primaryEditable) return
            runAction(() => controller.moveLayer(
              primaryLocation.layer.id,
              primaryLocation.parentId,
              primaryLocation.index + 1,
            ))
          }}
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </UiIconButton>
        <UiIconButton
          disabled={!primaryEditable || !primaryLocation || primaryLocation.index <= 0}
          aria-label={t('imageEditor.v3.layers.moveDown')}
          title={t('imageEditor.v3.layers.moveDown')}
          onClick={() => {
            if (!primaryLocation || !primaryEditable) return
            runAction(() => controller.moveLayer(
              primaryLocation.layer.id,
              primaryLocation.parentId,
              primaryLocation.index - 1,
            ))
          }}
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </UiIconButton>
        <UiIconButton
          disabled={!primaryEditable || !primaryLocation}
          aria-label={t('imageEditor.v3.layers.duplicate')}
          title={t('imageEditor.v3.layers.duplicate')}
          onClick={() => {
            if (!primaryLocation || !primaryEditable) return
            const duplicateId = controller.duplicateLayer(
              primaryLocation.layer.id,
              primaryLocation.parentId,
              primaryLocation.index + 1,
            )
            if (duplicateId) setSelectedLayerIds(controller.sessionId, [duplicateId])
          }}
        >
          <Copy className="h-3.5 w-3.5" />
        </UiIconButton>
        <UiIconButton tone="danger"
          disabled={!canDelete}
          aria-label={t('imageEditor.v3.layers.delete')}
          title={t('imageEditor.v3.layers.delete')}
          onClick={() => {
            if (!canDelete) return
            effectiveSelectedIds.forEach(controller.deleteLayer)
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </UiIconButton>
      {controller.profile.layerKinds.includes('group') ? <PanelTrigger panelWidth={200} panelPadding="menu" closeOnPanelClick
        renderPanel={() => <div role="menu" className="flex flex-col gap-1">
        <UiOptionButton variant="menu" size="sm" role="menuitem" aria-label={t('imageEditor.v3.workflow.group')}
          disabled={!canGroupImageEditLayersV3(controller.document.layers, effectiveSelectedIds)}
          onClick={() => {
            try { const id = controller.groupLayers(effectiveSelectedIds, t('imageEditor.v3.workflow.groupName')); setSelectedLayerIds(controller.sessionId, [id]); toggleGroupExpanded(controller.sessionId, id); setCreationError(null) }
            catch (error) { setCreationError(error instanceof Error ? error.message : String(error)) }
          }}><FolderPlus className="h-4 w-4" />{t('imageEditor.v3.workflow.group')}</UiOptionButton>
        <UiOptionButton variant="menu" size="sm" role="menuitem" aria-label={t('imageEditor.v3.workflow.ungroup')} disabled={!canUngroupImageEditLayerV3(primaryLocation)}
          onClick={() => {
            if (!primaryLocation || primaryLocation.layer.type !== 'group') return
            try { const ids = primaryLocation.layer.children.map(layer => layer.id); controller.ungroupLayer(primaryLocation.layer.id); setSelectedLayerIds(controller.sessionId, ids); setCreationError(null) }
            catch (error) { setCreationError(error instanceof Error ? error.message : String(error)) }
          }}><Ungroup className="h-4 w-4" />{t('imageEditor.v3.workflow.ungroup')}</UiOptionButton>
        <UiOptionButton variant="menu" size="sm" role="menuitem" aria-label={t('imageEditor.v3.workflow.outGroup')} disabled={!primaryEditable || !primaryLocation?.parentId}
          onClick={() => {
            if (!primaryLocation?.parentId) return
            const parent = findImageEditLayerLocationV3(controller.document.layers, primaryLocation.parentId)
            if (!parent) return
            try { controller.moveLayer(primaryLocation.layer.id, parent.parentId, parent.index + 1); setCreationError(null) }
            catch (error) { setCreationError(error instanceof Error ? error.message : String(error)) }
          }}><CornerUpLeft className="h-4 w-4" />{t('imageEditor.v3.workflow.outGroup')}</UiOptionButton>
        </div>}>
        {({ open, togglePanel }) => <UiIconButton on={open} aria-haspopup="menu" aria-expanded={open}
          aria-label={t('imageEditor.v3.filterWorkspace.moreLayerActions', { defaultValue: '更多图层操作' })} onClick={togglePanel}><MoreHorizontal className="h-4 w-4" /></UiIconButton>}
      </PanelTrigger> : null}
      </div>

      <div
        role="tree"
        aria-label={t('imageEditor.v3.layers.title')}
        aria-multiselectable="true"
        className="min-h-0 flex-1 overflow-hidden"
        onKeyDownCapture={(event) => {
          if (event.metaKey || event.ctrlKey || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
          const button = (event.target as HTMLElement).closest('[data-layer-select]')
          if (!button) return
          const index = itemRefs.current.findIndex(element => element?.contains(button))
          if (index < 0) return
          event.preventDefault(); event.stopPropagation()
          const target = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1
            : Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowUp' ? -1 : 1)))
          pendingFocus.current = target
          listRef.current?.scrollIntoView({ index: target })
          focusPendingRow()
        }}
      >
        {rows.length === 0 ? (
          <UiEmpty size="sm" title={t('imageEditor.v3.layers.empty')} />
        ) : (
          <Virtuoso
            ref={listRef}
            initialItemCount={Math.min(12, rows.length)}
            computeItemKey={(_index, row) => row.layer.id}
            rangeChanged={() => requestAnimationFrame(focusPendingRow)}
            scrollerRef={(element) => { layerViewportRef.current = element instanceof HTMLDivElement ? element : null }}
            data={rows}
            itemContent={(index, row) => renderRow(row, index)}
            className="h-full"
          />
        )}
      </div>
    </section>
  )
}
