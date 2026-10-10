import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { UI_SEGMENTED_TRACK_CLASS, UiOptionButton, UiSwitch } from '@/components/ui'
import type { ImageEditCommandBusV3 } from '../../application/imageEditCommandBus'
import { useImageEditorSessionStoreV3 } from '../../store'
import { findImageEditLayerLocationV3 } from '../../editor/layerTreeV3'
import { imageEditorSelectionAllowedCombineModesV3 } from '../../editor/selectionMaskLayerV3'
import type { ImageEditorV3Controller } from '../../editor/types'

const EMPTY_LAYER_IDS: readonly string[] = []

export function LegacyToolOptions({
  controller,
  bus: _bus,
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
    if (controller.profile.id !== 'mask' || !session || !selectionLike
      || allowedSelectionModes.includes(session.toolSettings.selectionCombineMode)) return
    setToolSetting(controller.sessionId, 'selectionCombineMode', 'replace')
  }, [allowedSelectionModes, controller.profile.id, controller.sessionId, selectionLike, session, setToolSetting])

  if (!session) return null
  const moveLike = session.activeTool === 'move'
  if (!moveLike && !selectionLike) return null

  return (
    <div data-tool-parameters className="flex h-full min-w-max items-center gap-4">
      {moveLike ? (
        <label className="flex shrink-0 items-center gap-2 text-xs text-text2">
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
      {selectionLike ? (
        <div
          role="group"
          aria-label={t('imageEditor.v3.selection.combineMode')}
          className={`shrink-0 ${UI_SEGMENTED_TRACK_CLASS}`}
        >
          {(['replace', 'add', 'subtract', 'intersect'] as const).map((mode) => {
            const disabled = !allowedSelectionModes.includes(mode)
            return (
              <UiOptionButton
                key={mode}
                variant="segment"
                active={session.toolSettings.selectionCombineMode === mode}
                aria-pressed={session.toolSettings.selectionCombineMode === mode}
                disabled={disabled}
                title={disabled ? t('imageEditor.v3.selection.replaceOnly') : undefined}
                onClick={() => setToolSetting(controller.sessionId, 'selectionCombineMode', mode)}
              >
                {t(`imageEditor.v3.selection.${mode}`)}
              </UiOptionButton>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
