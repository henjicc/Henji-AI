import { UiSegmented } from '@/components/ui'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { UiIconButton } from '@/components/ui'
import { Magnet } from 'lucide-react'
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
        // 工具条里的开关用图标开关（开着图标染强调色），与剪辑时间线的“吸附”同一写法（重要记录 019 / 020）
        <UiIconButton
          on={session.toolSettings.snappingEnabled}
          aria-pressed={session.toolSettings.snappingEnabled}
          aria-label={t('imageEditor.v3.toolSettings.snapping')}
          tooltip={t('imageEditor.v3.toolSettings.snapping')}
          onClick={() => setToolSetting(controller.sessionId, 'snappingEnabled', !session.toolSettings.snappingEnabled)}
        ><Magnet /></UiIconButton>
      ) : null}
      {selectionLike ? (
        <UiSegmented ariaLabel={t('imageEditor.v3.selection.combineMode')} value={session.toolSettings.selectionCombineMode} onChange={mode => setToolSetting(controller.sessionId, 'selectionCombineMode', mode)} options={(['replace', 'add', 'subtract', 'intersect'] as const).map(value => ({ value, label: t(`imageEditor.v3.selection.${value}`), disabled: !allowedSelectionModes.includes(value), title: !allowedSelectionModes.includes(value) ? t('imageEditor.v3.selection.replaceOnly') : undefined }))} />
      ) : null}
    </div>
  )
}
