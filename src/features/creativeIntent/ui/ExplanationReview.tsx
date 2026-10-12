import { useEffect, useRef, useState } from 'react'
import { LockKeyhole, MapPin } from 'lucide-react'
import { UiButton, UiError, UiSegmented, UiTextToken } from '@/components/ui'
import { UI_TEXT_BODY_CLASS, UI_TEXT_META_CLASS } from '@/components/ui/styleTokens'
import { confirmedExplanationBinding, type DeicticMention, type DeixisResolution, type ExplanationBinding } from '@/core/creativeIntent/deixis'
import type { IntentDifferencePlan } from '@/core/creativeIntent/intentPlan'
import type { ApplicationRef } from '@/core/application-control/identifiers'
import type { TranscriptEntry } from '@/core/creativeIntent/schema'
import { explanationIssue, explanationPosition } from './explanationPresentation'
import { useThemeTokens } from '@/hooks/useThemeTokens'

export interface ExplanationReviewResult {
  resolution: DeixisResolution; plan: IntentDifferencePlan; image?: Uint8Array; imagePoint?: [number, number]
  layout?: { targetRefs: ApplicationRef[]; action: 'distribute' | 'align' }
  objects?: { ref: ApplicationRef; label: string; corners?: [number, number][] }[]
}

function ObjectOutline({ corners }: { corners: [number, number][] }): JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null), theme = useThemeTokens()
  useEffect(() => {
    const element = canvas.current; if (!element) return
    const draw = (): void => {
      const { width, height } = element.getBoundingClientRect(), ratio = element.ownerDocument.defaultView?.devicePixelRatio ?? 1
      element.width = Math.round(width * ratio); element.height = Math.round(height * ratio)
      const context = element.getContext('2d'); if (!context || !corners.length) return
      context.scale(ratio, ratio); context.lineWidth = 2; context.strokeStyle = theme.colors.accentText
      context.beginPath(); corners.forEach(([x, y], index) => { if (index) context.lineTo(x * width, y * height); else context.moveTo(x * width, y * height) }); context.closePath(); context.stroke()
    }
    draw(); const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(draw); observer?.observe(element)
    return () => observer?.disconnect()
  }, [corners, theme.colors.accentText])
  return <canvas ref={canvas} aria-hidden data-explanation-object-outline className="pointer-events-none absolute inset-0 h-full w-full" />
}
export interface ExplanationReviewProps {
  entry: TranscriptEntry; onRead: (entry: TranscriptEntry, mentionId?: string) => Promise<ExplanationReviewResult>
  onBind: (entry: TranscriptEntry, binding: ExplanationBinding) => Promise<void>; onError: (error: unknown) => void
  onPick?: (entry: TranscriptEntry, mention: DeicticMention) => Promise<void>
  onResult?: (entry: TranscriptEntry, result: ExplanationReviewResult) => void
  initiallyOpen?: boolean; showTrigger?: boolean; contextKey?: string; focusedMentionId?: string; focusedMentionRequest?: number
}

