import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Mic, Pause, Play, Square } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PanelTrigger, UiButton, UiIconButton, UiModal } from '@/components/ui'
import { UI_TEXT_META_CLASS } from '@/components/ui/styleTokens'
import { ExplanationPanel, explanationDuration, useExplanationTranscript, useExplanationHasRecorded, type ExplanationReviewResult } from '@/features/creativeIntent'
import type { TranscriptEntry } from '@/core/creativeIntent/schema'
import type { DeicticMention, ExplanationBinding } from '@/core/creativeIntent/deixis'
import { imageEditExplanation } from '../application/imageEditExplanation'
import type { ImageEditCommandBusV3 } from '../application/imageEditCommandBus'
import type { ImageEditorV3Controller } from './types'

export function ImageEditorExplanationControlsV3({ bus, controller, onGenerated }: { bus: ImageEditCommandBusV3; controller: ImageEditorV3Controller; onGenerated?: () => void }): JSX.Element {
  const { t } = useTranslation('common')
  const adapter = useMemo(() => imageEditExplanation(bus), [bus])
  const state = useSyncExternalStore(adapter.subscribe, adapter.snapshot)
  const [open, setOpen] = useState(false), [deleting, setDeleting] = useState(false)
  const [failed, setFailed] = useState(false)
  const hasRecorded = useExplanationHasRecorded(!!controller.document.creativeIntents?.sessions.length || state.session?.state === 'recording')
  const retryWork = useRef<() => Promise<void>>()
  const [failureTitle, setFailureTitle] = useState('讲解未完成')
  const onError = useCallback(() => { retryWork.current = undefined; setFailureTitle('讲解读取失败'); setFailed(true) }, [])
  const run = (work: () => Promise<void>, title = '讲解未完成'): void => { setFailed(false); void Promise.resolve().then(work).catch(() => { onError(); retryWork.current = work; setFailureTitle(title) }) }
  const onRead = useCallback((entry: TranscriptEntry, mentionId?: string) => adapter.readReview(entry, mentionId, !!mentionId), [adapter])
  const onBind = useCallback((entry: TranscriptEntry, binding: ExplanationBinding) => adapter.bind(entry, binding), [adapter])
  const readPage = useCallback((index: number) => adapter.transcript(index), [adapter])
  const stage = state.session?.state, active = stage === 'recording' || stage === 'paused'
  const transcriptKey = open && state.session && !active ? `${state.session.id}:${state.session.pages.filter(p => p.kind === 'transcript').map(p => p.resourceId).join(',')}` : undefined
  const { entries, loading, retry } = useExplanationTranscript(transcriptKey, readPage, undefined, onError)
  const changeOpen = (value: boolean): void => {
    setOpen(value)
    if (!value && !adapter.hasPendingPick() && entries.length) run(() => adapter.finishReview())
  }
  const onPick = useCallback(async (entry: TranscriptEntry, mention: DeicticMention): Promise<void> => {
    const picking = adapter.pick(entry, mention); setOpen(false)
    try { await picking } finally { setOpen(true) }
  }, [adapter])
  useEffect(() => { if (stage === 'recording') setOpen(false) }, [stage])
  useEffect(() => () => adapter.cancelPick(), [adapter])
  const generate = async (paragraphs: TranscriptEntry[]): Promise<void> => {
    await adapter.generate(paragraphs); setOpen(false); onGenerated?.()
  }
  const canGenerate = (reviews: ExplanationReviewResult[]): boolean => {
    const protectedRefs = new Set(reviews.flatMap(review => review.plan.protectedRefs.map(ref => ref.id)))
    return reviews.some(review => !!review.layout || review.plan.changes.length > 0) && reviews.every(review => {
      if (review.resolution.negated) return true
      if (review.layout) return review.layout.targetRefs.every(ref => !protectedRefs.has(ref.id))
      return review.plan.status === 'review' && review.plan.changes.every(change => change.property === 'position' && !protectedRefs.has(change.targetRef.id))
    })
  }
  return <>
    <div className="flex shrink-0 items-center gap-1" role="group" aria-label="录制讲解控制">
      <PanelTrigger open={open} onOpenChange={changeOpen} size="sm" alignment="bottomRight" panelPadding="content" panelWidth={360}
        renderPanel={() => <div data-image-explanation-controls><ExplanationPanel entries={entries} stage={stage} elapsedUs={state.elapsedUs} busy={state.busy} loading={loading} hasRecorded={hasRecorded}
          failed={failed || !!state.message?.includes('未保存')} failureTitle={failed ? failureTitle : t('explanation.saveFailed')} onRetry={() => run(retryWork.current ?? (failed ? async () => { retry() } : () => adapter.save()), failed ? failureTitle : t('explanation.saveFailed'))}
          onStart={() => run(() => adapter.snapshot().session?.state === 'paused' ? adapter.resume() : adapter.start(crypto.randomUUID()), '录制失败')} onTranscribe={() => run(async () => { await adapter.preflightTranscription(); await adapter.transcribe(crypto.randomUUID()) }, '转写预检失败')} onCancel={() => run(() => adapter.cancelTranscription())} onDelete={state.session ? () => setDeleting(true) : undefined}
          onRead={onRead} onBind={onBind} onPick={onPick} onError={onError} contextKey={`${state.session?.id}:${controller.document.revision}`} generationKey={state.session?.id} prepareGeneration={() => adapter.prepareGeneration()} onGenerate={generate} canGenerate={canGenerate} />
        </div>}>
        {controls => <UiButton size="sm" aria-label="录制讲解" onClick={controls.togglePanel} aria-expanded={controls.open}>{active ? <><span aria-hidden className="h-2 w-2 rounded-full bg-danger-solid" />{explanationDuration(state.elapsedUs)}</> : <><Mic size={14} />讲解</>}</UiButton>}
      </PanelTrigger>
      {active && <><UiIconButton size="sm" aria-label={stage === 'paused' ? '继续图片讲解' : '暂停图片讲解'} disabled={state.busy} onClick={() => run(() => stage === 'paused' ? adapter.resume() : adapter.pause())}>{stage === 'paused' ? <Play size={14} /> : <Pause size={14} />}</UiIconButton><UiIconButton size="sm" aria-label="结束图片讲解" disabled={state.busy} onClick={() => run(async () => { await adapter.stop(); setOpen(true) })}><Square size={14} /></UiIconButton></>}
    </div>
    <UiModal isOpen={deleting} title="删除本次讲解" onClose={() => setDeleting(false)} footer={<UiButton variant="dangerSolid" onClick={() => { setDeleting(false); run(() => adapter.remove()) }}>删除</UiButton>}>
      <p className={UI_TEXT_META_CLASS}>删除本次讲解并释放本机录音，作品保留。</p>
    </UiModal>
  </>
}
