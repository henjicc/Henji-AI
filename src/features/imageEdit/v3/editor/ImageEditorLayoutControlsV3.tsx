import { useTranslation } from 'react-i18next'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Dropdown, PanelTrigger, UiButton, UiEmpty, UiError, UiFormRow, UiGroup, UiLoading, UiSegmented, UiRangeInput } from '@/components/ui'
import { LayoutGrid, Pin, PinOff } from 'lucide-react'
import { Virtuoso } from 'react-virtuoso'
import { imageEditLayoutDraft } from '../application/imageEditLayoutDraft'
import type { ImageEditCommandBusV3 } from '../application/imageEditCommandBus'
import { useImageEditorSessionStoreV3 } from '../store'
import type { ImageEditorV3Controller } from './types'
import { findImageEditLayerLocationV3 } from './layerTreeV3'

const EMPTY: string[] = []
const CANDIDATE_LABELS: Readonly<Record<string, string>> = { align: '边缘对齐', distribute: '等距排列', hero: '保留主图' }

/** Both writable hosts compose the same primitives over the document-owned layout adapter. */
export function ImageEditorLayoutControlsV3({ bus, controller, openRequest = 0 }: { bus: ImageEditCommandBusV3; controller: ImageEditorV3Controller; openRequest?: number }): JSX.Element | null {
  const { t: surfaceText } = useTranslation('ui')
  const adapter = useMemo(() => imageEditLayoutDraft(bus), [bus])
  const state = useSyncExternalStore(adapter.subscribe, adapter.snapshot)
  const selected = useImageEditorSessionStoreV3(s => s.sessions[controller.sessionId]?.selectedLayerIds ?? EMPTY)
  const [error, setError] = useState<string>()
  const [open, setOpen] = useState(false)
  useEffect(() => { if (openRequest) setOpen(true) }, [openRequest])
  const [running, setRunning] = useState(false)
  const inFlight = useRef(false)
  const [fidelity, setFidelity] = useState<number | null>(null)
  const pendingFidelity = useRef<number | null>(null)
  const writable = controller.profile.id === 'full' || controller.profile.id === 'canvas-edit'
  const run = (work: () => void | Promise<void>): void => {
    if (inFlight.current) return
    inFlight.current = true
    setError(undefined)
    setRunning(true)
    void Promise.resolve().then(work).catch(reason => {
      if (!(reason instanceof Error && reason.name === 'AbortError')) setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => { inFlight.current = false; setRunning(false) })
  }
  const preview = (id: string): void => {
    setError(undefined)
    try { adapter.preview(id) } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }
  const draftId = controller.document.creativeIntents?.drafts.filter(d => d.mode === 'static').at(-1)?.id
  useEffect(() => { if (open && !state.draft && draftId) run(() => adapter.reopen(draftId)) }, [adapter, draftId, open, state.draft])
  useEffect(() => { setError(undefined) }, [state.revision])
  const resetFidelity = (): void => { pendingFidelity.current = null; setFidelity(null) }
  const finishFidelity = (commit: boolean): void => {
    const value = pendingFidelity.current
    resetFidelity()
    if (commit && value !== null && value !== state.draft?.fidelity) run(() => adapter.configure({ fidelity: value }))
  }
  const busy = running || state.status === 'optimizing'
  const canOrganize = selected.length >= 3 || Boolean(state.draft && state.entries.length >= 3)
  const movement = state.candidates.some(candidate => candidate.id === 'move')
  const canApply = state.candidates.some(candidate => candidate.id === state.selected)
  const options = [{ value: 'original', label: surfaceText('surfaceGrammar.layoutOriginal') }, ...state.candidates.map(candidate => ({ value: candidate.id, label: CANDIDATE_LABELS[candidate.id] ? surfaceText(`surfaceGrammar.layoutCandidates.${candidate.id}`) : candidate.label }))]
  const pins = state.draft?.pins.map(pin => {
    const entry = state.entries.find(item => item.sample.sampleId === pin.sampleId)
    const layer = entry && findImageEditLayerLocationV3(controller.document.layers, entry.layerId)?.layer
    return { id: pin.id, label: layer?.name || '原稿位置' }
  }) ?? []
  const failure = error ?? (state.messageTone !== 'status' ? state.message : undefined)
  const retained = Math.round((fidelity ?? state.draft?.fidelity ?? 0) * 100)
  if (!writable) return null
  return <PanelTrigger open={open} onOpenChange={value => {
    setOpen(value)
    resetFidelity()
    setError(undefined)
    if (!value) adapter.cancel()
  }} alignment="bottomRight" surface="glass" panelPadding="content" panelWidth="content"
    renderPanel={() => <UiGroup labelWidth={96} gap="stack" className="w-96 max-w-full min-w-0" data-image-layout-controls>
      {state.candidates.length > 0 && <UiFormRow label={surfaceText('surfaceGrammar.layoutPlan')} density="compact">
        {options.length <= 5 && options.every(option => option.label.length <= 4)
          ? <UiSegmented ariaLabel={surfaceText('surfaceGrammar.layoutPlan')} size="sm" value={state.selected ?? 'original'} options={options} disabled={busy || state.needsSave} onChange={preview} />
          : <Dropdown ariaLabel={surfaceText('surfaceGrammar.layoutPlan')} size="sm" value={state.selected ?? 'original'} options={options} disabled={busy || state.needsSave} onSelect={preview} />}
      </UiFormRow>}
      {state.draft && !movement && <>
        <UiGroup title="保留原稿位置" titleTone="compact">
          <div className="flex items-center justify-between text-xs text-text2"><span>完全整理</span><span className="tabular-nums">{retained}%</span><span>保持原位</span></div>
          <UiFormRow label={surfaceText('surfaceGrammar.retainPosition')} density="compact" labelColumn="panel"><UiRangeInput aria-label="保留原稿位置" aria-valuetext={retained === 0 ? '完全整理' : retained === 100 ? '保持原位' : `保留原稿位置 ${retained}%`}
            min={0} max={1} step={.01} value={fidelity ?? state.draft.fidelity} disabled={busy || state.needsSave}
            onChange={event => { pendingFidelity.current = Number(event.target.value); setFidelity(pendingFidelity.current) }}
            onPointerUp={() => finishFidelity(true)} onPointerCancel={() => finishFidelity(false)} onBlur={() => finishFidelity(true)}
            onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finishFidelity(false) } }}
            onKeyUp={event => { if (event.key.startsWith('Arrow') || ['Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) finishFidelity(true) }} /></UiFormRow>
        </UiGroup>
        <UiGroup title="固定位置" titleTone="compact">
          <UiButton size="sm" aria-label="钉住所选图层的原稿位置"
            disabled={busy || state.needsSave || !selected.some(id => state.entries.some(entry => entry.layerId === id))}
            onClick={() => run(() => adapter.configure({ pinIds: selected }))}><Pin  />钉住所选图层</UiButton>
          {pins.length > 0 && <div className="min-w-0" style={{ height: `calc(var(--size-control-sm) * ${Math.min(pins.length, 3)})` }}><Virtuoso data={pins} itemContent={(_, pin) =>
            <UiButton size="sm" className="w-full min-w-0 justify-start" disabled={busy || state.needsSave}
              aria-label={`解钉 · ${pin.label}`} title={`解钉 · ${pin.label}`} onClick={() => run(() => adapter.configure({ unpin: pin.id }))}>
              <PinOff  className="shrink-0" /><span className="truncate">解钉 · {pin.label}</span>
            </UiButton>} /></div>}
        </UiGroup>
      </>}
      {!canOrganize && !state.draft && !failure && <UiEmpty size="xs" title="至少选择三个独立图层" />}
      {failure ? <UiError title={state.needsSave ? '布局尚未保存' : '布局未完成'} message={failure} size="xs" align="start" />
        : state.message && <div role="status" className="text-xs text-text2">{state.message}</div>}
      {state.status === 'optimizing' && <UiLoading size="xs" message="正在整理布局…" />}
      {(state.status === 'optimizing' || (!busy && (canOrganize || canApply || state.needsSave))) && <div className="flex items-center justify-end gap-2">
        {state.status === 'optimizing' ? <UiButton size="sm" onClick={() => adapter.cancel()}>取消整理</UiButton>
          : <UiButton size="sm" disabled={busy || !canOrganize || state.needsSave} onClick={() => run(() => adapter.organize(selected.length >= 3 ? selected : []))}>整理</UiButton>}
        <UiButton size="sm" variant="primary" disabled={busy || (!state.needsSave && !canApply)}
          onClick={() => run(() => adapter.apply())}>{state.needsSave ? '重试保存' : '应用'}</UiButton>
      </div>}
    </UiGroup>}>
    {controls => <UiButton size="sm" onClick={controls.togglePanel} aria-expanded={controls.open}><LayoutGrid  />随手摆</UiButton>}
  </PanelTrigger>
}
