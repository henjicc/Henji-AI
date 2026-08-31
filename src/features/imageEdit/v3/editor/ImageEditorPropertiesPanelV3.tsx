import { Plus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  UiButton,
  UiFormRow,
  UiGroup,
  UiInput,
  UiRangeInput,
  UiSelect,
  UiSwitch,
} from '@/components/ui'
import {
  IMAGE_EDIT_BLEND_MODES_V3,
  cloneImageEditMaskReferenceV3,
  createImageEditSparseMaskReferenceV3,
  type ImageEditLayerV3,
} from '@/core/imageEdit/v3/layerTypes'
import { createImageEditIdV3 } from '@/core/imageEdit/v3/documentFactory'
import { useImageEditorSessionStoreV3 } from '../store'
import { ImageEditorEffectParametersV3 } from './ImageEditorEffectParametersV3'
import { ImageEditorAnnotationPropertiesV3 } from './ImageEditorAnnotationPropertiesV3'
import { ImageEditorLayerTransformPropertiesV3 } from './ImageEditorLayerTransformPropertiesV3'
import { findImageEditLayerLocationV3 } from './layerTreeV3'
import { isImageEditLayerTransformableV3 } from './layerTransformV3'
import { resolveImageEditorReadinessReasonV3 } from './readinessPresentationV3'
import type { ImageEditorV3Controller, ImageEditorV3Props } from './types'

interface ImageEditorPropertiesPanelV3Props extends Pick<ImageEditorV3Props, 'onCreateMaskResource'> {
  controller: ImageEditorV3Controller
}

const EMPTY_LAYER_IDS: readonly string[] = []

function LayerNameField({ controller, layer, disabled }: {
  controller: ImageEditorV3Controller
  layer: ImageEditLayerV3
  disabled: boolean
}): JSX.Element {
  const { t } = useTranslation('ui')
  const [name, setName] = useState(layer.name)
  useEffect(() => setName(layer.name), [layer.id, layer.name])
  const commit = (): void => {
    if (disabled) return
    const trimmed = name.trim()
    if (trimmed && trimmed !== layer.name) controller.updateLayerCommon(layer.id, { name: trimmed })
    else setName(layer.name)
  }
  return (
    <UiFormRow label={t('imageEditor.v3.properties.name')}>
      <UiInput
        aria-label={t('imageEditor.v3.properties.name')}
        value={name}
        disabled={disabled}
        onChange={(event) => setName(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            setName(layer.name)
            event.currentTarget.blur()
          }
        }}
      />
    </UiFormRow>
  )
}

function OpacityControl({ controller, layer, disabled }: {
  controller: ImageEditorV3Controller
  layer: ImageEditLayerV3
  disabled: boolean
}): JSX.Element {
  const { t } = useTranslation('ui')
  const previewId = `${controller.sessionId}:${layer.id}:opacity`
  const [draft, setDraft] = useState(layer.opacity)
  const activeRef = useRef(false)
  const draftRef = useRef(layer.opacity)
  useEffect(() => {
    if (!activeRef.current) {
      setDraft(layer.opacity)
      draftRef.current = layer.opacity
    }
  }, [layer.id, layer.opacity])
  useEffect(() => () => controller.clearParameterPreview(previewId), [controller, previewId])
  useEffect(() => {
    if (!disabled || !activeRef.current) return
    activeRef.current = false
    controller.clearParameterPreview(previewId)
    setDraft(layer.opacity)
    draftRef.current = layer.opacity
  }, [controller, disabled, layer.opacity, previewId])
  const update = (next: number): void => {
    if (disabled) return
    activeRef.current = true
    draftRef.current = next
    setDraft(next)
    controller.setParameterPreview(previewId, layer.id, { opacity: next })
  }
  const commit = (): void => {
    if (disabled || !activeRef.current) return
    activeRef.current = false
    controller.commitLayerCommonPreview(previewId, layer.id, { opacity: draftRef.current })
  }
  return (
    <UiFormRow label={t('imageEditor.v3.properties.opacity')}>
      <div className="flex items-center gap-2">
        <UiRangeInput
          aria-label={t('imageEditor.v3.properties.opacity')}
          min={0}
          max={1}
          step={0.01}
          value={draft}
          disabled={disabled}
          onChange={(event) => update(Number(event.currentTarget.value))}
          onPointerUp={commit}
          onPointerCancel={() => {
            if (!activeRef.current) return
            activeRef.current = false
            controller.clearParameterPreview(previewId)
            setDraft(layer.opacity)
            draftRef.current = layer.opacity
          }}
          onKeyUp={commit}
          onBlur={commit}
        />
        <span className="w-10 text-right text-xs tabular-nums text-text-muted">
          {Math.round(draft * 100)}%
        </span>
      </div>
    </UiFormRow>
  )
}

