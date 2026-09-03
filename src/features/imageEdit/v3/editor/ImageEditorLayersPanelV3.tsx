import {
  ArrowDown,
  ArrowUp,
  Copy,
  Plus,
  Trash2,
} from 'lucide-react'
import type { MouseEvent } from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Virtuoso } from 'react-virtuoso'

import { PanelTrigger, UiIconButton, UiOptionButton } from '@/components/ui'
import { useReorderDrag } from '@/components/ui/fileUploader/useReorderDrag'
import type { ImageEditLayerV3 } from '@/core/imageEdit/v3/layerTypes'
import type { ImageEditorCapabilityReadinessV3 } from '../application/imageEditorHostProfiles'
import { useImageEditorSessionStoreV3 } from '../store'
import {
  canDragImageEditLayerRowV3,
  canDeleteImageEditLayersV3,
  createImageEditLayerFromChoiceV3,
  findImageEditLayerLocationV3,
  flattenImageEditLayerTreeV3,
  isImageEditLayerLocationEditableV3,
  resolveImageEditLayerDropV3,
  type ImageEditLayerCreationChoiceV3,
  type ImageEditLayerTreeRowV3,
} from './layerTreeV3'
import { ImageEditorLayerRowV3 } from './ImageEditorLayerRowV3'
import { resolveImageEditorReadinessReasonV3 } from './readinessPresentationV3'
import type { ImageEditorV3Controller } from './types'

interface ImageEditorLayersPanelV3Props {
  controller: ImageEditorV3Controller
  embedded?: boolean
}

const EFFECT_SUBTYPES = ['image.fast-blur-v3', 'image.diffusion', 'image.vgpu-glow'] as const
const ADJUSTMENT_SUBTYPES = ['exposure', 'curves', 'temperature-tint', 'hsl'] as const
const EMPTY_LAYER_IDS: readonly string[] = []

interface ImageEditorLayerCreationCapabilityV3 {
  choice: ImageEditLayerCreationChoiceV3
  readiness: ImageEditorCapabilityReadinessV3
}

