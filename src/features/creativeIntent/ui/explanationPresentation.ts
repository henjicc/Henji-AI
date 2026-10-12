import { useCallback, useEffect, useRef, useState } from 'react'
import type { TranscriptEntry } from '@/core/creativeIntent/schema'
import type { ExplanationReviewResult } from './ExplanationReview'

const FIRST_RECORDING_KEY = 'henji-explanation-recorded'
/** A presentation preference only; no audio, transcript or object reference is stored. */
export function useExplanationHasRecorded(recorded: boolean): boolean {
  const [seen, setSeen] = useState(() => {
    try { return recorded || localStorage.getItem(FIRST_RECORDING_KEY) === 'true' } catch { return recorded }
  })
  useEffect(() => {
    if (!recorded) return
    setSeen(true)
    try { localStorage.setItem(FIRST_RECORDING_KEY, 'true') } catch { /* The current mount still remembers the first recording. */ }
  }, [recorded])
  return seen || recorded
}

/** Internal issues have one user-facing home: the expanded word's evidence. */
export function explanationIssue(issues: readonly string[]): string | undefined {
  if (issues.some(issue => /置信度|误识别/.test(issue))) return '请先校正这句文字'
  if (issues.some(issue => /缺口/.test(issue))) return '这句录音有中断，请点选对象'
  if (issues.some(issue => /粗时间|句级|作品时间/.test(issue))) return '这句时间不够精确，请点选对象'
  if (issues.some(issue => /重叠/.test(issue))) return '这里有几个对象重叠，请选一个'
  if (issues.some(issue => /指向|历史对象|呈现画面/.test(issue))) return '说这句时没有指向画面，请点选对象'
  return issues.length ? '请点选这句对应的对象或位置' : undefined
}

export function explanationPosition(point: readonly number[]): string {
  const horizontal = point[0] < .35 ? '左' : point[0] > .65 ? '右' : ''
  const vertical = point[1] < .35 ? '上' : point[1] > .65 ? '下' : ''
  return horizontal && vertical ? `${horizontal}${vertical}方` : horizontal ? `${horizontal}侧` : vertical ? `${vertical}方` : '中央'
}

export function explanationChanges(result: ExplanationReviewResult): string[] {
  const label = (ref: ExplanationReviewResult['plan']['protectedRefs'][number]): string => result.objects?.find(object => object.ref.kind === ref.kind && object.ref.id === ref.id)?.label ?? ref.label ?? '已确认对象'
  return [
    ...result.plan.protectedRefs.map(ref => `不改动：${label(ref)}`),
    ...(result.layout ? [`${result.layout.targetRefs.length} 张图片 ${result.layout.action === 'distribute' ? '等距排列' : '对齐'}`] : []),
    ...result.plan.changes.map(change => `${label(change.targetRef)} ${change.property === 'position' && Array.isArray(change.after) ? `移到${explanationPosition(change.after)}` : change.property === 'rotationTurns' ? '调整角度' : change.property === 'scaleXY' ? '调整大小' : '调整中心'}`),
  ]
}

export function explanationDuration(elapsedUs: number): string {
  const seconds = Math.floor(elapsedUs / 1e6)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** Storage pages are batches, never pages in the user's transcript. */
export function useExplanationTranscript(key: string | undefined, readPage: (index: number) => Promise<TranscriptEntry[]>, pageCount: number | undefined, onError: (error: unknown) => void): { entries: TranscriptEntry[]; loading: boolean; retry: () => void } {
  const [data, setData] = useState<{ key?: string; entries: TranscriptEntry[]; loading: boolean }>({ entries: [], loading: false })
  const [attempt, setAttempt] = useState(0)
  const generation = useRef(0)
  const retry = useCallback((): void => { generation.current++; setAttempt(value => value + 1) }, [])
  useEffect(() => {
    let current = true
    const reading = ++generation.current
    setData({ key, entries: [], loading: !!key })
    if (key) void (async () => {
      const seen = new Set<string>()
      for (let index = 0; pageCount === undefined || index < pageCount; index++) {
        const batch = await readPage(index)
        if (!current || reading !== generation.current) return
        if (pageCount === undefined && !batch.length) break
        const fresh = batch.filter(entry => !seen.has(entry.eventId))
        fresh.forEach(entry => seen.add(entry.eventId))
        setData(previous => ({ key, entries: [...previous.entries, ...fresh], loading: true }))
      }
      if (current && reading === generation.current) setData(previous => ({ ...previous, loading: false }))
    })().catch(error => { if (current && reading === generation.current) { setData(previous => ({ ...previous, loading: false })); onError(error) } })
    return () => { current = false }
  }, [key, readPage, pageCount, onError, attempt])
  return { ...(data.key === key ? data : { entries: [], loading: !!key }), retry }
}

