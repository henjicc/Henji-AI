// @vitest-environment jsdom
import { act } from 'react-dom/test-utils'
import { createRoot, type Root } from 'react-dom/client'
import type { ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { resolveDeixis, type ExplanationBinding } from '@/core/creativeIntent/deixis'
import { buildIntentDifferencePlan } from '@/core/creativeIntent/intentPlan'
import type { PointerEvidence } from '@/core/creativeIntent/alignment'
import type { ClockSegment, Timeline } from '@/core/creativeIntent/contracts'
import type { TranscriptEntry } from '@/core/creativeIntent/schema'
import { ExplanationReview, type ExplanationReviewResult } from './ExplanationReview'

vi.mock('react-virtuoso', () => ({ Virtuoso: ({ data, itemContent }: { data: unknown[]; itemContent: (index: number, value: unknown) => ReactNode }) => <div>{data.map((value, index) => <div key={index}>{itemContent(index, value)}</div>)}</div> }))
let root: Root | undefined; let element: HTMLElement | undefined
afterEach(async () => { await act(async () => root?.unmount()); element?.remove(); root = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals() })
const a = { kind: 'video_edit.clip', id: 'owner:a', label: '同名' }; const b = { ...a, id: 'owner:b' }
const timeline: Timeline = { sequenceRef: { kind: 'video_edit.sequence', id: 'sequence' }, frame: 30, fps: { numerator: 30, denominator: 1 }, visitRef: 'visit' }
const clocks: ClockSegment[] = [{ id: 'clock', monoSpanUs: [0, 2_000_000], mode: 'hold', start: timeline, end: timeline, anchors: [] }]
const entry: TranscriptEntry = { kind: 'transcript', eventId: 'entry', seq: 10, monoUs: 1_000_000, timeline, clockSegmentRef: 'clock', utteranceId: 'utterance', wordId: 'word', text: '这个', audioSegmentRef: 'audio', startSample: 48000, endSample: 57600, monoSpanUs: [1_000_000, 1_200_000], timelineSpans: [{ monoSpanUs: [1_000_000, 1_200_000], clockSegmentRef: 'clock', start: timeline, end: timeline, evidenceSeqs: [1], quality: 'presented' }], granularity: 'word', alignmentQuality: 'precise', confidence: .99, source: 'asr' }
const pointer: PointerEvidence = { kind: 'pointer', eventId: 'point', seq: 1, monoUs: 900_000, timeline, clockSegmentRef: 'clock', surfaceRef: { kind: 'application.surface', id: 'workspace.video_edit' }, geometrySnapshotRef: 'geometry', viewPoint: [0, 0], documentPoint: [0, 0], compositionPoint: [.5, .5], hoverRefs: [a, b], pointedRefs: [a], selectedRefs: [a], intent: 'navigate', phase: 'down', uncertaintyUs: 0 }
async function mount(onRead: (entry: TranscriptEntry) => Promise<ExplanationReviewResult>, onBind = vi.fn(async (_entry: TranscriptEntry, _binding: ExplanationBinding) => {})) {
  element = document.createElement('div'); document.body.append(element); root = createRoot(element)
  await act(async () => root!.render(<ExplanationReview entry={entry} onRead={onRead} onBind={onBind} onError={error => { throw error }} />))
  await act(async () => element!.querySelector('button')!.click())
}
it('点击真实词显示历史缺图与重叠确认，改绑定使当前差异候选变化', async () => {
  let bindings: ExplanationBinding[] = []
  const read = vi.fn(async () => {
    const resolution = resolveDeixis([entry], [pointer], clocks, bindings)
    const target = resolution.mentions[0].selected?.targetRefs[0]
    const plan = buildIntentDifferencePlan([resolution], target ? [{ targetRef: target, property: 'position', value: [.8, .5], confirmed: true }] : [], [a, b].map((targetRef, index) => ({ targetRef, pose: { position: [.4 + index * .1, .5] as [number, number], rotationTurns: 0, scaleXY: [1, 1] as [number, number], pivot: [.5, .5] as [number, number] }, stateDigest: `sha256:${'1'.repeat(64)}` })), [])
    return { resolution, plan }
  })
  const bind = vi.fn(async (_entry: TranscriptEntry, binding: ExplanationBinding) => { bindings = [binding] })
  await mount(read, bind)
  expect(element!.textContent).toContain('指向重叠对象'); expect(element!.textContent).toContain('这处没有保存历史画面')
  const buttons = Array.from(element!.querySelectorAll('button')).filter(button => button.textContent?.startsWith('确认对象'))
  expect(buttons).toHaveLength(2)
  await act(async () => buttons[1].click())
  expect(bind.mock.calls[0][1].targetRefs).toEqual([b]); expect(element!.textContent).toContain('候选更新：1')
  expect(element!.textContent).toContain('从 50.0%, 50.0% 到 80.0%, 50.0%')
  await act(async () => Array.from(element!.querySelectorAll('button')).filter(button => button.textContent?.startsWith('确认对象'))[0].click())
  expect(element!.textContent).toContain('从 40.0%, 50.0% 到 80.0%, 50.0%')
})
it('关闭或卸载后迟到的私密结果不恢复旧稿，也不报读取错误', async () => {
  let finish!: (value: ExplanationReviewResult) => void
  const resolution = resolveDeixis([entry], [pointer], clocks)
  const result = { resolution, plan: buildIntentDifferencePlan([resolution], [], [], []) }
  await mount(() => new Promise(resolve => { finish = resolve }))
  await act(async () => element!.querySelector('button')!.click())
  await act(async () => finish(result))
  expect(element!.textContent).toBe('这个')
})
it('当前作品状态变化重读差异，旧基线的迟到结果不能覆盖新计划', async () => {
  let finish!: (value: ExplanationReviewResult) => void
  const resolution = resolveDeixis([entry], [pointer], clocks)
  const current = { resolution, plan: { changes: [], protectedRefs: [], issues: ['新状态需要确认'], status: 'blocked' as const, recordedOperationRefs: [] } }
  const read = vi.fn().mockImplementationOnce(() => new Promise<ExplanationReviewResult>(resolve => { finish = resolve })).mockResolvedValue(current)
  const bind = vi.fn(); const error = vi.fn()
  element = document.createElement('div'); document.body.append(element); root = createRoot(element)
  await act(async () => root!.render(<ExplanationReview entry={entry} onRead={read} onBind={bind} onError={error} initiallyOpen contextKey="before" />))
  await act(async () => root!.render(<ExplanationReview entry={entry} onRead={read} onBind={bind} onError={error} initiallyOpen contextKey="after" />))
  await act(async () => finish({ resolution, plan: { ...current.plan, issues: ['过期基线'] } }))
  expect(read).toHaveBeenCalledTimes(2); expect(element!.textContent).toContain('新状态需要确认'); expect(element!.textContent).not.toContain('过期基线')
})
