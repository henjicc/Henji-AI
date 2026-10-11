import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Mic, Pause, Play, Square, Trash2, X, ChevronLeft, ChevronRight } from 'lucide-react'
import { PanelTrigger, UiButton, UiIconButton, UiModal, UiTextArea, UiTextToken, UiError, UiEmpty, UiGroup } from '@/components/ui'
import { Virtuoso } from 'react-virtuoso'
import type { TranscriptEntry } from '@/core/creativeIntent/schema'
import type { ExplanationBinding } from '@/core/creativeIntent/deixis'
import { ExplanationReview } from '@/features/creativeIntent'
import { readVideoExplanationReview, correctVideoExplanationBinding } from '../application/videoEditExplanation'
import { UI_TEXT_BODY_CLASS, UI_TEXT_META_CLASS } from '@/components/ui/styleTokens'
import { modelDefaultsManager } from '@/features/settings'
import { getProviderDisplayName } from '@/utils/modelHelpers'
import { openSettingsPanel } from '@/stores/uiStore'
import { subscribeVideoEditDomain, subscribeVideoEditView, videoEditDomainRevision, videoEditViewRevision, type VideoEditInstance } from '../application/videoEditService'
import { startVideoExplanation, stopVideoExplanation, pauseVideoExplanation, resumeVideoExplanation, transcribeVideoExplanation, subscribeVideoExplanation, videoExplanationRevision, videoExplanationState, eraseVideoExplanation, reopenVideoExplanation, cancelVideoExplanationTranscription, readVideoExplanationPage, correctVideoExplanationText, videoExplanationJsonl, clearTemporaryVideoExplanationAudio, retainVideoExplanationAudio, readVideoExplanationAudio, retryVideoExplanationSave } from '../application/videoEditExplanation'

export function VideoEditExplanationControls({ owner, onError }: { owner: VideoEditInstance; onError: (error: unknown) => void }): React.ReactElement {
  useSyncExternalStore(subscribeVideoExplanation, videoExplanationRevision)
  const state = videoExplanationState(owner); const session = state?.collector.session
  const [consenting, setConsenting] = useState(false); const [deleting, setDeleting] = useState(false)
  const id = owner.document.id
  const run = (work: () => Promise<void>): void => { void work().catch(onError) }
  const recording = session?.state === 'recording'
  return <>
    <div className="flex shrink-0 items-center gap-1" role="group" aria-label="录制讲解控制">
      <PanelTrigger size="sm" appearance="quiet" display={recording ? '正在录制' : session?.state === 'paused' ? '录制已暂停' : '录制讲解'} alignment="aboveCenter" panelWidth="content" renderPanel={() => <UiGroup title="录制讲解">
        {state?.message && <UiError title="讲解需要处理" message={state.message} />}
        {state?.message && <UiButton disabled={state.busy} onClick={() => run(() => retryVideoExplanationSave(id))}>重试保存讲解</UiButton>}
        {!session || !['recording', 'paused', 'transcribing'].includes(session.state) ? <UiButton variant="primary" disabled={state?.busy || state?.erased} onClick={() => setConsenting(true)}><Mic size={14} />开始录制讲解</UiButton> : null}
        {session && session.retentionStatus !== 'deleted' && ['paused', 'recoverable'].includes(session.state) && <UiButton disabled={state?.busy || state?.erased} onClick={() => run(() => resumeVideoExplanation(id))}><Play size={14} />继续录制</UiButton>}
        {recording && <UiButton disabled={state?.busy} onClick={() => run(() => pauseVideoExplanation(id))}><Pause size={14} />暂停录制</UiButton>}
        {session && ['recording', 'paused', 'recoverable'].includes(session.state) && <UiButton disabled={state?.busy} onClick={() => run(() => stopVideoExplanation(id))}><Square size={14} />结束录制</UiButton>}
        {session?.state === 'transcribing' && <UiButton onClick={() => run(() => cancelVideoExplanationTranscription(id))}>取消转写</UiButton>}
        {!!owner.document.creativeIntents?.sessions.length && <Virtuoso className="h-40 w-56" data={owner.document.creativeIntents.sessions} itemContent={(i, saved) => <UiButton disabled={recording || state?.busy} onClick={() => run(() => reopenVideoExplanation(id, saved.id))}>查看第 {i + 1} 次讲解</UiButton>} />}
        {session && <UiButton variant="danger" onClick={() => setDeleting(true)}><Trash2 size={14} />彻底删除本次讲解</UiButton>}
      </UiGroup>} />
      {recording && <><span role="status" className={UI_TEXT_META_CLASS}><Mic size={14} className="inline" />{Math.floor((state?.elapsedUs ?? 0) / 1_000_000)} 秒</span><UiIconButton aria-label="暂停录制讲解" disabled={state?.busy} onClick={() => run(() => pauseVideoExplanation(id))}><Pause size={14} /></UiIconButton><UiIconButton aria-label="结束录制讲解" disabled={state?.busy} onClick={() => run(() => stopVideoExplanation(id))}><Square size={14} /></UiIconButton></>}
    </div>
    <UiModal isOpen={consenting} title="开始录制讲解" onClose={() => setConsenting(false)} footer={<UiButton variant="primary" onClick={() => { setConsenting(false); run(() => startVideoExplanation(id, crypto.randomUUID())) }}>同意并开始录制</UiButton>}>
      <p className={UI_TEXT_BODY_CLASS}>记录麦克风、本应用内指向、操作和时间位置；指向作品时保存那一刻的作品画面。你可以自由拖时间指针，或自行播放、暂停。不会录制系统声音、摄像头或其他窗口。</p>
      <p className={UI_TEXT_BODY_CLASS}>录音先保存在本机。结束后需单独确认，才会交给默认转写模型；文字和必要画面可在发送前检查。本次不会调用意图模型。</p>
      <p className={UI_TEXT_META_CLASS}>原音默认不长期保留，关闭审阅后删除；异常中断的临时录音最多保留 24 小时。</p>
    </UiModal>
    <UiModal isOpen={deleting} title="彻底删除本次讲解" onClose={() => setDeleting(false)} footer={<UiButton variant="dangerSolid" onClick={() => { setDeleting(false); run(() => eraseVideoExplanation(id)) }}>彻底删除</UiButton>}>
      <p className={UI_TEXT_BODY_CLASS}>删除录音、词稿与指向记录，同时清除本机撤销和重做中的讲解副本。这一步不能撤销，作品本身保留。已发送给供应商的数据无法由本机删除收回。</p>
    </UiModal>
  </>
}

