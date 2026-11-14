import { defaultTextStyle, vectorPathContentSchema } from '@/core/imaging/vectorContent'
import { FileImage, SquareDashed, SquareX } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import {
  UiEmpty,
  UiFieldLayoutContext,
  UiPropertyKeyframesContext,
  UiFormRow,
  UiSegmented,
  UiToolbar,
  Dropdown,
  UiSwitch,
  type UiPanelFooterAction,
} from '@/components/ui'
import { PropertyHeading } from '@/components/ui/params/ParamList'
import {
  IMAGE_EDIT_BLEND_MODES_V3,
  cloneImageEditMaskReferenceV3,
  createImageEditSparseMaskReferenceV3,
  type ImageEditLayerV3,
} from '@/core/imageEdit/v3/layerTypes'
import { createImageEditIdV3 } from '@/core/imageEdit/v3/documentFactory'
import { useImageEditorSessionStoreV3 } from '../store'
import { ImageEditorEffectParametersV3 } from './ImageEditorEffectParametersV3'
import { VectorProperties } from '../tools/vector/VectorProperties'
import { isImageEditVectorLayerV3 } from '@/core/imageEdit/v3/layerEntries/vector'
import { ImageEditorLayerTransformPropertiesV3 } from './ImageEditorLayerTransformPropertiesV3'
import { findImageEditLayerLocationV3 } from './layerTreeV3'
import { isImageEditLayerTransformableV3 } from './layerTransformV3'
import { resolveImageEditorReadinessReasonV3 } from './readinessPresentationV3'
import type { ImageEditorV3Controller } from './types'
import { ImageEditorLayerScalarsV3 } from '../panels/properties/ImageEditorLayerScalarsV3'
import { selectImageEditTargetV3 } from '../panels/layers/editTarget'
import { SmartContentPropertiesV3 } from '../smartContent/SmartContentProperties'
import { useSmartContentV3 } from '../smartContent/SmartContentContext'

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

