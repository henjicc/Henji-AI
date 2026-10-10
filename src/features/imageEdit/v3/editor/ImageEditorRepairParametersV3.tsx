import { useTranslation } from 'react-i18next'
import { UiButton, UiError, UiOptionButton, UiRangeInput, UI_SEGMENTED_TRACK_CLASS } from '@/components/ui'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { useLocalModels, formatLocalModelSize } from '@/components/Settings/hooks/useLocalModels'
import type { ImageEditCommandBusV3 } from '../application/imageEditCommandBus'
import { useImageEditorSessionStoreV3 } from '../store'
import { useImageEditorRepairV3 } from './ImageEditorRepairContextV3'
import type { ImageEditorV3Controller } from './types'

export function ImageEditorRepairParametersV3({ bus, controller }: { bus: ImageEditCommandBusV3; controller: ImageEditorV3Controller }): JSX.Element | null {
  const { t } = useTranslation('ui'), view = useImageEditorRepairV3(), models = useLocalModels()
  const { t: modelText } = useTranslation('settings')
  const session = useImageEditorSessionStoreV3(s => s.sessions[controller.sessionId])
  if (!view || !session) return null
  const removing = session.activeTool === 'remove'
  const texture = session.activeTool === 'content-aware-fill'
  const repairModels = models.models.filter(value => ['image_inpainting_lama', 'image_inpainting_migan'].includes(value.id))
  const model = view.quality === 'auto' ? repairModels.find(value => value.status === 'downloading') ?? repairModels.find(value => !!value.lastFailure && value.lastFailure !== 'cancelled') : repairModels.find(value => value.id === (view.quality === 'fine' ? 'image_inpainting_lama' : 'image_inpainting_migan'))
  const percent = model?.progress ? Math.floor(model.progress.receivedBytes / Math.max(1, model.progress.totalBytes) * 100) : 0
  return <div className="flex min-w-max shrink-0 items-center gap-3 whitespace-nowrap" data-repair-parameters>
    {texture ? <>
      <UiButton size="sm" disabled={!bus.getSnapshot().selection || view.busy} onClick={() => void view.run({ action: 'remove', method: 'texture' })}>{t('imageEditor.v3.retouch.previewFill')}</UiButton>
    </> : removing ? <>
      <label className="flex items-center gap-2 text-xs text-text2">{t('imageEditor.v3.toolSettings.size')}
        <UiRangeInput aria-label={t('imageEditor.v3.toolSettings.size')} min={1} max={Math.min(controller.document.geometry.width, controller.document.geometry.height)} step={1} value={session.toolSettings.brushSize}
          disabled={view.busy} onChange={event => useImageEditorSessionStoreV3.getState().setToolSetting(controller.sessionId, 'brushSize', Number(event.currentTarget.value))} />
      </label>
      <div className={UI_SEGMENTED_TRACK_CLASS} role="group" aria-label={t('imageEditor.v3.repair.quality')}>
        {(['auto', 'fast', 'fine'] as const).map(quality => <UiOptionButton key={quality} variant="segment" active={view.quality === quality} disabled={view.busy} onClick={() => view.setQuality(quality)}>{t(`imageEditor.v3.repair.${quality}`)}</UiOptionButton>)}
      </div>
      <UiButton size="sm" disabled={!bus.getSnapshot().selection || view.busy} onClick={() => void view.run({ action: 'remove' })}>{t('imageEditor.v3.repair.remove-selection')}</UiButton>
      {model && model.status !== 'ready' ? <>
        <span className="text-xs text-text3">{t('imageEditor.v3.repair.download-hint', { size: formatLocalModelSize(model.sizeBytes) })}</span>
        {model.status === 'downloading' ? <><ProgressBar appearance="hairline" progress={percent} /><UiButton size="sm" onClick={() => models.cancel(model.id)}>{t('imageEditor.v3.repair.cancel-download')}</UiButton></> : <UiButton size="sm" onClick={() => models.download(model.id)}>{t('imageEditor.v3.repair.download')}</UiButton>}
      </> : null}
      {models.loadFailed ? <UiError size="xs" message={modelText('sections.localModels.loadFailed')} onRetry={models.reload} /> : null}
      {model?.lastFailure && model.lastFailure !== 'cancelled' && model.status !== 'downloading' ? <UiError size="xs" message={modelText(`sections.localModels.failure.${model.lastFailure}`)} /> : null}
    </> : <span className="text-xs text-text2">{t('imageEditor.v3.repair.drag-source')}</span>}
    {view.previewReady && <UiButton size="sm" variant="primary" onClick={view.apply}>{t('imageEditor.v3.retouch.apply')}</UiButton>}
    {view.busy ? <>{view.progress && <span role="status" className="text-xs text-text2">{t(`imageEditor.v3.repair.${view.progress.stage}`, { percent: view.progress.percent })}</span>}<UiButton size="sm" onClick={view.cancel}>{t('imageEditor.v3.selection.cancel-task')}</UiButton></> : null}
    {view.error ? <UiError size="xs" message={view.error} /> : null}
  </div>
}
