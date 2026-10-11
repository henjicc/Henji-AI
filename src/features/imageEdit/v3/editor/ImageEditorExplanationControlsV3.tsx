import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Mic, Pause, Play, Square } from 'lucide-react'
import { Virtuoso } from 'react-virtuoso'
import { PanelTrigger, UiButton, UiError, UiGroup, UiIconButton, UiLoading, UiModal, UiTextToken } from '@/components/ui'
import { UI_TEXT_META_CLASS } from '@/components/ui/styleTokens'
import { ExplanationReview } from '@/features/creativeIntent'
import type { TranscriptEntry } from '@/core/creativeIntent/schema'
import type { ExplanationBinding } from '@/core/creativeIntent/deixis'
import { imageEditExplanation } from '../application/imageEditExplanation'
import type { ImageEditCommandBusV3 } from '../application/imageEditCommandBus'
import type { ImageEditorV3Controller } from './types'

export function ImageEditorExplanationControlsV3({ bus, controller }: { bus: ImageEditCommandBusV3; controller: ImageEditorV3Controller }): JSX.Element {
  const adapter = useMemo(() => imageEditExplanation(bus), [bus])
  const state = useSyncExternalStore(adapter.subscribe, adapter.snapshot)
  const [open, setOpen] = useState(false), [consent, setConsent] = useState(false), [upload, setUpload] = useState(false)
  const [error, setError] = useState<string>(), [entries, setEntries] = useState<TranscriptEntry[]>([]), [selected, setSelected] = useState<TranscriptEntry>(), [page, setPage] = useState(0)
  const onError = useCallback((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)), [])
  const run = (work: () => Promise<void>): void => { setError(undefined); void work().catch(onError) }
  const onRead = useCallback((entry: TranscriptEntry) => adapter.readReview(entry), [adapter])
  const onBind = useCallback((entry: TranscriptEntry, binding: ExplanationBinding) => adapter.bind(entry, binding), [adapter])
  const stage = state.session?.state, active = stage === 'recording' || stage === 'paused'
  useEffect(() => {
    let current = true
    if (open && stage === 'reviewing') void adapter.transcript(page).then(value => { if (current) setEntries(value) }).catch(onError)
    else if (!state.session || active) { setEntries([]); setSelected(undefined) }
    return () => { current = false }
  }, [adapter, open, stage, state.generation, state.session, active, page, onError])
  return <>
    <PanelTrigger open={open} onOpenChange={setOpen} alignment="bottomRight" surface="glass" panelPadding="content" panelWidth="content"
      renderPanel={() => <div className="flex w-80 max-w-full min-w-0 flex-col gap-3 overflow-y-auto" data-image-explanation-controls data-observation-sensitive>
        <UiGroup title="图片讲解" titleTone="compact">
          {!active && <UiButton disabled={state.busy} onClick={() => setConsent(true)}>开始录制讲解</UiButton>}
          {stage === 'recording' && <UiButton disabled={state.busy} onClick={() => run(() => adapter.pause())}><Pause size={14} />暂停录制</UiButton>}
          {stage === 'paused' && <UiButton disabled={state.busy} onClick={() => run(() => adapter.resume())}><Play size={14} />继续录制</UiButton>}
          {active && <UiButton disabled={state.busy} onClick={() => run(() => adapter.stop())}><Square size={14} />结束录制</UiButton>}
          {(stage === 'reviewing' || stage === 'recoverable') && !entries.length && state.session?.retentionStatus !== 'deleted' && <UiButton disabled={state.busy} onClick={() => setUpload(true)}>转写并审阅</UiButton>}
          {!active && !state.session && !!controller.document.creativeIntents?.sessions.length && <div className="h-24"><Virtuoso data={controller.document.creativeIntents.sessions.filter(s => s.mode === 'static')} itemContent={(index, saved) => <UiButton onClick={() => run(() => adapter.reopen(saved.id))}>查看第 {index + 1} 次讲解</UiButton>} /></div>}
          {state.busy && <UiLoading size="xs" message="正在处理讲解" />}
          {state.message && <p role="status" className={UI_TEXT_META_CLASS}>{state.message}</p>}
          {(error || state.message?.includes('未保存')) && <UiError title="讲解尚未完成" message={error ?? state.message} actions={<UiButton onClick={() => run(() => adapter.save())}>重试保存</UiButton>} />}
        </UiGroup>
        {!!entries.length && <>
          <UiGroup title="转写审阅" titleTone="compact"><div className="h-24"><Virtuoso data={entries} itemContent={(_index, entry) => <UiTextToken appearance="chip" aria-label={`查看词稿「${entry.text}」`} onClick={() => setSelected(entry)}>{entry.text}</UiTextToken>} /></div></UiGroup>
          <div className="flex gap-2"><UiButton disabled={!page} onClick={() => { setSelected(undefined); setPage(p => p - 1) }}>上一页</UiButton><UiButton disabled={entries.length < 256} onClick={() => { setSelected(undefined); setPage(p => p + 1) }}>下一页</UiButton></div>
          {selected && <><ExplanationReview entry={selected} onRead={onRead} onBind={onBind} onError={onError} initiallyOpen showTrigger={false} contextKey={String(controller.document.revision)} />
            <p className={UI_TEXT_META_CLASS}>录制时指向：{adapter.historicalRefs(selected).map(ref => ref.label ?? '图层').join('、') || '图片区域'}</p>
            <UiButton disabled={state.busy} onClick={() => run(async () => { await adapter.organize(selected); setOpen(false) })}>生成布局候选</UiButton></>}
        </>}
      </div>}>
      {controls => <UiButton size="sm" aria-label="录制讲解" onClick={controls.togglePanel} aria-expanded={controls.open}><Mic size={14} />讲解</UiButton>}
    </PanelTrigger>
    {active && <><span role="status" className={`shrink-0 ${UI_TEXT_META_CLASS}`}>{stage === 'paused' ? '已暂停' : `录制 ${Math.floor(state.elapsedUs / 1e6)} 秒`}</span><UiIconButton aria-label="结束图片讲解" disabled={state.busy} onClick={() => run(() => { setOpen(true); return adapter.stop() })}><Square size={14} /></UiIconButton></>}
    <UiModal isOpen={consent} title="开始录制图片讲解" onClose={() => setConsent(false)} footer={<UiButton variant="primary" onClick={() => { setConsent(false); setPage(0); setSelected(undefined); run(() => adapter.start(crypto.randomUUID())) }}>同意并开始录制</UiButton>}>
      <p className="text-13 text-text2">记录麦克风和本图片内的指向，并保存指向时的作品画面。图片不使用时间轴；你可以边说边选择图层或指向区域。</p>
      <p className="mt-3 text-13 text-text2">录音先保存在本机，不录系统声音、摄像头或其他窗口。转写前单独确认音频上传和费用。原音不长期保留，关闭图片后释放；词稿和指向保存在图片文档中。</p>
    </UiModal>
    <UiModal isOpen={upload} title="确认转写图片讲解" onClose={() => setUpload(false)} footer={<UiButton variant="primary" onClick={() => { setUpload(false); run(() => adapter.transcribe(crypto.randomUUID())) }}>确认上传音频并转写</UiButton>}>
      <p className="text-13 text-text2">将录音发送给设置中的默认转写模型，供应商可能收费。只转写这次讲解，不发送给意图模型；布局候选在本机生成。</p>
    </UiModal>
  </>
}
