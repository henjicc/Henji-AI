import { describe, expect, it } from 'vitest'
import { alignExplanationEntry, nearestPointBaseline, type PointerEvidence } from './alignment'
import { confirmedExplanationBinding, pickedExplanationBinding, resolveDeixis } from './deixis'
import { buildIntentDifferencePlan } from './intentPlan'
import type { ClockSegment, Pose, Timeline } from './contracts'
import type { ExplanationEvent, TranscriptEntry } from './schema'

const a = { kind: 'video_edit.clip', id: 'owner:a', label: '同名' }; const b = { ...a, id: 'owner:b' }
const timeline: Timeline = { sequenceRef: { kind: 'video_edit.sequence', id: 'owner:sequence' }, frame: 30, fps: { numerator: 30, denominator: 1 }, visitRef: 'visit-1' }
const clocks: ClockSegment[] = [{ id: 'clock-1', monoSpanUs: [0, 10_000_000], mode: 'hold', start: timeline, end: timeline, anchors: [] }]
function speech(text = '这里', overrides: Partial<TranscriptEntry> = {}): TranscriptEntry {
  return { kind: 'transcript', seq: 100, eventId: 'word-1', monoUs: 1_000_000, timeline, clockSegmentRef: 'clock-1', text, wordId: 'word-1', utteranceId: 'utterance-1', audioSegmentRef: 'audio-1', startSample: 48000, endSample: 57600, monoSpanUs: [1_000_000, 1_200_000], timelineSpans: [{ monoSpanUs: [1_000_000, 1_200_000], clockSegmentRef: 'clock-1', start: timeline, end: timeline, quality: 'presented', evidenceSeqs: [1] }], granularity: 'word', alignmentQuality: 'precise', source: 'asr', confidence: .99, ...overrides }
}
function pointer(overrides: Partial<PointerEvidence> = {}): PointerEvidence {
  return { kind: 'pointer', seq: 1, eventId: 'pointer-1', monoUs: 900_000, timeline, clockSegmentRef: 'clock-1', surfaceRef: { kind: 'application.surface', id: 'workspace.video_edit' }, geometrySnapshotRef: 'geometry-1', viewPoint: [50, 50], documentPoint: [640, 360], compositionPoint: [.5, .5], hoverRefs: [a], pointedRefs: [a], selectedRefs: [b], intent: 'navigate', phase: 'down', uncertaintyUs: 1000, ...overrides }
}
const positive = ['这里', '这个', '那边', '从这里', '到那边', '停在这里两秒', '退出到那边']
describe('受控评测：最近点基线对比（语义模型能力不在此分数内）', () => {
  it.each(positive)('单一真实指向 %s', text => {
    const entry = speech(text); const point = pointer(); const result = resolveDeixis([entry], [point], clocks)
    expect(result.mentions[0].selected?.targetRefs).toEqual([a]); expect(result.mentions[0].issues).toEqual([])
    expect(nearestPointBaseline(entry, [point])?.pointedRefs).toEqual([a])
  })
  const negatives: { name: string; entry?: TranscriptEntry; points: PointerEvidence[]; clock?: ClockSegment[] }[] = [
    { name: '重叠同名', points: [pointer({ hoverRefs: [a, b] })] },
    { name: '多个不同位置', points: [pointer(), pointer({ seq: 2, monoUs: 1_100_000, compositionPoint: [.8, .5] })] },
    { name: '菜单点击', points: [pointer({ monoUs: 1_100_000, compositionPoint: null, hoverRefs: [], pointedRefs: [] })] },
    { name: '先指后点菜单', points: [pointer(), pointer({ seq: 2, monoUs: 1_100_000, compositionPoint: null, hoverRefs: [], pointedRefs: [] })] },
    { name: '时间线点击', points: [pointer({ monoUs: 1_100_000, compositionPoint: null, hoverRefs: [], pointedRefs: [], selectedRefs: [a] })] },
    { name: '低置信度', entry: speech('这个', { confidence: .3 }), points: [pointer()] },
    { name: '句级粗时间', entry: speech('从这里到那边', { granularity: 'segment', wordId: undefined, alignmentQuality: 'coarse' }), points: [pointer()] },
    { name: '未知时间', entry: speech('这里', { alignmentQuality: 'unavailable' }), points: [pointer()] },
    { name: '刚才那个', entry: speech('刚才那个'), points: [pointer()] },
    { name: '旧visit同帧', points: [pointer({ timeline: { ...timeline, visitRef: 'visit-old' } })] },
    { name: '录音gap', points: [pointer()], clock: [{ ...clocks[0], monoSpanUs: [0, 1_050_000] }, { id: 'gap', monoSpanUs: [1_050_000, 1_150_000], mode: 'gap', start: null, end: null, anchors: [] }, { ...clocks[0], id: 'clock-2', monoSpanUs: [1_150_000, 10_000_000] }] },
    { name: '误识别听一下', entry: speech('这个听一下'), points: [pointer()] },
    { name: '未说明停留', entry: speech('这里停一下'), points: [pointer()] },
    { name: '未说明离开', entry: speech('这个弹出来'), points: [pointer()] },
    { name: '离开这里仍缺方向', entry: speech('离开这里'), points: [pointer()] },
    { name: '单次指向不能猜成起点和终点', entry: speech('从这到那'), points: [pointer()] },
  ]
  it.each(negatives)('关键歧义拦截 $name', sample => {
    const entry = sample.entry ?? speech(); const result = resolveDeixis([entry], sample.points, sample.clock ?? clocks)
    expect(result.issues.length > 0 || result.mentions.some(mention => !mention.selected)).toBe(true)
    // Baseline always picks a point, so it refuses none of these critical ambiguity cases.
    expect(nearestPointBaseline(entry, sample.points)).toBeDefined()
  })
  it('固定评测分母为7个明确样本、16个关键歧义；本方法23/23，最近点7/23', () => {
    expect(positive).toHaveLength(7); expect(negatives).toHaveLength(16)
    const accepted = positive.filter(text => resolveDeixis([speech(text)], [pointer()], clocks).mentions[0].selected).length
    const intercepted = negatives.filter(sample => { const result = resolveDeixis([sample.entry ?? speech()], sample.points, sample.clock ?? clocks); return result.issues.length || result.mentions.some(mention => !mention.selected) }).length
    expect({ accepted, intercepted }).toEqual({ accepted: 7, intercepted: 16 })
  })
})
it('不插值，句内source/destination分别使用真实词的时段，先指后说也保留', () => {
  const entries = [speech('从'), speech('这里', { eventId: 'word-2', wordId: 'word-2' }), speech('到', { monoSpanUs: [3_000_000, 3_100_000] }), speech('那边', { eventId: 'word-4', wordId: 'word-4', monoSpanUs: [3_100_000, 3_300_000] })]
  const result = resolveDeixis(entries, [pointer(), pointer({ seq: 2, monoUs: 3_000_000, compositionPoint: [.8, .5], hoverRefs: [], pointedRefs: [] })], clocks)
  expect(result.mentions.map(mention => [mention.slot, mention.selected?.point])).toEqual([['source', [.5, .5]], ['destination', [.8, .5]]])
  expect(alignExplanationEntry(entries[1], [pointer()], clocks).pointers[0].monoUs).toBe(900_000)
})
it('从这到那使用两个有序槽；指代跨字符词边界时绑定保留全部真实词引用', () => {
  const simple = resolveDeixis([speech('从这到那')], [pointer()], clocks)
  expect(simple.mentions.map(value => value.slot)).toEqual(['source', 'destination'])
  expect(simple.mentions.every(value => !value.selected)).toBe(true)
  const zeroBindings = simple.mentions.map(mention => confirmedExplanationBinding(mention, mention.candidates[0], mention.slot === 'source' ? a : undefined))
  expect(resolveDeixis([speech('从这到那')], [pointer()], clocks, zeroBindings).mentions.every(value => value.confirmedByUser)).toBe(true)
  const entries = [speech('这', { monoSpanUs: [1_000_000, 1_050_000] }), speech('个', { eventId: 'second', wordId: 'second', monoSpanUs: [1_100_000, 1_200_000] })]
  const point = pointer({ hoverRefs: [a, b] })
  const mention = resolveDeixis(entries, [point], clocks).mentions[0]
  const binding = confirmedExplanationBinding(mention, mention.candidates[0], b)
  expect(binding.wordIds).toEqual(['word-1', 'second'])
  expect(resolveDeixis(entries, [point], clocks, [binding]).mentions[0].confirmedByUser).toBe(true)
  expect(resolveDeixis(entries, [point], clocks, [{ ...binding, wordIds: ['word-1'] }]).mentions[0].selected).toBeUndefined()
})
it('明确停留和离开方向读成槽位，不把停录间隔或弹出来猜成时间与方向', () => {
  const parsed = resolveDeixis([speech('停在这里2.5秒后向右退出')], [pointer()], clocks)
  expect(parsed.dwellSeconds).toBe(2.5); expect(parsed.exitDirection).toBe('right'); expect(parsed.issues).toEqual([])
  const chinese = resolveDeixis([speech('停在这里两秒')], [pointer()], clocks)
  expect(chinese.dwellSeconds).toBe(2)
  expect(resolveDeixis([speech('停在这里')], [pointer()], clocks).issues).toContain('停留时长未说明，不能用录音暂停时长替代')
  expect(resolveDeixis([speech('停在这里-2秒')], [pointer()], clocks).dwellSeconds).toBeUndefined()
  expect(resolveDeixis([speech('停在这里1e3秒')], [pointer()], clocks).dwellSeconds).toBeUndefined()
  expect(buildIntentDifferencePlan([parsed], [], [], []).status).toBe('blocked')
})
it('校正重叠绑定后候选改变；伪造目标、证据或visit不能确认', () => {
  const entry = speech('这个'); const point = pointer({ hoverRefs: [a, b] })
  const initial = resolveDeixis([entry], [point], clocks); const mention = initial.mentions[0]
  expect(mention.selected).toBeUndefined()
  const binding = confirmedExplanationBinding(mention, mention.candidates[0], b)
  expect(resolveDeixis([entry], [point], clocks, [binding]).mentions[0].selected?.targetRefs).toEqual([b])
  expect(resolveDeixis([entry], [point], clocks, [{ ...binding, evidenceSeqs: [99] }]).mentions[0].selected).toBeUndefined()
  expect(resolveDeixis([entry], [point], clocks, [{ ...binding, timelineSpans: [] }]).mentions[0].selected).toBeUndefined()
  expect(() => confirmedExplanationBinding(mention, mention.candidates[0], { ...a, id: 'fake' })).toThrow()
})
const pose: Pose = { position: [.5, .5], rotationTurns: 0, scaleXY: [1, 1], pivot: [.5, .5] }; const digest = `sha256:${'1'.repeat(64)}`
it('否定句不能转肯定目标；混合否定也不偷偷执行', () => {
  for (const text of ['别动它', '不要移动这个', '不许动那个', '别动它，再移这个']) {
    const resolution = resolveDeixis([speech(text)], [pointer()], clocks)
    const plan = buildIntentDifferencePlan([resolution], [{ targetRef: a, property: 'position', value: [.8, .5], confirmed: true }], [{ targetRef: a, pose, stateDigest: digest }], [])
    expect(resolution.negated).toBe(true); expect(plan.changes).toEqual([]); expect(plan.status).toBe('blocked')
  }
})
it('move/undo/redo只保留来源，当前已经满足零差异，删除和过期基线阻断', () => {
  const resolution = resolveDeixis([speech('移动这个')], [pointer()], clocks)
  const events: ExplanationEvent[] = ['committed', 'undo', 'redo'].map((phase, seq) => ({ kind: 'command', eventId: `command-${seq}`, seq: seq + 2, monoUs: 1_100_000, timeline, clockSegmentRef: 'clock-1', operationRef: { kind: 'video_edit.operation', id: `operation-${seq}` }, phase: phase as 'committed' | 'undo' | 'redo', beforeDigest: digest, afterDigest: digest, targets: [a] }))
  const goal = { targetRef: a, property: 'position' as const, value: pose.position, confirmed: true }
  const satisfied = buildIntentDifferencePlan([resolution], [goal], [{ targetRef: a, pose, stateDigest: digest }], events)
  expect(satisfied.status).toBe('satisfied'); expect(satisfied.changes).toEqual([]); expect(satisfied.recordedOperationRefs).toHaveLength(3)
  const difference = buildIntentDifferencePlan([resolution], [{ ...goal, value: [.8, .5] }], [{ targetRef: a, pose, stateDigest: digest }], events)
  expect(difference.changes).toEqual([{ targetRef: a, property: 'position', before: [.5, .5], after: [.8, .5], expectedDigest: digest }])
  expect(buildIntentDifferencePlan([resolution], [goal], [], events).status).toBe('blocked')
  expect(buildIntentDifferencePlan([resolution], [goal], [{ targetRef: a, pose, stateDigest: 'stale' }], events).status).toBe('blocked')
})

