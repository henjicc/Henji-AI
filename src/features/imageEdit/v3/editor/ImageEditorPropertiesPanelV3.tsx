import { Plus, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  UiButton,
  UiEmpty,
  UiChipButton,
  UiFormRow,
  UiGroup,
  UiInput,
  Dropdown,
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
import type { ImageEditorV3Controller } from './types'
import { ImageEditorLayerScalarsV3 } from '../panels/properties/ImageEditorLayerScalarsV3'
import { selectImageEditTargetV3 } from '../panels/layers/editTarget'
import { SmartContentPropertiesV3 } from '../smartContent/SmartContentProperties'

interface ImageEditorPropertiesPanelV3Props {
  controller: ImageEditorV3Controller
  embedded?: boolean
}

function MaskTransformProperties({ controller, layer, disabled }: { controller: ImageEditorV3Controller; layer: ImageEditLayerV3; disabled: boolean }): JSX.Element {
  const adapter = useMemo<ImageEditorV3Controller>(() => ({ ...controller,
    setTransformPreview: (id, layerId, transform) => controller.setParameterPreview(id, layerId, { maskAttachment: { ...layer.maskAttachment, transform } }),
    clearTransformPreview: controller.clearParameterPreview,
    commitTransformPreview: (id, layerId, transform) => controller.commitLayerCommonPreview(id, layerId, { maskAttachment: { ...layer.maskAttachment, transform } }),
  }), [controller, layer.maskAttachment])
  const target = useMemo(() => ({ ...layer, transform: layer.maskAttachment.transform }), [layer])
  return <ImageEditorLayerTransformPropertiesV3 layer={target} disabled={disabled} controller={adapter} />
}

const EMPTY_LAYER_IDS: readonly string[] = []
type ImageEditorPropertiesTabV3 = 'parameters' | 'basics'

function LayerNameField({ controller, layer, disabled }: {
  controller: ImageEditorV3Controller
  layer: ImageEditLayerV3
  disabled: boolean
}): JSX.Element {
  const { t } = useTranslation('ui')
  const [name, setName] = useState(layer.name)
  const cancelled = useRef(false)
  useEffect(() => setName(layer.name), [layer.id, layer.name])
  const commit = (): void => {
    if (disabled || cancelled.current) { cancelled.current = false; return }
    const trimmed = name.trim()
    if (trimmed && trimmed !== layer.name) controller.updateLayerCommon(layer.id, { name: trimmed })
    else setName(layer.name)
  }
  return (
    <UiFormRow density="compact" label={t('imageEditor.v3.properties.name')}>
      <UiInput
        aria-label={t('imageEditor.v3.properties.name')}
        value={name}
        disabled={disabled}
        onChange={(event) => setName(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            cancelled.current = true
            setName(layer.name)
            event.currentTarget.blur()
          }
        }}
      />
    </UiFormRow>
  )
}

