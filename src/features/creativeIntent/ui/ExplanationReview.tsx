import { useEffect, useRef, useState } from 'react'
import { MapPin } from 'lucide-react'
import { Virtuoso } from 'react-virtuoso'
import { UiButton, UiEmpty, UiError, UiTextToken } from '@/components/ui'
import { UI_TEXT_BODY_CLASS, UI_TEXT_META_CLASS } from '@/components/ui/styleTokens'
import { confirmedExplanationBinding, type DeixisResolution, type ExplanationBinding } from '@/core/creativeIntent/deixis'
import type { IntentDifferencePlan } from '@/core/creativeIntent/intentPlan'
import type { TranscriptEntry } from '@/core/creativeIntent/schema'

export interface ExplanationReviewResult { resolution: DeixisResolution; plan: IntentDifferencePlan; image?: Uint8Array; imagePoint?: [number, number] }
export interface ExplanationReviewProps {
  entry: TranscriptEntry; onRead: (entry: TranscriptEntry) => Promise<ExplanationReviewResult>
  onBind: (entry: TranscriptEntry, binding: ExplanationBinding) => Promise<void>; onError: (error: unknown) => void
  initiallyOpen?: boolean; showTrigger?: boolean
  contextKey?: string
}
const slotNames = { target: '对象', source: '起点', destination: '终点', dwell: '停留', exit: '离开' }
/** Host-independent private review; never seeks the live playhead or executes recorded actions. */
export function ExplanationReview({ entry, onRead, onBind, onError, initiallyOpen = false, showTrigger = true, contextKey }: ExplanationReviewProps): React.ReactElement {
  const [open, setOpen] = useState(initiallyOpen); const [result, setResult] = useState<ExplanationReviewResult>(); const [url, setUrl] = useState<string>(); const [busy, setBusy] = useState(false)
  const epoch = useRef({ value: 0 }).current
  useEffect(() => {
    let active = true; epoch.value++; setResult(undefined); setBusy(false)
    if (open) void onRead(entry).then(value => { if (active) setResult(value) }).catch(error => { if (active) onError(error) })
    return () => { active = false; epoch.value++ }
  }, [entry, open, onRead, onError, epoch, contextKey])
  useEffect(() => {
    if (!result?.image) { setUrl(undefined); return }
    const value = URL.createObjectURL(new Blob([new Uint8Array(result.image).buffer], { type: 'image/png' })); setUrl(value)
    return () => URL.revokeObjectURL(value)
  }, [result?.image])
  const options = result?.resolution.mentions.flatMap(mention => mention.candidates.flatMap((candidate, index) => {
    if ((mention.slot === 'target' || mention.slot === 'source') && !candidate.targetRefs.length) return []
    const targets = candidate.targetRefs.length && (mention.slot === 'target' || mention.slot === 'source') ? candidate.targetRefs : [undefined]
    return targets.map((target, targetIndex) => ({ mention, candidate, target, label: `${slotNames[mention.slot]}「${mention.text}」· 位置 ${index + 1}${target ? ` · 对象 ${targetIndex + 1}（${target.label ?? '录制时的对象'}）` : ''}` }))
  })) ?? []
  return <div className="space-y-2" data-observation-sensitive>
    {showTrigger && <UiTextToken appearance="chip" aria-label={`查看${entry.granularity === 'segment' ? '句' : '词'}「${entry.text}」的录制证据`} aria-expanded={open} onClick={() => setOpen(value => !value)}>{entry.text}</UiTextToken>}
    {open && <>
      {!result ? <UiEmpty title="正在读取录制证据" /> : <>
        {url ? <div className="relative"><img src={url} className="block h-auto w-full" alt="指向时保存的作品画面" />{result.imagePoint && <MapPin aria-label="录制时的指向位置" size={18} className="absolute text-accent-text" style={{ left: `${result.imagePoint[0] * 100}%`, top: `${result.imagePoint[1] * 100}%`, transform: 'translate(-50%, -100%)' }} />}</div> : <UiEmpty title="这处没有保存历史画面" description="保留位置证据，不用当前画面代替。" />}
        {result.resolution.negated && <p role="status" className={UI_TEXT_BODY_CLASS}>这句表示不要修改对象，候选只用于确认保护范围。</p>}
        {result.resolution.mentions.map(mention => <p key={mention.id} className={UI_TEXT_META_CLASS}>{slotNames[mention.slot]}「{mention.text}」：{mention.selected ? `${mention.selected.targetRefs.map(ref => ref.label ?? '已确认对象').join('、') || '已确认位置'} · ${(mention.selected.point[0] * 100).toFixed(1)}%, ${(mention.selected.point[1] * 100).toFixed(1)}%` : mention.issues.join('；') || '请确认'}</p>)}
        {!!options.length && <div className="h-40 min-w-0"><Virtuoso data={options} itemContent={(_index, option) => <UiButton className="max-w-full" size="sm" disabled={busy} title={`确认${option.label}`} onClick={() => {
          const token = epoch.value; setBusy(true); const binding = confirmedExplanationBinding(option.mention, option.candidate, option.target)
          void onBind(entry, binding).then(() => onRead(entry)).then(value => { if (token === epoch.value) setResult(value) }).catch(error => { if (token === epoch.value) onError(error) }).finally(() => { if (token === epoch.value) setBusy(false) })
        }}><span className="min-w-0 truncate">确认{option.label}</span></UiButton>} /></div>}
        {!!result.plan.issues.length && <UiError title="还不能生成修改计划" message={result.plan.issues.join('；')} />}
        {result.plan.status === 'satisfied' && <p className={UI_TEXT_BODY_CLASS}>当前状态已满足确认目标，无需重复执行。</p>}
        {result.plan.status === 'review' && <p className={UI_TEXT_BODY_CLASS}>候选更新：{result.plan.changes.length} 处位置差异待审阅。当前仅供审阅，还未修改作品。录制中的移动、撤销和重做不会重放。</p>}
        {result.plan.changes.map((change, index) => <p key={index} className={UI_TEXT_META_CLASS}>{change.targetRef.label ?? '已确认对象'}：{change.property === 'position' && Array.isArray(change.before) && Array.isArray(change.after) ? `从 ${change.before.map(value => (value * 100).toFixed(1) + '%').join(', ')} 到 ${change.after.map(value => (value * 100).toFixed(1) + '%').join(', ')}` : '已确认的属性差异待审阅'}</p>)}
      </>}
    </>}
  </div>
}
