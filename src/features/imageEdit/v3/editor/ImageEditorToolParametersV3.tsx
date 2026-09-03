import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { UiChipButton, UiRangeInput, UiSwitch } from '@/components/ui'
import type { ImageEditCommandBusV3 } from '../application/imageEditCommandBus'
import { useImageEditorSessionStoreV3 } from '../store'
import { ImageEditorAnnotationParametersV3 } from './ImageEditorAnnotationParametersV3'
import { ImageEditorCropParametersV3 } from './ImageEditorCropParametersV3'
import { findImageEditLayerLocationV3 } from './layerTreeV3'
import { imageEditorSelectionAllowedCombineModesV3 } from './selectionMaskLayerV3'
import type { ImageEditorV3Controller } from './types'

const EMPTY_LAYER_IDS: readonly string[] = []

export function ImageEditorToolParametersV3({
  controller,
  bus,
}: {
  controller: ImageEditorV3Controller
  bus: ImageEditCommandBusV3
}): JSX.Element | null {
  const { t } = useTranslation('ui')
  const session = useImageEditorSessionStoreV3((state) => state.sessions[controller.sessionId])
  const setToolSetting = useImageEditorSessionStoreV3((state) => state.setToolSetting)
  const selectedLayerIds = useImageEditorSessionStoreV3(
    (state) => state.sessions[controller.sessionId]?.selectedLayerIds ?? EMPTY_LAYER_IDS,
  )
  const selectedLayer = selectedLayerIds.length === 1
    ? findImageEditLayerLocationV3(controller.document.layers, selectedLayerIds[0])?.layer ?? null
    : null
  const allowedSelectionModes = imageEditorSelectionAllowedCombineModesV3(selectedLayer)
  const selectionLike = session?.activeTool.startsWith('select-') ?? false

  useEffect(() => {
    if (!session || !selectionLike
      || allowedSelectionModes.includes(session.toolSettings.selectionCombineMode)) return
    setToolSetting(controller.sessionId, 'selectionCombineMode', 'replace')
  }, [allowedSelectionModes, controller.sessionId, selectionLike, session, setToolSetting])

  if (!session) return null
  if (session.activeTool === 'crop') {
    return <ImageEditorCropParametersV3 controller={controller} bus={bus} />
  }

  const brushLike = ['raster-brush', 'eraser', 'mask-edit'].includes(session.activeTool)
  const moveLike = session.activeTool === 'move'
  const annotationLike = session.activeTool.startsWith('annotation-') || moveLike
  if (!moveLike && !brushLike && !annotationLike && !selectionLike) return null

  return (
    <div data-tool-parameters className="flex h-full min-w-max items-center gap-4">
      {moveLike ? (
        <label className="flex shrink-0 items-center gap-2 text-xs text-text-muted">
          <span>{t('imageEditor.v3.toolSettings.snapping')}</span>
          <UiSwitch
            aria-label={t('imageEditor.v3.toolSettings.snapping')}
            checked={session.toolSettings.snappingEnabled}
            onCheckedChange={(enabled) => setToolSetting(
              controller.sessionId,
              'snappingEnabled',
              enabled,
            )}
          />
        </label>
      ) : null}
      {brushLike ? (
        <>
          {session.activeTool === 'mask-edit' ? (
            <div
              role="group"
              aria-label={t('imageEditor.v3.toolSettings.maskMode')}
              className="flex shrink-0 items-center gap-1"
            >
              {(['paint', 'erase'] as const).map((mode) => (
                <UiChipButton
                  key={mode}
                  className="!h-8 !px-2 !text-xs"
                  selectionRole="navigation"
                  active={session.toolSettings.maskMode === mode}
                  onClick={() => setToolSetting(controller.sessionId, 'maskMode', mode)}
                >
                  {t(`imageEditor.v3.toolSettings.mask${mode === 'paint' ? 'Paint' : 'Erase'}`)}
                </UiChipButton>
              ))}
            </div>
          ) : null}
          {([
            ['size', 1, 512, 1, session.toolSettings.brushSize],
            ['opacity', 0, 1, 0.01, session.toolSettings.brushOpacity],
            ['hardness', 0, 1, 0.01, session.toolSettings.brushHardness],
          ] as const).map(([key, min, max, step, value]) => (
            <label key={key} className="flex shrink-0 items-center gap-2 text-xs text-text-muted">
              <span>{t(`imageEditor.v3.toolSettings.${key}`)}</span>
              <UiRangeInput
                className="!w-24"
                aria-label={t(`imageEditor.v3.toolSettings.${key}`)}
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(event) => setToolSetting(
                  controller.sessionId,
                  key === 'size'
                    ? 'brushSize'
                    : key === 'opacity' ? 'brushOpacity' : 'brushHardness',
                  Number(event.currentTarget.value),
                )}
              />
              <span className="w-9 text-right tabular-nums text-text-dark">
                {key === 'size' ? Math.round(value) : `${Math.round(value * 100)}%`}
              </span>
            </label>
          ))}
        </>
      ) : null}
      {annotationLike ? <ImageEditorAnnotationParametersV3 controller={controller} /> : null}
      {selectionLike ? (
        <div
          role="group"
          aria-label={t('imageEditor.v3.selection.combineMode')}
          className="flex shrink-0 items-center gap-1"
        >
          {(['replace', 'add', 'subtract', 'intersect'] as const).map((mode) => {
            const disabled = !allowedSelectionModes.includes(mode)
            return (
              <UiChipButton
                key={mode}
                className="!h-8 !px-2 !text-xs"
                selectionRole="navigation"
                active={session.toolSettings.selectionCombineMode === mode}
                disabled={disabled}
                title={disabled ? t('imageEditor.v3.selection.replaceOnly') : undefined}
                onClick={() => setToolSetting(controller.sessionId, 'selectionCombineMode', mode)}
              >
                {t(`imageEditor.v3.selection.${mode}`)}
              </UiChipButton>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
