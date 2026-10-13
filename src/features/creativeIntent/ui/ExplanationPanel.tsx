import { ExplanationSendConfirmation } from './ExplanationSendConfirmation'
import type { ExplanationSendRequest } from '../application/explanationGeneration'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { UiButton, UiError, UiIconButton, UiTextToken } from '@/components/ui'
import { UI_TEXT_BODY_CLASS, UI_TEXT_META_CLASS } from '@/components/ui/styleTokens'
import type { TranscriptEntry } from '@/core/creativeIntent/schema'
import { ExplanationReview, type ExplanationReviewProps, type ExplanationReviewResult } from './ExplanationReview'
import { explanationChanges, explanationDuration } from './explanationPresentation'

export interface ExplanationPanelProps extends Pick<ExplanationReviewProps, 'onRead' | 'onBind' | 'onPick' | 'onError' | 'contextKey'> {
  entries: TranscriptEntry[]; stage?: string; elapsedUs: number; busy: boolean; loading: boolean; hasRecorded: boolean
  failed?: boolean; failureTitle?: string; onRetry: () => void; onStart: () => void; onTranscribe: () => void; onCancel: () => void; onDelete?: () => void
  onGenerate?: (entries: TranscriptEntry[]) => Promise<void>; generationUnavailable?: string
  canGenerate?: (results: ExplanationReviewResult[]) => boolean
  generationKey?: string
  prepareGeneration?: () => Promise<ExplanationSendRequest | undefined>
}
export type { ExplanationSendRequest } from '../application/explanationGeneration'
/** Shared three-part skeleton for image and video hosts. The PanelTrigger owns its only surface. */
export function ExplanationPanel({ entries, stage, elapsedUs, busy, loading, hasRecorded, failed, failureTitle, onRetry, onStart, onTranscribe, onCancel, onDelete, onGenerate, generationUnavailable, canGenerate, prepareGeneration, generationKey, ...review }: ExplanationPanelProps): JSX.Element {
  const { contextKey, onRead, onBind, onError } = review
  const [results, setResults] = useState<Map<string, ExplanationReviewResult>>(new Map()), [expanded, setExpanded] = useState(false), [focused, setFocused] = useState<string>()
  const [focusRequest, setFocusRequest] = useState(0)
  const [scrollParent, setScrollParent] = useState<HTMLDivElement | null>(null)
  const virtual = useRef<VirtuosoHandle>(null)
  const section = useRef<HTMLElement>(null)
  const [availableHeight, setAvailableHeight] = useState<number>()
  const [generating, setGenerating] = useState(false)
  const generatingRef = useRef(false)
  const [sendRequest, setSendRequest] = useState<{ scope: object; request: ExplanationSendRequest }>()
  useLayoutEffect(() => {
    // PanelTrigger also constrains height near viewport edges. Respect its actual budget,
    // so only our middle region scrolls and neither fixed row escapes the outer scroller.
    const panel = section.current?.closest('[data-panel-scroll-region]')?.parentElement
    if (!panel) return
    const update = (): void => {
      const view = panel.ownerDocument.defaultView; if (!view) return
      const style = view.getComputedStyle(panel), limit = parseFloat(style.maxHeight)
      const inset = [style.paddingTop, style.paddingBottom, style.borderTopWidth, style.borderBottomWidth].reduce((sum, value) => sum + (parseFloat(value) || 0), 0)
      setAvailableHeight(Math.max(0, Math.min(view.innerHeight * .8, Number.isFinite(limit) ? limit - inset : view.innerHeight * .8)))
    }
    update(); const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update); observer?.observe(panel)
    return () => observer?.disconnect()
  }, [])
  const paragraphs = useMemo(() => [...new Map(entries.map(entry => [entry.utteranceId, entry])).values()], [entries])
  const scope = useMemo(() => ({ contextKey, onRead, pending: new Map<string, Promise<ExplanationReviewResult>>(), queue: Promise.resolve() }), [contextKey, onRead])
  const generationContext = generationKey ?? contextKey
  const generationScope = useMemo(() => ({ generationContext, onRead }), [generationContext, onRead])
  const currentScope = useRef(generationScope); currentScope.current = generationScope
  const cache = scope.pending
  const read = useCallback((entry: TranscriptEntry, mentionId?: string): Promise<ExplanationReviewResult> => {
    if (mentionId) return onRead(entry, mentionId)
    let pending = cache.get(entry.eventId)
    if (!pending) {
      pending = scope.queue.then(() => onRead(entry)).catch(error => { if (cache.get(entry.eventId) === pending) cache.delete(entry.eventId); throw error })
      scope.queue = pending.then(() => {}, () => {})
      cache.set(entry.eventId, pending)
    }
    return pending
  }, [cache, onRead, scope])
  const bind = useCallback(async (entry: TranscriptEntry, binding: Parameters<ExplanationReviewProps['onBind']>[1]): Promise<void> => { await onBind(entry, binding); cache.delete(entry.eventId) }, [cache, onBind])
  const onPick = review.onPick
  const pick = useCallback(async (entry: TranscriptEntry, mention: Parameters<NonNullable<ExplanationReviewProps['onPick']>>[1]): Promise<void> => {
    cache.delete(entry.eventId)
    try { await onPick?.(entry, mention) } finally { cache.delete(entry.eventId) }
  }, [cache, onPick])
  useEffect(() => { setResults(new Map()); setFocused(undefined); setExpanded(false) }, [contextKey])
  useEffect(() => { setResults(previous => new Map([...previous].filter(([id]) => paragraphs.some(entry => entry.utteranceId === id)))) }, [paragraphs])
  const report = useCallback((entry: TranscriptEntry, result: ExplanationReviewResult) => setResults(previous => new Map(previous).set(entry.utteranceId, { ...result, image: undefined })), [])
  useEffect(() => {
    let current = true
    void (async () => { for (const entry of paragraphs) { const result = await read(entry); if (!current) return; report(entry, result) } })().catch(error => { if (current) onError(error) })
    return () => { current = false }
  }, [paragraphs, read, report, onError])
  const unresolved = [...results.values()].flatMap(result => result.resolution.mentions.filter(mention => !mention.selected || result.plan.issues.includes('差异目标尚未确认') && !mention.confirmedByUser))
  const unread = paragraphs.filter(entry => !results.has(entry.utteranceId)).length
  const changes = [...new Set([...results.values()].flatMap(explanationChanges))]
  const blocked = [...results.values()].some(result => !result.resolution.negated && !result.layout && (result.plan.status === 'blocked' || !result.plan.changes.length))
  const reason = unresolved.length ? '请先确认讲解中的指向' : loading || unread ? '正在读取讲解，请稍候' : blocked ? '请补充要修改的对象和动作' : !onGenerate || canGenerate && !canGenerate([...results.values()]) ? generationUnavailable ?? '这句暂不能生成候选' : undefined
  const virtualized = entries.reduce((count, entry) => count + Math.max(1, entry.text.trim().split(/\s+/).length), 0) > 2000
  const next = (): void => {
    const mention = unresolved[(unresolved.findIndex(mention => mention.id === focused) + 1) % unresolved.length]
    if (!mention) return
    setFocused(mention.id)
    setFocusRequest(value => value + 1)
    const index = paragraphs.findIndex(entry => entry.utteranceId === mention.entry.utteranceId)
    if (virtualized) virtual.current?.scrollToIndex({ index, align: 'start' })
    else scrollParent?.querySelectorAll('[data-explanation-paragraph]')[index]?.scrollIntoView?.({ block: 'nearest' })
  }
  const paragraph = (entry: TranscriptEntry): JSX.Element => <ExplanationReview {...review} onRead={read} onBind={bind} onPick={review.onPick ? pick : undefined} entry={entry} initiallyOpen showTrigger={false} onResult={report} focusedMentionId={focused} focusedMentionRequest={focusRequest} />
  const transcribing = stage === 'transcribing', recording = stage === 'recording' || stage === 'paused'
  const generate = (confirm?: ExplanationSendRequest, project = false): void => {
    if (!onGenerate || generatingRef.current) return
    const expected = generationScope
    generatingRef.current = true; setGenerating(true)
    void (async () => {
      if (confirm) await confirm.confirm(project)
      else {
        const request = await prepareGeneration?.()
        if (currentScope.current !== expected) { await request?.cancel(); return }
        if (request) { setSendRequest({ scope: expected, request }); return }
      }
      if (currentScope.current !== expected) return
      setSendRequest(undefined); await onGenerate(paragraphs)
    })().catch(review.onError).finally(() => { generatingRef.current = false; setGenerating(false) })
  }
  return <section ref={section} style={{ maxHeight: availableHeight }} className="flex max-h-[80vh] min-h-0 min-w-0 flex-col gap-4 overflow-hidden" aria-label="讲解词稿审阅" data-observation-sensitive>
    <div className="flex shrink-0 items-center justify-between gap-2">
      <span className={UI_TEXT_BODY_CLASS}>讲解 · {explanationDuration(elapsedUs)}</span>
      {onDelete && <UiIconButton size="xs" tone="danger" aria-label="删除讲解" disabled={busy} onClick={onDelete}><Trash2  /></UiIconButton>}
    </div>
    <div ref={setScrollParent} className="min-h-0 space-y-4 overflow-y-auto">
      {failed ? <UiError size="xs" align="start" title={failureTitle ?? (stage === 'recoverable' ? '转写失败' : '讲解未完成')} message="" retryLabel="重试" onRetry={onRetry} /> : transcribing ? <div className="flex items-center gap-2" role="status"><span className={UI_TEXT_META_CLASS}>正在转写…</span><progress className="min-w-0 flex-1 accent-accent" aria-label="转写进度" /><UiButton size="sm" variant="link" onClick={onCancel}>取消</UiButton></div> : !stage ? <>
        <UiButton variant="primary" disabled={busy} onClick={onStart}>开始录制</UiButton>
        {!hasRecorded && <p className={UI_TEXT_META_CLASS}>会使用麦克风，录音只存在本机，审阅后删除</p>}
      </> : recording ? <p className={UI_TEXT_META_CLASS}>{stage === 'paused' ? '录制已暂停' : '正在录制…'}</p> : <>
        {virtualized && scrollParent ? <Virtuoso ref={virtual} customScrollParent={scrollParent} data={paragraphs} itemContent={(_index, entry) => <div className="pb-4">{paragraph(entry)}</div>} /> : paragraphs.map(entry => <div key={entry.utteranceId}>{paragraph(entry)}</div>)}
        {unresolved.length > 0 ? <UiTextToken onClick={next}><span className="text-warning-text">还有 {unresolved.length} 处需要确认</span></UiTextToken> : !!changes.length && <div className="space-y-1">
          {changes.slice(0, expanded ? undefined : 5).map(line => <p key={line} className={UI_TEXT_META_CLASS}>{line}</p>)}
          {changes.length > 5 && <UiButton size="sm" variant="link" onClick={() => setExpanded(value => !value)}>{expanded ? '收起' : `还有 ${changes.length - 5} 处`}</UiButton>}
        </div>}
        {loading && <p role="status" className={UI_TEXT_META_CLASS}>正在读取讲解…</p>}
      </>}
    </div>
    {!failed && !transcribing && !recording && !!stage && <div className="flex shrink-0 justify-end">
      {entries.length ? <UiButton variant="primary" loading={generating} disabledReason={reason || (!onGenerate ? '当前内容暂不支持生成候选' : undefined)} disabled={busy || generating || !!reason || !onGenerate} onClick={() => generate()}>生成候选</UiButton> : <UiButton variant="primary" disabled={busy || loading} onClick={onTranscribe}>转写并审阅</UiButton>}
    </div>}
    <ExplanationSendConfirmation request={sendRequest?.scope === generationScope ? sendRequest.request : undefined} generating={generating}
      onCancel={() => { if (!generatingRef.current) { void sendRequest?.request.cancel().catch(review.onError); setSendRequest(undefined) } }} onSend={project => { if (sendRequest?.scope === generationScope) generate(sendRequest.request, project) }} />
  </section>
}