/** 可折叠的属性分组：小标题与参数行同一套列，分组之间一条发丝线。 */
function PropertySection({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  const { t } = useTranslation('ui')
  const [open, setOpen] = useState(true)
  return (
    <div data-properties-section={title} className="flex flex-col border-b border-line py-1 last:border-b-0">
      <PropertyHeading label={title} name={t(open ? 'imageEditor.v3.panels.collapse' : 'imageEditor.v3.panels.expand', { title })} open={open} onToggle={() => setOpen(value => !value)} />
      {open ? children : null}
    </div>
  )
}

/** 效果、矢量、智能对象这类自带表单排布的参数照旧按表单排，左右与属性行对齐留白。 */
function FormSection({ children }: { children: ReactNode }): JSX.Element {
  return <UiFieldLayoutContext.Provider value="form"><div className="flex flex-col gap-3 px-3 py-2">{children}</div></UiFieldLayoutContext.Provider>
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
  const smart = useSmartContentV3()
  // 智能对象的进行中与失败状态是整个编辑器共用的一份：只在从底栏发起转换的那一层上显示
  const [convertingLayerId, setConvertingLayerId] = useState<string | null>(null)
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
  const lockedReason = t('imageEditor.v3.properties.lockedReason')
  const maskEnabled = controller.profile.layerControls.includes('mask')
  const editingMask = editTarget === 'mask'

  const addMask = (): void => {
    if (contentLocked) return
    controller.setLayerMask(
      selected.id,
      createImageEditSparseMaskReferenceV3(createImageEditIdV3('mask')),
    )
    selectImageEditTargetV3(controller, selected.id, 'mask')
  }
  const removeMask = (): void => {
    if (contentLocked) return
    controller.setLayerMask(selected.id, null)
    selectImageEditTargetV3(controller, selected.id, 'pixels')
  }

  const size = selected.type === 'raster' ? selected.rasterCanvasSize ?? controller.document.geometry : undefined
  const meta = [
    t(`imageEditor.v3.layerType.${selected.type}`, { defaultValue: '' }),
    size ? `${size.width} × ${size.height}` : '',
  ].filter(Boolean).join(' · ')

  // 蒙版与智能对象的入口在底栏：不常用、图标说得清，不占属性行
  const tools: UiPanelFooterAction[] = []
  if (maskEnabled) {
    tools.push(selected.mask
      ? { kind: 'action', id: 'remove-mask', label: t('imageEditor.v3.properties.removeMask'), icon: SquareX, onSelect: removeMask, disabled: contentLocked, disabledReason: lockedReason }
      : { kind: 'action', id: 'add-mask', label: t('imageEditor.v3.properties.addMask'), icon: SquareDashed, onSelect: addMask, disabled: contentLocked, disabledReason: lockedReason })
  }
  if (smart && controller.profile.layerKinds.includes('smart') && selected.type === 'raster' && !editingMask) {
    tools.push({
      kind: 'action', id: 'convert-smart', label: t('imageEditor.v3.properties.convertToSmart'), icon: FileImage,
      onSelect: () => { setConvertingLayerId(selected.id); void smart.convert(selected.id, 'smart') },
      disabled: contentLocked || smart.busy,
      disabledReason: smart.busy ? t('imageEditor.v3.properties.smartBusy') : lockedReason,
    })
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
      {/* 选中的是哪一层：名字最亮，类型与尺寸退后。名称、显示、锁定在图层行上，改名在图层行上双击 */}
      <header data-properties-object className="shrink-0 border-b border-line px-3 py-2">
        <div className="truncate text-13 font-medium text-text1">{selected.name}</div>
        {meta ? <div className="truncate text-xs tabular-nums text-text3">{meta}</div> : null}
      </header>

      <div data-properties-body className="min-h-0 flex-1 overflow-y-auto">
        {/* 图片编辑没有关键帧：属性行不留“已改”与秒表两列，名称从折叠箭头后面起笔 */}
        <UiPropertyKeyframesContext.Provider value={false}>
        <UiFieldLayoutContext.Provider value="property">
          {!editingMask && (selected.type === 'raster' || selected.type === 'smart' || isImageEditVectorLayerV3(selected) || selected.type === 'group') ? (
            <PropertySection title={t('imageEditor.v3.properties.transform')}>
              <ImageEditorLayerTransformPropertiesV3
                controller={controller}
                layer={selected}
                disabled={!isImageEditLayerTransformableV3(selectedLocation ?? null)}
              />
            </PropertySection>
          ) : null}

          <PropertySection title={t('imageEditor.v3.properties.composite')}>
            <ImageEditorLayerScalarsV3 controller={controller} layer={selected} disabled={contentLocked} />
            {controller.profile.layerControls.includes('blend-mode') ? (
              <UiFormRow label={t('imageEditor.v3.properties.blendMode')}>
                <Dropdown<ImageEditLayerV3['blendMode']>
                  ariaLabel={t('imageEditor.v3.properties.blendMode')}
                  size="sm"
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
            {selectedLocation.index > 0 ? (
              <UiFormRow label={t('imageEditor.v3.workflow.clipping')}>
                <UiSwitch aria-label={t('imageEditor.v3.workflow.clipping')} checked={selected.clipping} disabled={contentLocked} onCheckedChange={clipping => controller.updateLayerCommon(selected.id, { clipping })} />
              </UiFormRow>
            ) : null}
            {selected.type === 'group' && controller.profile.layerKinds.includes('group') ? (
              <UiFormRow label={t('imageEditor.v3.properties.groupIsolation')} info={t('imageEditor.v3.properties.groupIsolationInfo')}>
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
          </PropertySection>

          {/* 从底栏转换为智能对象时，进行中与失败原因在这里显示 */}
          {!editingMask && selected.type === 'raster' && smart && selected.id === convertingLayerId && (smart.busy || smart.error) ? (
            <FormSection><SmartContentPropertiesV3 layer={selected} disabled={contentLocked} /></FormSection>
          ) : null}

          {!editingMask && selected.type === 'smart' && controller.profile.layerKinds.includes('smart') ? (
            <PropertySection title={t('imageEditor.v3.layerType.smart')}>
              <FormSection><SmartContentPropertiesV3 layer={selected} disabled={contentLocked} /></FormSection>
            </PropertySection>
          ) : null}

          {!editingMask && (selected.type === 'effect' || selected.type === 'adjustment') ? (
            <PropertySection title={t(`imageEditor.v3.layerType.${selected.type}`)}>
              <FormSection>
                {!selected.renderable ? (
                  <p className="text-xs text-warning-text">{t('imageEditor.v3.properties.unrenderable')}</p>
                ) : null}
                {effectReadiness?.state !== 'ready' && effectReadinessReason ? (
                  <p role="status" className="text-xs text-warning-text">{effectReadinessReason}</p>
                ) : null}
                <ImageEditorEffectParametersV3
                  controller={controller}
                  layer={selected}
                  disabled={contentLocked || !selected.renderable}
                />
              </FormSection>
            </PropertySection>
          ) : null}

          {!editingMask && isImageEditVectorLayerV3(selected) ? (
            <PropertySection title={t(`imageEditor.v3.layerType.${selected.type}`)}>
              <FormSection>
                <VectorProperties controller={controller} layer={selected} locked={contentLocked} />
              </FormSection>
            </PropertySection>
          ) : null}

          {maskEnabled && selected.mask ? (
            <PropertySection title={t('imageEditor.v3.properties.mask')}>
              <UiFormRow label={t('imageEditor.v3.properties.maskEditTarget')}>
                <UiSegmented size="sm" ariaLabel={t('surfaceGrammar.editTarget')} value={editTarget}
                  options={[{ value: 'pixels', label: t('imageEditor.v3.properties.maskTargetContent') }, { value: 'mask', label: t('imageEditor.v3.workflow.mask') }]}
                  onChange={target => selectImageEditTargetV3(controller, selected.id, target)} />
              </UiFormRow>
              <ImageEditorLayerScalarsV3 controller={controller} layer={selected} disabled={contentLocked} mask />
              <UiFormRow label={t('imageEditor.v3.properties.maskEnabledShort')}>
                <UiSwitch aria-label={t('imageEditor.v3.workflow.maskEnabled')} checked={selected.maskAttachment.enabled} disabled={contentLocked} onCheckedChange={enabled => controller.updateLayerCommon(selected.id, { maskAttachment: { ...selected.maskAttachment, enabled } })} />
              </UiFormRow>
              <UiFormRow label={t('imageEditor.v3.properties.maskLinkedShort')}>
                <UiSwitch aria-label={t('imageEditor.v3.workflow.maskLinked')} checked={selected.maskAttachment.linked} disabled={contentLocked} onCheckedChange={linked => controller.updateLayerCommon(selected.id, { maskAttachment: { ...selected.maskAttachment, linked } })} />
              </UiFormRow>
              <UiFormRow label={t('imageEditor.v3.properties.maskInvertedShort')}>
                <UiSwitch
                  aria-label={t('imageEditor.v3.properties.maskInverted')}
                  checked={selected.mask.inverted}
                  disabled={contentLocked}
                  onCheckedChange={(inverted) => {
                    if (contentLocked || !selected.mask) return
                    const mask = cloneImageEditMaskReferenceV3(selected.mask)
                    mask.inverted = inverted
                    controller.setLayerMask(selected.id, mask)
                  }}
                />
              </UiFormRow>
              {editingMask ? <MaskTransformProperties layer={selected} disabled={contentLocked} controller={controller} /> : null}
              {editingMask && selected.mask.kind === 'sparse-mask' && selected.mask.vectorPaths ? (
                <FormSection>
                  <VectorProperties controller={controller} locked={contentLocked} maskOnly layer={{ ...selected, type: 'path', content: { operands: selected.mask.vectorPaths, paint: { fill: defaultTextStyle(controller.document.geometry.height).fill, strokes: [], shadows: [] } } }} onContentChange={content => { if (selected.mask?.kind !== 'sparse-mask') return; controller.setLayerMask(selected.id, { ...selected.mask, vectorPaths: vectorPathContentSchema.parse(content).operands }) }} />
                </FormSection>
              ) : null}
            </PropertySection>
          ) : null}
        </UiFieldLayoutContext.Provider>
        </UiPropertyKeyframesContext.Provider>
      </div>

      {tools.length ? <UiToolbar variant="footer" tools={tools} /> : null}
    </section>
  )
}