const staticClocks: ClockSegment[] = [{ id: 'static-clock', monoSpanUs: [0, 10_000_000], mode: 'hold', start: null, end: null, anchors: [] }]
const imageA = { kind: 'image_edit.layer', id: 'image:a', label: '主图' }
function staticSpeech(text: string, span: [number, number] = [1_000_000, 1_200_000], extra: Partial<TranscriptEntry> = {}): TranscriptEntry {
  return speech(text, { timeline: null, unavailableReason: 'static', clockSegmentRef: 'static-clock', monoSpanUs: span, timelineSpans: [{ monoSpanUs: span, clockSegmentRef: 'static-clock', start: null, end: null, quality: 'unavailable', evidenceSeqs: [] }], ...extra })
}
function staticPointer(extra: Partial<PointerEvidence> = {}): PointerEvidence {
  return pointer({ timeline: null, unavailableReason: 'static', clockSegmentRef: 'static-clock', hoverRefs: [imageA], pointedRefs: [imageA], selectedRefs: [imageA], ...extra })
}
it('静态墙钟对齐对象和目标位置，不伪造剪辑时间线', () => {
  const entries = [staticSpeech('把这个'), staticSpeech('放到那边', [3_100_000, 3_300_000], { eventId: 'second', wordId: 'second' })]
  const events = [staticPointer(), staticPointer({ seq: 2, monoUs: 3_000_000, compositionPoint: [.8, .5], hoverRefs: [], pointedRefs: [] })]
  const result = resolveDeixis(entries, events, staticClocks)
  expect(result.issues).toEqual([])
  expect(result.mentions.map(m => [m.slot, m.selected?.point])).toEqual([['target', [.5, .5]], ['destination', [.8, .5]]])
  expect(result.mentions.every(m => m.selected?.timeline === null)).toBe(true)
  const binding = confirmedExplanationBinding(result.mentions[0], result.mentions[0].candidates[0], imageA)
  expect(binding.timelineSpans[0]).toMatchObject({ start: null, end: null, quality: 'coarse' })
  expect(resolveDeixis(entries, events, staticClocks, [binding]).mentions[0].confirmedByUser).toBe(true)
  const plan = buildIntentDifferencePlan([result], [{ targetRef: imageA, property: 'position', value: [.8, .5], confirmed: true }], [{ targetRef: imageA, pose, stateDigest: digest }], [])
  expect(plan.status).toBe('review'); expect(plan.changes[0].after).toEqual([.8, .5])
})
it('静态这几个使用当时选中集合；重叠命中仍需确认，不能借菜单或缺口补指向', () => {
  const targets = [imageA, { ...imageA, id: 'image:b' }, { ...imageA, id: 'image:c' }]
  const entry = staticSpeech('这几个等距'), event = staticPointer({ selectedRefs: targets })
  const parsed = resolveDeixis([entry], [event], staticClocks)
  expect(parsed.mentions).toHaveLength(1); expect(parsed.mentions[0].text).toBe('这几个'); expect(parsed.mentions[0].selected?.targetRefs).toEqual(targets)
  const binding = confirmedExplanationBinding(parsed.mentions[0], parsed.mentions[0].candidates[0])
  expect(resolveDeixis([entry], [event], staticClocks, [binding]).mentions[0].selected?.targetRefs).toEqual(targets)
  expect(resolveDeixis([staticSpeech('这个')], [staticPointer({ hoverRefs: targets })], staticClocks).mentions[0].selected).toBeUndefined()
  expect(alignExplanationEntry(entry, [staticPointer({ compositionPoint: null })], staticClocks).pointers).toEqual([])
  expect(resolveDeixis([entry], [event, staticPointer({ seq: 2, monoUs: 1_100_000, compositionPoint: null })], staticClocks).mentions[0].selected?.targetRefs).toEqual(targets)
  expect(alignExplanationEntry(entry, [staticPointer({ unavailableReason: 'missing-presentation' })], staticClocks).pointers).toEqual([])
  expect(alignExplanationEntry(entry, [event], [{ ...staticClocks[0], mode: 'gap' }]).pointers).toEqual([])
})
it('人工画面点选是显式校正，不制造历史指针；词稿变化后校正失效', () => {
  const entry = staticSpeech('这个', undefined, { granularity: 'segment', wordId: undefined, alignmentQuality: 'coarse' })
  const mention = resolveDeixis([entry], [], staticClocks).mentions[0]
  const binding = pickedExplanationBinding(mention, [imageA], [.6, .4])
  const confirmed = resolveDeixis([entry], [], staticClocks, [binding]).mentions[0]
  expect(confirmed.confirmedByUser).toBe(true); expect(confirmed.selected).toMatchObject({ evidenceSeqs: [], pointer: null, targetRefs: [imageA] })
  expect(() => pickedExplanationBinding(mention, [], [.6, .4])).toThrow('对象')
  expect(() => pickedExplanationBinding(mention, [imageA], [2, .4])).toThrow('画面')
  expect(resolveDeixis([{ ...entry, utteranceId: 'new' }], [], staticClocks, [binding]).mentions[0].selected).toBeUndefined()
})