/** A natural paragraph with inline references and exactly one expanded evidence area. */
export function ExplanationReview({ entry, onRead, onBind, onError, onPick, onResult, initiallyOpen = false, showTrigger = true, contextKey, focusedMentionId, focusedMentionRequest }: ExplanationReviewProps): React.ReactElement {
  const [open, setOpen] = useState(initiallyOpen), [result, setResult] = useState<ExplanationReviewResult>()
  const [activeId, setActiveId] = useState<string>(), [url, setUrl] = useState<string>(), [submitting, setSubmitting] = useState<Set<string>>(new Set()), [highlight, setHighlight] = useState<ApplicationRef>(), [failed, setFailed] = useState(false), [retry, setRetry] = useState(0), [readingEvidence, setReadingEvidence] = useState(false)
  const submissions = useRef(new Set<string>())
  const activeRef = useRef<string>()
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const epoch = useRef({ value: 0 }).current, report = useRef(onResult); report.current = onResult
  useEffect(() => {
    const token = ++epoch.value
    setResult(undefined); setHighlight(undefined); setFailed(false); setReadingEvidence(!!activeRef.current)
    if (open) void onRead(entry, activeRef.current).then(value => { if (token === epoch.value) { setResult(value); setReadingEvidence(false); report.current?.(entry, value) } }).catch(error => { if (token === epoch.value) { setFailed(true); setReadingEvidence(false); onError(error) } })
    return () => { epoch.value++ }
  }, [entry, open, onRead, onError, contextKey, retry, epoch])
  const focus = useRef<{ id: string; request?: number }>()
  useEffect(() => {
    if (!focusedMentionId || focus.current?.id === focusedMentionId && focus.current.request === focusedMentionRequest || !result?.resolution.mentions.some(mention => mention.id === focusedMentionId)) return
    focus.current = { id: focusedMentionId, request: focusedMentionRequest }; activeRef.current = focusedMentionId; setActiveId(focusedMentionId); setReadingEvidence(true)
    setResult(previous => previous && { ...previous, image: undefined, imagePoint: undefined })
    const token = ++epoch.value
    void onRead(entry, focusedMentionId).then(value => { if (token === epoch.value) { setResult(value); setReadingEvidence(false) } }).catch(error => { if (token === epoch.value) { setFailed(true); setReadingEvidence(false); onError(error) } })
  }, [focusedMentionId, focusedMentionRequest, entry, onRead, onError, result?.resolution.mentions, epoch])
  useEffect(() => {
    if (!result?.image) { setUrl(undefined); return }
    const value = URL.createObjectURL(new Blob([new Uint8Array(result.image).buffer], { type: 'image/png' })); setUrl(value)
    return () => URL.revokeObjectURL(value)
  }, [result?.image])
  const inspect = (mention: DeicticMention): void => {
    setHighlight(undefined)
    if (activeId === mention.id) { activeRef.current = undefined; setActiveId(undefined); ++epoch.value; return }
    activeRef.current = mention.id; setActiveId(mention.id); setReadingEvidence(true)
    setResult(previous => previous && { ...previous, image: undefined, imagePoint: undefined }); const token = ++epoch.value
    void onRead(entry, mention.id).then(value => { if (token === epoch.value) { setResult(value); setReadingEvidence(false) } }).catch(error => { if (token === epoch.value) { setFailed(true); setReadingEvidence(false); onError(error) } })
  }
  const mutate = (work: () => Promise<void>): void => {
    if (!activeId || submissions.current.has(activeId)) return
    const id = activeId; submissions.current.add(id); setSubmitting(new Set(submissions.current))
    void work().then(async () => {
      if (!mounted.current) return
      const token = ++epoch.value, value = await onRead(entry, activeRef.current)
      if (mounted.current && token === epoch.value) { setResult(value); report.current?.(entry, value) }
    }).catch(error => { if (mounted.current) onError(error) }).finally(() => { submissions.current.delete(id); if (mounted.current) setSubmitting(new Set(submissions.current)) })
  }
  const busy = !!activeId && submitting.has(activeId)
  const objectLabel = (ref: ApplicationRef): string => result?.objects?.find(object => object.ref.kind === ref.kind && object.ref.id === ref.id)?.label ?? ref.label ?? '图层'
  const active = result?.resolution.mentions.find(mention => mention.id === activeId)
  const needsConfirmation = (mention: DeicticMention): boolean => !mention.selected || !!result?.plan.issues.includes('差异目标尚未确认') && !mention.confirmedByUser
  const options = active?.candidates.flatMap(candidate => {
    const object = active.slot === 'target' || active.slot === 'source'
    if (/[这那]几个/.test(active.text) && candidate.pointer?.unavailableReason === 'static') return candidate.targetRefs.length ? [{ candidate, target: undefined, label: `${candidate.targetRefs.length} 张图片` }] : []
    return object ? candidate.targetRefs.map(target => ({ candidate, target: target as ApplicationRef | undefined, label: objectLabel(target) })) : [{ candidate, target: undefined, label: explanationPosition(candidate.point) }]
  }) ?? []
  const text = result?.resolution.text ?? entry.text
  let offset = 0
  const parts = result?.resolution.mentions.map(mention => {
    const at = text.indexOf(mention.text, offset), before = text.slice(offset, at); offset = at + mention.text.length
    return <span key={mention.id}>{before}<UiTextToken aria-label={`查看「${mention.text}」的指向`} aria-expanded={activeId === mention.id} onClick={() => inspect(mention)}><span className={`underline decoration-2 underline-offset-[3px] ${needsConfirmation(mention) ? 'decoration-warning-text' : 'decoration-accent-text'}`}>{mention.text}</span>{needsConfirmation(mention) && <span aria-label="待确认" className="ml-0.5 inline-block h-1 w-1 rounded-full bg-warning-solid align-middle" />}</UiTextToken>{mention.negated && mention.selected && <LockKeyhole aria-label="保护" size={12} className="inline text-text2" />}</span>
  })
  return <div className="space-y-3" data-observation-sensitive data-explanation-paragraph={entry.utteranceId}>
    {!open ? showTrigger && <UiTextToken aria-label={`查看「${entry.text}」的指向`} aria-expanded={false} onClick={() => setOpen(true)}>{entry.text}</UiTextToken> : <>
      <p className={`whitespace-pre-wrap break-words leading-7 ${UI_TEXT_BODY_CLASS}`}>{parts}{text.slice(offset)}</p>
      {failed && <UiError size="xs" align="start" title="讲解读取失败" message="" retryLabel="重试" onRetry={() => setRetry(value => value + 1)} />}
      {active && <div className="space-y-2" data-explanation-evidence>
        {readingEvidence ? <p role="status" className={UI_TEXT_META_CLASS}>正在读取画面…</p> : url ? <div className="relative overflow-hidden rounded-lg"><img src={url} className="block h-auto w-full" alt="指向时保存的作品画面" />{result?.objects?.filter(object => object.ref.kind === highlight?.kind && object.ref.id === highlight?.id && object.corners).map(object => <ObjectOutline key={object.ref.id} corners={object.corners!} />)}{result?.imagePoint && <MapPin aria-label="录制时的指向位置" size={18} fill="var(--accent-text)" stroke="var(--media)" strokeWidth={1} className="absolute" style={{ left: `${result.imagePoint[0] * 100}%`, top: `${result.imagePoint[1] * 100}%`, transform: 'translate(-50%, -100%)' }} />}</div> : !failed && <p className={UI_TEXT_META_CLASS}>这处没有保存当时的画面</p>}
        <p className={UI_TEXT_META_CLASS}>说“{active.text}”时指向：{(active.selected?.targetRefs ?? active.candidates[0]?.targetRefs ?? []).map(objectLabel).join('、') || '画面位置'}</p>
        {needsConfirmation(active) && <>
          {explanationIssue(active.issues) && <p className={UI_TEXT_META_CLASS}>{explanationIssue(active.issues)}</p>}
          <div className="flex flex-wrap items-center gap-1">
            <span className={UI_TEXT_META_CLASS}>指的是：</span>
            <UiSegmented key={active.id} ariaLabel="指的是" size="sm" value={-1} disabled={busy}
              options={[...options.slice(0, 2).map((option, index) => ({ value: index, label: option.label })), { value: -2, label: '其他…', disabled: !onPick, title: !onPick ? '请在作品宿主中点选对象' : undefined }]}
              onPreview={index => setHighlight(index === undefined ? undefined : options[index]?.target)}
              onChange={index => { const option = options[index]; if (option) mutate(() => onBind(entry, confirmedExplanationBinding(active, option.candidate, option.target))); else if (onPick) mutate(() => onPick(entry, active)) }} />
          </div>
        </>}
        {active.selected && <UiButton size="sm" variant="link" disabled={busy || !onPick} onClick={() => onPick && mutate(() => onPick(entry, active))}>重新点选</UiButton>}
      </div>}
    </>}
  </div>
}