export function ImageEditorPropertiesPanelV3({
  controller,
}: ImageEditorPropertiesPanelV3Props): JSX.Element {
  const { t } = useTranslation('ui')
  const selectedIds = useImageEditorSessionStoreV3(
    (state) => state.sessions[controller.sessionId]?.selectedLayerIds ?? EMPTY_LAYER_IDS,
  )
  const selectedLocation = selectedIds.length === 1
    ? findImageEditLayerLocationV3(controller.document.layers, selectedIds[0])
    : undefined
  const selected = selectedLocation?.layer
  const effectReadiness = selected?.type === 'effect'
    ? controller.profile.effects.find(({ id }) => id === selected.effectId)?.readiness
    : undefined
  const effectReadinessReason = effectReadiness
    ? resolveImageEditorReadinessReasonV3(effectReadiness, t)
    : undefined

  if (!selected) {
    return (
      <section data-properties-panel className="min-h-0 flex-1 px-4 py-8">
        <h2 className="text-xs font-medium uppercase tracking-wider text-text-muted">
          {t('imageEditor.v3.properties.title')}
        </h2>
        <p className="mt-4 text-xs text-text-muted">{t('imageEditor.v3.properties.selectOne')}</p>
      </section>
    )
  }

  const ancestorLocked = Boolean(
    selectedLocation?.ancestors.some((ancestor) => ancestor.locked),
  )
  const contentLocked = selected.locked || ancestorLocked

  const addMask = (): void => {
    if (contentLocked) return
    controller.setLayerMask(
      selected.id,
      createImageEditSparseMaskReferenceV3(createImageEditIdV3('mask')),
    )
  }

  return (
    <section data-properties-panel className="ui-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-3">
      <h2 className="mb-4 text-xs font-medium uppercase tracking-wider text-text-muted">
        {t('imageEditor.v3.properties.title')}
      </h2>
      <UiGroup gap="stack">
        <LayerNameField controller={controller} layer={selected} disabled={contentLocked} />
        <UiFormRow label={t('imageEditor.v3.properties.visible')} inline>
          <UiSwitch
            aria-label={t('imageEditor.v3.properties.visible')}
            checked={selected.visible}
            disabled={contentLocked}
            onCheckedChange={(visible) => {
              if (!contentLocked) controller.updateLayerCommon(selected.id, { visible })
            }}
          />
        </UiFormRow>
        <UiFormRow label={t('imageEditor.v3.properties.locked')} inline>
          <UiSwitch
            aria-label={t('imageEditor.v3.properties.locked')}
            checked={selected.locked}
            disabled={ancestorLocked}
            onCheckedChange={(locked) => {
              if (!ancestorLocked) controller.updateLayerCommon(selected.id, { locked })
            }}
          />
        </UiFormRow>
        <OpacityControl controller={controller} layer={selected} disabled={contentLocked} />
        <UiFormRow label={t('imageEditor.v3.properties.blendMode')}>
          <UiSelect
            aria-label={t('imageEditor.v3.properties.blendMode')}
            value={selected.blendMode}
            disabled={contentLocked}
            onChange={(event) => {
              if (!contentLocked) {
                controller.updateLayerCommon(selected.id, {
                  blendMode: event.currentTarget.value as ImageEditLayerV3['blendMode'],
                })
              }
            }}
          >
            {IMAGE_EDIT_BLEND_MODES_V3.map((mode) => (
              <option key={mode} value={mode}>{t(`imageEditor.v3.blendMode.${mode}`)}</option>
            ))}
          </UiSelect>
        </UiFormRow>
        {selected.type === 'group' ? (
          <UiFormRow
            label={t('imageEditor.v3.properties.groupIsolation')}
            info={t('imageEditor.v3.properties.groupIsolationInfo')}
            inline
          >
            <UiSwitch
              aria-label={t('imageEditor.v3.properties.groupIsolation')}
              checked={selected.isolated}
              disabled={contentLocked}
              onCheckedChange={(isolated) => {
                if (!contentLocked) controller.updateGroupIsolation(selected.id, isolated)
              }}
            />
          </UiFormRow>
        ) : null}
      </UiGroup>

      {selected.type === 'raster' || selected.type === 'annotation' || selected.type === 'group' ? (
        <ImageEditorLayerTransformPropertiesV3
          controller={controller}
          layer={selected}
          disabled={!isImageEditLayerTransformableV3(selectedLocation ?? null)}
        />
      ) : null}

      {(selected.type === 'effect' || selected.type === 'adjustment') ? (
        <UiGroup
          divided
          className="mt-5"
          title={selected.type === 'effect'
            ? t(`imageEditor.v3.effect.${selected.effectId}`, { defaultValue: selected.name })
            : t(`imageEditor.v3.adjustment.${selected.adjustmentId}`, { defaultValue: selected.name })}
          gap="stack"
        >
          {!selected.renderable ? (
            <p className="text-xs text-warning">{t('imageEditor.v3.properties.unrenderable')}</p>
          ) : null}
          {effectReadiness?.state !== 'ready' && effectReadinessReason ? (
            <p role="status" className="text-xs text-warning">{effectReadinessReason}</p>
          ) : null}
          <ImageEditorEffectParametersV3
            controller={controller}
            layer={selected}
            disabled={contentLocked || !selected.renderable}
          />
        </UiGroup>
      ) : null}

      {selected.type === 'annotation' ? (
        <ImageEditorAnnotationPropertiesV3
          controller={controller}
          layer={selected}
          locked={contentLocked}
        />
      ) : null}

      <UiGroup divided className="mt-5" title={t('imageEditor.v3.properties.mask')} gap="stack">
        {selected.mask ? (
          <>
            <UiFormRow label={t('imageEditor.v3.properties.maskInverted')} inline>
              <UiSwitch
                aria-label={t('imageEditor.v3.properties.maskInverted')}
                checked={selected.mask.inverted}
                disabled={contentLocked}
                onCheckedChange={(inverted) => {
                  if (!contentLocked) {
                    const currentMask = selected.mask
                    if (!currentMask) return
                    const mask = cloneImageEditMaskReferenceV3(currentMask)
                    mask.inverted = inverted
                    controller.setLayerMask(selected.id, mask)
                  }
                }}
              />
            </UiFormRow>
            <UiButton
              variant="plain"
              size="sm"
              className="justify-start gap-2"
              disabled={contentLocked}
              onClick={() => {
                if (!contentLocked) controller.setLayerMask(selected.id, null)
              }}
            >
              <X className="h-4 w-4" />
              {t('imageEditor.v3.properties.removeMask')}
            </UiButton>
          </>
        ) : (
          <UiButton
            variant="muted"
            size="sm"
            className="justify-start gap-2"
            disabled={contentLocked}
            onClick={addMask}
          >
            <Plus className="h-4 w-4" />
            {t('imageEditor.v3.properties.addMask')}
          </UiButton>
        )}
      </UiGroup>
    </section>
  )
}
