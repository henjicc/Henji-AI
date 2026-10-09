import { ImageEditorSubjectParametersV3 } from './ImageEditorSubjectParametersV3'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { UiButton, UiError, UiRangeInput, UiOptionButton, UI_SEGMENTED_TRACK_CLASS } from '@/components/ui'
import type { ImageEditCommandBusV3 } from '../application/imageEditCommandBus'
import { applyImageEditSelectionV3 } from '../application/imageEditSelectionServiceV3'
import { useImageEditorSessionStoreV3 } from '../store'
import type { ImageEditorV3Controller } from './types'

export function ImageEditorSelectionParametersV3({ bus, controller }: { bus: ImageEditCommandBusV3; controller: ImageEditorV3Controller }): JSX.Element {
  const { t } = useTranslation('ui')
  const session = useImageEditorSessionStoreV3(s => s.sessions[controller.sessionId])
  const selection = bus.getSnapshot().selection
  const [feather, setFeather] = useState(selection?.feather ?? 0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const abort = useRef<AbortController | null>(null)
  useEffect(() => { setFeather(selection?.feather ?? 0) }, [selection])
  useEffect(() => () => abort.current?.abort(), [])
  const commitFeather = () => { const now = bus.getSnapshot().selection; if (now) bus.setSelection({ ...now, feather }) }
  const apply = async (mode: 'mask' | 'copy' | 'delete') => {
    if (abort.current) return
    if (session?.selectedLayerIds.length !== 1) { setError(t('imageEditor.v3.selection.select-one')); return }
    const task = new AbortController(); abort.current = task; setBusy(true); setProgress(0); setError(null)
    try {
      const result = await applyImageEditSelectionV3(bus, session.selectedLayerIds[0], mode, task.signal, (done, total) => setProgress(Math.floor(done / total * 100)))
      useImageEditorSessionStoreV3.getState().setSelectedLayerIds(controller.sessionId, [result.layerId])
    } catch (cause) { if (!task.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { abort.current = null; setBusy(false) }
  }
  return <div className="flex min-w-max shrink-0 items-center gap-3 whitespace-nowrap" data-selection-parameters>
    {session?.activeTool.startsWith('select-subject') ? <ImageEditorSubjectParametersV3 /> : null}
    <div role="group" aria-label={t('imageEditor.v3.selection.combineMode')} className={UI_SEGMENTED_TRACK_CLASS}>
      {(['replace', 'add', 'subtract', 'intersect'] as const).map(mode => <UiOptionButton key={mode} variant="segment" active={session?.toolSettings.selectionCombineMode === mode}
        onClick={() => useImageEditorSessionStoreV3.getState().setToolSetting(controller.sessionId, 'selectionCombineMode', mode)}>{t(`imageEditor.v3.selection.${mode}`)}</UiOptionButton>)}
    </div>
    {session?.activeTool === 'select-brush' ? <label className="flex items-center gap-2 text-xs text-text2">{t('imageEditor.v3.toolSettings.size')}
      <UiRangeInput min={1} max={Math.min(controller.document.geometry.width, controller.document.geometry.height)} step={1} value={session.toolSettings.brushSize}
        onChange={e => useImageEditorSessionStoreV3.getState().setToolSetting(controller.sessionId, 'brushSize', Number(e.currentTarget.value))} />
    </label> : null}
    <label className="flex items-center gap-2 text-xs text-text2">{t('imageEditor.v3.selection.feather')}
      <UiRangeInput aria-label={t('imageEditor.v3.selection.feather')} min={0} max={0.1} step={0.001} value={feather} disabled={!selection || busy}
        onChange={e => setFeather(Number(e.currentTarget.value))} onPointerUp={commitFeather} onKeyUp={commitFeather} onBlur={commitFeather} />
      <span className="tabular-nums">{(feather * 100).toFixed(1)}%</span>
    </label>
    <UiButton size="sm" disabled={!selection || busy} onClick={() => selection && bus.setSelection({ ...selection, inverted: !selection.inverted })}>{t('imageEditor.v3.selection.invert')}</UiButton>
    <UiButton size="sm" disabled={!selection || busy} onClick={() => bus.setSelection(null)}>{t('imageEditor.v3.selection.clear')}</UiButton>
    {(['mask', 'copy', 'delete'] as const).map(mode => <UiButton key={mode} size="sm" disabled={!selection || busy} onClick={() => void apply(mode)}>{t(`imageEditor.v3.selection.apply-${mode}`)}</UiButton>)}
    {busy ? <><span className="text-xs text-text2" role="status">{t('imageEditor.v3.selection.progress', { percent: progress })}</span><UiButton size="sm" onClick={() => abort.current?.abort()}>{t('imageEditor.v3.selection.cancel-task')}</UiButton></> : null}
    {session?.activeTool === 'select-polygon' ? <span className="text-xs text-text3">{t('imageEditor.v3.selection.polygon-hint')}</span> : null}
    {error ? <UiError size="xs" message={error} /> : null}
  </div>
}
