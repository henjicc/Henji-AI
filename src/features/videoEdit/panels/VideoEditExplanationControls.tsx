import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Mic, Pause, Play, Square } from 'lucide-react'
import { PanelTrigger, UiButton, UiIconButton, UiModal } from '@/components/ui'
import type { TranscriptEntry } from '@/core/creativeIntent/schema'
import type { DeicticMention, ExplanationBinding } from '@/core/creativeIntent/deixis'
import { ExplanationPanel, explanationDuration, useExplanationTranscript, useExplanationHasRecorded } from '@/features/creativeIntent'
import { UI_TEXT_META_CLASS } from '@/components/ui/styleTokens'
import { subscribeVideoEditDomain, subscribeVideoEditView, videoEditDomainRevision, videoEditViewRevision, type VideoEditInstance } from '../application/videoEditService'
import { startVideoExplanation, stopVideoExplanation, pauseVideoExplanation, resumeVideoExplanation, transcribeVideoExplanation, subscribeVideoExplanation, videoExplanationRevision, videoExplanationState, eraseVideoExplanation, cancelVideoExplanationTranscription, readVideoExplanationPage, clearTemporaryVideoExplanationAudio, retryVideoExplanationSave, readVideoExplanationReview, correctVideoExplanationBinding, pickVideoExplanationBinding, generateVideoExplanationCandidates, prepareVideoExplanationGeneration } from '../application/videoEditExplanation'