function TranscriptRow({ entry, owner, onError, onInspect }: { entry: TranscriptEntry; owner: VideoEditInstance; onError: (error: unknown) => void; onInspect: (entry: TranscriptEntry) => void }): React.ReactElement {
  const [text, setText] = useState(entry.text)
  const player = useRef<{ audio: HTMLAudioElement; url: string }>(); const epoch = useRef(0)
  const release = (): void => { const active = player.current; if (active) { active.audio.pause(); active.audio.removeAttribute('src'); URL.revokeObjectURL(active.url); player.current = undefined } }
  useEffect(() => () => { epoch.current++; release() }, [entry.eventId])
  useEffect(() => setText(entry.text), [entry.text])
  return <div className="space-y-1 py-2" data-observation-sensitive>
    <span className={UI_TEXT_META_CLASS}>{entry.granularity === 'segment' ? '句级时间，请确认对应画面' : entry.granularity === 'character' ? '字级时间' : '词级时间'}{entry.alignmentQuality === 'unavailable' ? ' · 时间不明' : ` · ${(entry.monoSpanUs[0] / 1_000_000).toFixed(1)} 秒`}</span>
    <UiTextArea aria-label="校正讲解文字" value={text} rows={2} onChange={event => setText(event.target.value)} onBlur={() => { if (text !== entry.text) void correctVideoExplanationText(owner.document.id, entry, text).catch(onError) }} />
    <UiTextToken appearance="chip" aria-label={`查看${entry.granularity === 'segment' ? '句' : '词'}「${entry.text}」的录制证据`} onClick={() => onInspect(entry)}>{entry.text}</UiTextToken>
    {videoExplanationState(owner)?.collector.session.retentionStatus !== 'deleted' && <UiButton size="sm" onClick={() => { const token = ++epoch.current; release(); void readVideoExplanationAudio(owner.document.id, entry).then(async clip => {
      if (token !== epoch.current) return
      const url = URL.createObjectURL(new Blob([new Uint8Array(clip.bytes).buffer], { type: 'audio/wav' })); const audio = new Audio(url); player.current = { audio, url }
      audio.onloadedmetadata = () => { audio.currentTime = clip.startSeconds }
      audio.ontimeupdate = () => { if (audio.currentTime >= clip.endSeconds) release() }; audio.onended = release
      await audio.play()
    }).catch(error => { release(); onError(error) }) }}>回听{entry.granularity === 'segment' ? '这句' : '此词'}</UiButton>}
  </div>
}
export function VideoEditExplanationReview({ owner, onError }: { owner: VideoEditInstance; onError: (error: unknown) => void }): React.ReactElement | null {
  const version = useSyncExternalStore(subscribeVideoExplanation, videoExplanationRevision)
  useSyncExternalStore(subscribeVideoEditDomain, videoEditDomainRevision)
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  const contextKey = `${owner.document.revision}:${owner.activeSequenceId}:${owner.playing ? 'playing' : owner.frame}`
  const state = videoExplanationState(owner); const session = state?.collector.session
  const [page, setPage] = useState(0); const [entries, setEntries] = useState<TranscriptEntry[]>([])
  const [inspected, setInspected] = useState<TranscriptEntry>()
  const read = useCallback((value: TranscriptEntry) => readVideoExplanationReview(owner.document.id, value), [owner])
  const bind = useCallback((value: TranscriptEntry, binding: ExplanationBinding) => correctVideoExplanationBinding(owner.document.id, value, binding), [owner])
  useEffect(() => { setInspected(previous => previous && entries.find(entry => entry.eventId === previous.eventId)) }, [entries])
  const [upload, setUpload] = useState(false); const [jsonl, setJsonl] = useState<string[] | null>(null)
  const [retaining, setRetaining] = useState(false); const [jsonEnd, setJsonEnd] = useState(false); const jsonStream = useRef<AsyncGenerator<string>>()
  const nextJsonBatch = async (): Promise<void> => {
    const stream = jsonStream.current; const sessionId = session?.id
    if (!stream || !sessionId) return
    const current = (): boolean => stream === jsonStream.current && videoExplanationState(owner)?.collector.session.id === sessionId && !videoExplanationState(owner)?.erased
    const lines: string[] = []
    for (let i=0;i<256;i++) { const next = await stream.next(); if (!current()) return; if (next.done) { setJsonEnd(true); break } lines.push(next.value) }
    if (current()) setJsonl(lines)
  }
  const [hidden, setHidden] = useState(false); const sessionRef = useRef<string>()
  useEffect(() => { if (sessionRef.current !== session?.id) { sessionRef.current = session?.id; setHidden(false); setPage(0); setEntries([]); setUpload(false); setRetaining(false); setJsonl(null); setJsonEnd(false); jsonStream.current = undefined } }, [session?.id])
  useEffect(() => {
    let active = true
    if (session && ['reviewing', 'recoverable', 'transcribing'].includes(session.state)) void readVideoExplanationPage(owner.document.id, page).then(values => { if (active) setEntries(values.filter((value): value is TranscriptEntry => value.kind === 'transcript')) }).catch(onError)
    return () => { active = false }
  }, [owner, session, page, version, onError])
  if (!session || sessionRef.current !== session.id || hidden || !['reviewing', 'recoverable', 'transcribing'].includes(session.state)) return null
  const count = session.pages.filter(p => p.kind === 'transcript').length
  let model = '默认转写模型未配置'
  try { const modelId = session.asr?.moduleId ?? modelDefaultsManager.resolveTranscriptionModelId(); const entry = modelDefaultsManager.listTranscriptionModels().find(m => m.descriptor.id === modelId); model = entry ? `${getProviderDisplayName(entry.descriptor.providerIds?.[0] ?? '')} · ${entry.descriptor.modelId}` : '已选择的转写模型' } catch { /* Invalid selection is rejected before upload. */ }
  return <aside className="flex w-80 min-h-0 shrink-0 flex-col border-l border-line px-3 py-2" aria-label="讲解词稿审阅" data-observation-sensitive>
    <div className="flex items-center justify-between"><span className={UI_TEXT_BODY_CLASS}>讲解词稿</span><UiIconButton aria-label="关闭讲解审阅并删除临时原音" disabled={state?.busy} onClick={() => { void clearTemporaryVideoExplanationAudio(owner.document.id).then(() => setHidden(true)).catch(onError) }}><X size={14} /></UiIconButton></div>
    {state?.message && <UiError title="请检查讲解" message={state.message} />}
    <p className={UI_TEXT_META_CLASS}>{session.retentionStatus === 'deleted' ? '原音已删除，无法回听。' : session.retentionStatus === 'retained' ? '你已选择随项目保留原音。' : '原音为临时录音，关闭审阅后删除。'}</p>
    {inspected ? <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex items-center justify-between"><span className={UI_TEXT_BODY_CLASS}>「{inspected.text}」的指向</span><UiIconButton aria-label="返回讲解词稿" onClick={() => setInspected(undefined)}><X size={14} /></UiIconButton></div>
      <ExplanationReview key={inspected.eventId} entry={inspected} contextKey={contextKey} onRead={read} onBind={bind} onError={onError} initiallyOpen showTrigger={false} />
    </div> : jsonl ? <Virtuoso className="min-h-0 flex-1" data={jsonl} itemContent={(_index, line) => <pre className="whitespace-pre-wrap break-words text-xs">{line}</pre>} /> : entries.length ? <Virtuoso className="min-h-0 flex-1" data={entries} itemContent={(_index, entry) => <TranscriptRow entry={entry} owner={owner} onError={onError} onInspect={setInspected} />} /> : <UiEmpty className="flex-1" title={session.state === 'transcribing' ? '正在转写讲解' : '录制已保存，可以开始转写'} />}
    {count > 1 && <div className="flex items-center justify-between"><UiIconButton aria-label="上一页词稿" disabled={page === 0} onClick={() => setPage(p => p - 1)}><ChevronLeft size={14} /></UiIconButton><span className={UI_TEXT_META_CLASS}>第 {page + 1} / {count} 页</span><UiIconButton aria-label="下一页词稿" disabled={page >= count - 1} onClick={() => setPage(p => p + 1)}><ChevronRight size={14} /></UiIconButton></div>}
    <div className="flex flex-wrap items-center gap-1">
      {session.retentionStatus !== 'deleted' && <UiButton variant="primary" disabled={state?.busy} onClick={() => setUpload(true)}>转写并审阅</UiButton>}
      <UiButton disabled={state?.busy} onClick={() => openSettingsPanel({ tab: 'workspace', sectionId: 'workspace-generation' })}>设置默认转写模型</UiButton>
      {session.retentionStatus === 'temporary' && <UiButton disabled={state?.busy} onClick={() => setRetaining(true)}>选择保留原音</UiButton>}
      {import.meta.env.DEV && <UiButton disabled={state?.busy} onClick={() => { setJsonEnd(false); jsonStream.current = videoExplanationJsonl(owner.document.id); void nextJsonBatch().catch(onError) }}>预览结构化输入</UiButton>}
      {jsonl && <UiButton disabled={jsonEnd} onClick={() => { void nextJsonBatch().catch(onError) }}>下一批记录</UiButton>}
      {jsonl && <UiButton onClick={() => setJsonl(null)}>回到词稿</UiButton>}
    </div>
    {jsonl && <p className={UI_TEXT_META_CLASS}>{jsonEnd ? '已读到本次讲解末尾。' : '按批预览，记录不会被截断。'}</p>}
    <UiModal isOpen={retaining} title="随项目保留原音" onClose={() => setRetaining(false)} footer={<UiButton variant="primary" onClick={() => { setRetaining(false); void retainVideoExplanationAudio(owner.document.id).catch(onError) }}>确认保留</UiButton>}><p className={UI_TEXT_BODY_CLASS}>录音将随本项目保存和导出，供后续回听与转写。删除本次讲解时一并擦除；不向素材库或云端发送。</p></UiModal>
    <UiModal isOpen={upload} title="确认转写音频外发" onClose={() => setUpload(false)} footer={<UiButton variant="primary" onClick={() => { setUpload(false); void transcribeVideoExplanation(owner.document.id, crypto.randomUUID(), session.state === 'recoverable').catch(onError) }}>同意上传并转写</UiButton>}>
      <p className={UI_TEXT_BODY_CLASS}>将本次录音发送给「{model}」进行转写。供应商会按音频计费，目前无法提供可靠估价。此次仅发送录音，不发送指向、操作或作品画面。</p>
      <p className={UI_TEXT_META_CLASS}>模型将在本次转写中保持不变。取消会停止等待，已接收的任务可能仍计费；不自动重发未确认的提交。</p>
    </UiModal>
  </aside>
}