function getEffectiveSelectedIds(
  layers: readonly ImageEditLayerV3[],
  selectedLayerIds: readonly string[],
): string[] {
  const selected = new Set(selectedLayerIds)
  return selectedLayerIds.filter((id) => {
    const location = findImageEditLayerLocationV3(layers, id)
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
  while (index > 0 && layers[index - 1].type === 'annotation') index -= 1
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
  const selectedSet = useMemo(() => new Set(selectedLayerIds), [selectedLayerIds])
  const effectiveSelectedIds = getEffectiveSelectedIds(controller.document.layers, selectedLayerIds)
  const primaryLocation = effectiveSelectedIds.length === 1
    ? findImageEditLayerLocationV3(controller.document.layers, effectiveSelectedIds[0])
    : null
  const primaryEditable = Boolean(
    primaryLocation && isImageEditLayerLocationEditableV3(primaryLocation),
  )
  const canDelete = canDeleteImageEditLayersV3(
    controller.document.layers,
    effectiveSelectedIds,
  )
  const creationChoices = getCreationChoices(controller, t)
  const reorderRows = useCallback((fromIndex: number, toIndex: number): void => {
    const destination = resolveImageEditLayerDropV3(rows, fromIndex, toIndex)
    if (!destination) return
    controller.moveLayer(destination.layerId, destination.parentId, destination.index)
  }, [controller, rows])
  const { dragState, itemRefs, handleMouseDown } = useReorderDrag({
    disabled: rows.length < 2,
    isCustomDragging: false,
    files: rows.map((row) => row.layer.id),
    layout: 'grid',
    allowButtonTarget: true,
    onReorder: reorderRows,
  })

  const addChoice = (choice: ImageEditLayerCreationChoiceV3): void => {
    const layer = createImageEditLayerFromChoiceV3(choice, controller.document.color.workingSpace)
    controller.addLayer(layer, null, resolveCreationIndex(controller.document.layers, choice))
    setSelectedLayerIds(controller.sessionId, [layer.id])
  }

  const handleSelect = (row: ImageEditLayerTreeRowV3, event: MouseEvent<HTMLButtonElement>): void => {
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
    setSelectedLayerIds(controller.sessionId, [row.layer.id])
  }

  const renderRow = (row: ImageEditLayerTreeRowV3, index: number): JSX.Element => (
    <ImageEditorLayerRowV3
      key={row.layer.id}
      controller={controller}
      row={row}
      selected={selectedSet.has(row.layer.id)}
      expanded={expanded.has(row.layer.id)}
      onSelect={handleSelect}
      onToggleExpanded={(groupId) => toggleGroupExpanded(controller.sessionId, groupId)}
      itemRef={(element) => { itemRefs.current[index] = element }}
      dragging={dragState.isDragging && dragState.fromIndex === index}
      dropTarget={dragState.isDragging
        && dragState.toIndex === index
        && dragState.fromIndex !== index}
      dragOffset={{
        x: dragState.currentX - dragState.startX,
        y: dragState.currentY - dragState.startY,
      }}
      onDragMouseDown={(event) => {
        if (canDragImageEditLayerRowV3(row)) handleMouseDown(index, event)
      }}
      dragDisabled={!canDragImageEditLayerRowV3(row)}
    />
  )

  return (
    <section data-layers-panel className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 px-3">
        {embedded ? <div className="min-w-0 flex-1" /> : (
          <h2 className="min-w-0 flex-1 truncate text-xs font-medium uppercase tracking-wider text-text-muted">
            {t('imageEditor.v3.layers.title')}
          </h2>
        )}
        <PanelTrigger
          panelWidth={184}
          closeOnPanelClick
          renderPanel={() => (
            <div
              data-layer-add-menu
              className="p-1.5"
              role="menu"
              aria-label={t('imageEditor.v3.layers.addLayer')}
            >
              {creationChoices.map(({ choice, readiness }) => {
                const key = `${choice.kind}:${choice.subtype ?? ''}`
                const disabled = readiness.state !== 'ready'
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
                    className="w-full flex-col items-start justify-start gap-0.5 text-left text-xs"
                    disabled={disabled}
                    aria-label={disabled ? unavailableLabel : choice.name}
                    title={disabled ? unavailableLabel : choice.name}
                    onClick={() => addChoice(choice)}
                  >
                    <span>{choice.name}</span>
                    {disabled && reason ? (
                      <span className="text-2xs text-text-muted">{reason}</span>
                    ) : null}
                  </UiOptionButton>
                )
              })}
            </div>
          )}
        >
          {({ togglePanel, open }) => (
            <UiIconButton
              data-panel-trigger-button
              className="h-7 w-7"
              showBorder={false}
              appearance="hover-only"
              active={open}
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
          className="h-7 w-7"
          showBorder={false}
          appearance="hover-only"
          disabled={!primaryEditable || !primaryLocation
            || primaryLocation.index >= primaryLocation.container.length - 1}
          aria-label={t('imageEditor.v3.layers.moveUp')}
          title={t('imageEditor.v3.layers.moveUp')}
          onClick={() => {
            if (!primaryLocation || !primaryEditable) return
            controller.moveLayer(
              primaryLocation.layer.id,
              primaryLocation.parentId,
              primaryLocation.index + 1,
            )
          }}
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </UiIconButton>
        <UiIconButton
          className="h-7 w-7"
          showBorder={false}
          appearance="hover-only"
          disabled={!primaryEditable || !primaryLocation || primaryLocation.index <= 0}
          aria-label={t('imageEditor.v3.layers.moveDown')}
          title={t('imageEditor.v3.layers.moveDown')}
          onClick={() => {
            if (!primaryLocation || !primaryEditable) return
            controller.moveLayer(
              primaryLocation.layer.id,
              primaryLocation.parentId,
              primaryLocation.index - 1,
            )
          }}
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </UiIconButton>
        <UiIconButton
          className="h-7 w-7"
          showBorder={false}
          appearance="hover-only"
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
        <UiIconButton
          className="h-7 w-7"
          showBorder={false}
          appearance="hover-only"
          hoverVariant="danger"
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
      </div>

      <div
        role="tree"
        aria-label={t('imageEditor.v3.layers.title')}
        aria-multiselectable="true"
        className="ui-scrollbar min-h-0 flex-1 overflow-y-auto"
      >
        {rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-text-muted">
            {t('imageEditor.v3.layers.empty')}
          </p>
        ) : rows.length > 50 ? (
          <Virtuoso
            data={rows}
            itemContent={(index, row) => renderRow(row, index)}
            className="h-full"
          />
        ) : rows.map(renderRow)}
      </div>
    </section>
  )
}