export function VideoEditExplanationControls({ owner, onError }: { owner: VideoEditInstance; onError: (error: unknown) => void }): React.ReactElement {
  useSyncExternalStore(subscribeVideoExplanation, videoExplanationRevision)
  useSyncExternalStore(subscribeVideoEditDomain, videoEditDomainRevision)
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  const state = videoExplanationState(owner), session = state?.collector.session, id = owner.document.id
  const [open, setOpen] = useState(false), [upload, setUpload] = useState(false), [deleting, setDeleting] = useState(false), [failed, setFailed] = useState(false)
  const hasRecorded = useExplanationHasRecorded(!!owner.document.creativeIntents?.sessions.length || session?.state === 'recording')
  const picking = useRef<AbortController>()
  const retryWork = useRef<() => Promise<void>>()
  const [failureTitle, setFailureTitle] = useState('讲解未完成')
  const error = useCallback((reason: unknown) => { retryWork.current = undefined; setFailureTitle('讲解读取失败'); setFailed(true); onError(reason) }, [onError])
  const run = (work: () => Promise<void>, title = '讲解未完成'): void => { setFailed(false); void Promise.resolve().then(work).catch(reason => { error(reason); retryWork.current = work; setFailureTitle(title) }) }
  const read = useCallback((entry: TranscriptEntry, mentionId?: string) => readVideoExplanationReview(id, entry, mentionId, !!mentionId), [id])
  const bind = useCallback((entry: TranscriptEntry, binding: ExplanationBinding) => correctVideoExplanationBinding(id, entry, binding), [id])
  const readPage = useCallback(async (index: number) => (await readVideoExplanationPage(id, index)).filter((entry): entry is TranscriptEntry => entry.kind === 'transcript'), [id])
  const active = session?.state === 'recording' || session?.state === 'paused'
  const pageCount = session?.pages.filter(page => page.kind === 'transcript').length ?? 0
  const key = open && session && !active ? `${session.id}:${session.pages.filter(page => page.kind === 'transcript').map(page => page.resourceId).join(',')}:${session.corrections.length}` : undefined
  const { entries, loading } = useExplanationTranscript(key, readPage, pageCount, error)
  const sessionId = session?.id
  useEffect(() => { if (session?.state === 'recording') setOpen(false) }, [session?.state])
  useEffect(() => { setFailed(false); setUpload(false); return () => picking.current?.abort() }, [sessionId])
  const pick = useCallback(async (entry: TranscriptEntry, mention: DeicticMention): Promise<void> => {
    picking.current?.abort(); const controller = new AbortController(); picking.current = controller; setOpen(false)
    try { await pickVideoExplanationBinding(owner, entry, mention, controller.signal) } finally { if (!controller.signal.aborted) setOpen(true); if (picking.current === controller) picking.current = undefined }
  }, [owner])
  const changeOpen = (value: boolean): void => {
    setOpen(value)
    if (!value && !picking.current && entries.length) run(() => clearTemporaryVideoExplanationAudio(id))
  }
  return <>
    <div className="flex shrink-0 items-center gap-1" role="group" aria-label="录制讲解控制">
      <PanelTrigger size="sm" open={open} onOpenChange={changeOpen} alignment="aboveCenter" panelPadding="content" panelWidth={360} renderPanel={() => open ? <ExplanationPanel entries={entries} stage={state?.erased || !pageCount && session?.retentionStatus === 'deleted' && !active ? undefined : session?.state} elapsedUs={state?.elapsedUs ?? 0} busy={state?.busy ?? false} loading={loading} hasRecorded={hasRecorded}
        failed={failed || !!state?.message?.includes('未保存')} failureTitle={failed ? failureTitle : undefined} onRetry={() => run(retryWork.current ?? (failed ? async () => {} : () => retryVideoExplanationSave(id)), failureTitle)}
        onStart={() => run(() => startVideoExplanation(id, crypto.randomUUID()), '录制失败')} onTranscribe={() => setUpload(true)} onCancel={() => run(() => cancelVideoExplanationTranscription(id))} onDelete={session && !state?.erased ? () => setDeleting(true) : undefined}
        onRead={read} onBind={bind} onPick={pick} onError={error} onGenerate={async paragraphs => { await generateVideoExplanationCandidates(id, paragraphs); setOpen(false) }} contextKey={`${sessionId}:${owner.version}:${owner.activeSequenceId}:${owner.playing ? 'playing' : owner.frame}`} generationKey={sessionId} prepareGeneration={() => prepareVideoExplanationGeneration(id)} /> : null }>
        {controls => <UiButton size="sm" aria-label="录制讲解" aria-expanded={controls.open} onClick={controls.togglePanel}>{active ? <><span aria-hidden className="h-2 w-2 rounded-full bg-danger-solid" />{explanationDuration(state?.elapsedUs ?? 0)}</> : <><Mic size={14} />讲解</>}</UiButton>}
      </PanelTrigger>
      {active && <><UiIconButton size="sm" aria-label={session?.state === 'paused' ? '继续录制讲解' : '暂停录制讲解'} disabled={state?.busy || session?.retentionStatus === 'deleted'} onClick={() => run(() => session?.state === 'paused' ? resumeVideoExplanation(id) : pauseVideoExplanation(id))}>{session?.state === 'paused' ? <Play size={14} /> : <Pause size={14} />}</UiIconButton><UiIconButton size="sm" aria-label="结束录制讲解" disabled={state?.busy} onClick={() => run(async () => { await stopVideoExplanation(id); setOpen(true) })}><Square size={14} /></UiIconButton></>}
    </div>
    <UiModal isOpen={deleting} title="删除本次讲解" onClose={() => setDeleting(false)} footer={<UiButton variant="dangerSolid" onClick={() => { setDeleting(false); setOpen(false); run(() => eraseVideoExplanation(id)) }}>删除</UiButton>}>
      <p className={UI_TEXT_META_CLASS}>删除录音、词稿与指向记录。此操作不能撤销，作品保留。</p>
    </UiModal>
    <UiModal isOpen={upload} title="确认转写音频外发" onClose={() => setUpload(false)} footer={<UiButton variant="primary" onClick={() => { setUpload(false); run(() => transcribeVideoExplanation(id, crypto.randomUUID(), videoExplanationState(owner)?.collector.session.state === 'recoverable'), '转写失败') }}>同意上传并转写</UiButton>}>
      <p className={UI_TEXT_META_CLASS}>将录音发送给默认转写模型，供应商可能收费。此次只发送录音。</p>
    </UiModal>
  </>
}