export function ImageEditorPropertiesPanelV3({
  controller,
  embedded = false,
}: ImageEditorPropertiesPanelV3Props): JSX.Element {
  const { t } = useTranslation('ui')
  const selectedIds = useImageEditorSessionStoreV3(
    (state) => state.sessions[controller.sessionId]?.selectedLayerIds ?? EMPTY_LAYER_IDS,
  )
  const selectedLocation = selectedIds.length === 1
    ? findImageEditLayerLocationV3(controller.document.layers, selectedIds[0])
    : undefined
  const selected = selectedLocation?.layer
  const editTarget = useImageEditorSessionStoreV3(state => state.sessions[controller.sessionId]?.editTarget ?? 'pixels')
  const [activeTab, setActiveTab] = useState<ImageEditorPropertiesTabV3>('parameters')
  useEffect(() => {
    if (selected?.id) setActiveTab('parameters')
  }, [selected?.id, editTarget])
  const effectReadiness = selected?.type === 'effect'
    ? controller.profile.effects.find(({ id }) => id === selected.effectId)?.readiness
    : undefined
  const effectReadinessReason = effectReadiness
    ? resolveImageEditorReadinessReasonV3(effectReadiness, t)
    : undefined

  if (!selected) {
    return (
      <section data-properties-panel className="min-h-0 flex-1 px-4 py-8">
        {!embedded ? (
          <h2 className="text-xs font-semibold text-text2">
            {t('imageEditor.v3.properties.title')}
          </h2>
        ) : null}
        <UiEmpty size="sm" title={t('imageEditor.v3.properties.selectOne')} />
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
    selectImageEditTargetV3(controller, selected.id, 'mask')
  }

  return (
    <section
      data-properties-panel
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      {!embedded ? (
        <h2 className="mb-4 text-xs font-semibold text-text2">
          {t('imageEditor.v3.properties.title')}
        </h2>
      ) : null}
      <div
        role="tablist"
        aria-label={t('imageEditor.v3.properties.tabsLabel')}
        className="grid shrink-0 grid-cols-2 border-b border-line/60 px-2"
      >
        {(['parameters', 'basics'] as const).map((tab) => (
          <UiChipButton
            key={tab}
            role="tab"
            selectionRole="navigation"
            selectionAppearance="subtle"
            data-properties-tab={tab}
            size="lg" className="justify-center"
            active={activeTab === tab}
            aria-selected={activeTab === tab}
            aria-controls={`image-editor-properties-${tab}`}
            onClick={() => setActiveTab(tab)}
          >
            {t(`imageEditor.v3.properties.${tab}Tab`)}
          </UiChipButton>
        ))}
      </div>

      <div
        id={`image-editor-properties-${activeTab}`}
        role="tabpanel"
        data-properties-tab-panel={activeTab}
        className={`min-h-0 flex-1 overflow-y-auto ${embedded ? 'px-3 py-3' : 'px-4 py-3'}`}
      >
      {activeTab === 'basics' ? (
      <UiGroup titleTone="compact" gap="stack">
        <LayerNameField controller={controller} layer={selected} disabled={contentLocked} />
        <UiFormRow density="compact" label={t('imageEditor.v3.properties.visible')} inline>
          <UiSwitch
            aria-label={t('imageEditor.v3.properties.visible')}
            checked={selected.visible}
            disabled={contentLocked}
            onCheckedChange={(visible) => {
              if (!contentLocked) controller.updateLayerCommon(selected.id, { visible })
            }}
          />
        </UiFormRow>
        <UiFormRow density="compact" label={t('imageEditor.v3.properties.locked')} inline>
          <UiSwitch
            aria-label={t('imageEditor.v3.properties.locked')}
            checked={selected.locked}
            disabled={ancestorLocked}
            onCheckedChange={(locked) => {
              if (!ancestorLocked) controller.updateLayerCommon(selected.id, { locked })
            }}
          />
        </UiFormRow>
        <ImageEditorLayerScalarsV3 controller={controller} layer={selected} disabled={contentLocked} />
        {selectedLocation.index > 0 ? <UiFormRow density="compact" label={t('imageEditor.v3.workflow.clipping')} inline><UiSwitch aria-label={t('imageEditor.v3.workflow.clipping')} checked={selected.clipping} disabled={contentLocked} onCheckedChange={clipping => controller.updateLayerCommon(selected.id, { clipping })} /></UiFormRow> : null}
        {controller.profile.layerControls.includes('blend-mode') ? (
          <UiFormRow density="compact" label={t('imageEditor.v3.properties.blendMode')}>
            <Dropdown<ImageEditLayerV3['blendMode']>
              ariaLabel={t('imageEditor.v3.properties.blendMode')}
              className="w-full"
              minWidthStrategy="none"
              value={selected.blendMode}
              disabled={contentLocked}
              display={t(`imageEditor.v3.blendMode.${selected.blendMode}`)}
              options={IMAGE_EDIT_BLEND_MODES_V3.map((mode) => ({ label: t(`imageEditor.v3.blendMode.${mode}`), value: mode }))}
              onSelect={(blendMode) => {
                if (!contentLocked) controller.updateLayerCommon(selected.id, { blendMode })
              }}
            />
          </UiFormRow>
        ) : null}
        {selected.type === 'group' && controller.profile.layerKinds.includes('group') ? (
          <UiFormRow density="compact"
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
      ) : (
      <>
        {editTarget !== 'mask' && (selected.type === 'raster' || selected.type === 'smart' || selected.type === 'annotation' || selected.type === 'group') ? (
          <ImageEditorLayerTransformPropertiesV3
            controller={controller}
            layer={selected}
            disabled={!isImageEditLayerTransformableV3(selectedLocation ?? null)}
          />
        ) : null}

        {editTarget !== 'mask' && controller.profile.layerKinds.includes('smart') ? <SmartContentPropertiesV3 layer={selected} disabled={contentLocked} /> : null}

        {editTarget !== 'mask' && (selected.type === 'effect' || selected.type === 'adjustment') ? (
          <div>
            {!selected.renderable ? (
              <p className="mb-3 text-xs text-warning-text">{t('imageEditor.v3.properties.unrenderable')}</p>
            ) : null}
            {effectReadiness?.state !== 'ready' && effectReadinessReason ? (
              <p role="status" className="mb-3 text-xs text-warning-text">{effectReadinessReason}</p>
            ) : null}
            <ImageEditorEffectParametersV3
              controller={controller}
              layer={selected}
              disabled={contentLocked || !selected.renderable}
            />
          </div>
        ) : null}

        {editTarget !== 'mask' && selected.type === 'annotation' ? (
          <ImageEditorAnnotationPropertiesV3
            controller={controller}
            layer={selected}
            locked={contentLocked}
          />
        ) : null}

        {controller.profile.layerControls.includes('mask') ? (
          <UiGroup titleTone="compact" divided className="mt-5" title={t('imageEditor.v3.properties.mask')} gap="stack">
          {selected.mask ? (
            <>
              <div className="flex gap-1">
                <UiChipButton active={editTarget === 'pixels'} size="sm" onClick={() => selectImageEditTargetV3(controller, selected.id, 'pixels')}>{t('imageEditor.v3.workflow.content')}</UiChipButton>
                <UiChipButton active={editTarget === 'mask'} size="sm" onClick={() => selectImageEditTargetV3(controller, selected.id, 'mask')}>{t('imageEditor.v3.workflow.mask')}</UiChipButton>
              </div>
              <UiFormRow density="compact" label={t('imageEditor.v3.workflow.maskEnabled')} inline><UiSwitch aria-label={t('imageEditor.v3.workflow.maskEnabled')} checked={selected.maskAttachment.enabled} disabled={contentLocked} onCheckedChange={enabled => controller.updateLayerCommon(selected.id, { maskAttachment: { ...selected.maskAttachment, enabled } })} /></UiFormRow>
              <UiFormRow density="compact" label={t('imageEditor.v3.workflow.maskLinked')} inline><UiSwitch aria-label={t('imageEditor.v3.workflow.maskLinked')} checked={selected.maskAttachment.linked} disabled={contentLocked} onCheckedChange={linked => controller.updateLayerCommon(selected.id, { maskAttachment: { ...selected.maskAttachment, linked } })} /></UiFormRow>
              <ImageEditorLayerScalarsV3 controller={controller} layer={selected} disabled={contentLocked} mask />
              {editTarget === 'mask' ? <MaskTransformProperties layer={selected} disabled={contentLocked} controller={controller} /> : null}
              <UiFormRow density="compact" label={t('imageEditor.v3.properties.maskInverted')} inline>
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
                className="justify-start gap-2"
                disabled={contentLocked}
                onClick={() => {
                  if (!contentLocked) { controller.setLayerMask(selected.id, null); selectImageEditTargetV3(controller, selected.id, 'pixels') }
                }}
              >
                <X className="h-4 w-4" />
                {t('imageEditor.v3.properties.removeMask')}
              </UiButton>
            </>
          ) : (
            <UiButton
              variant="secondary"
              className="justify-start gap-2"
              disabled={contentLocked}
              onClick={addMask}
            >
              <Plus className="h-4 w-4" />
              {t('imageEditor.v3.properties.addMask')}
            </UiButton>
          )}
          </UiGroup>
        ) : null}
      </>
      )}
      </div>
    </section>
  )
}
