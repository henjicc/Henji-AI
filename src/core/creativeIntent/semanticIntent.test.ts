import { describe, expect, it, vi } from 'vitest'
import { createMotionFixture } from './fixtures/motionFixtures'
import { reviewSemanticIntent, requestSemanticIntent, semanticIntentPlanSchema } from './semanticIntent'
import { semanticRecordingInput, semanticRecordingEvents } from './semanticIntentRecording'
import { recordingFixtureSession } from './fixtures/recordingFixtures'
import type { DeixisResolution } from './deixis'
import type { TranscriptEntry, ExplanationEvent } from './schema'
import type { CreativeIntentPage } from './pages'

const fixture = () => createMotionFixture('S01').input.draft
const plan = () => { const draft = fixture(); return { draftDigest: draft.sourceDigest, actions: [{ kind: 'motion' as const, targetRef: draft.targets[0].ref, takeId: draft.takes[0].id, intent: { kind: 'move_line' as const, from: [.1, .2], to: [.7, .2] } }], protectedRefs: [], questions: [] } }
const lines = async function* () { yield '{"kind":"header"}' }
describe('语义意图封闭计划与授权', () => {
  it('权限拒绝时 provider 和本地修改均为零', async () => {
    const propose = vi.fn(), local = vi.fn()
    await expect(requestSemanticIntent({ draft: fixture(), resolutions: [], lines: lines(), authorize: async () => false, propose, local })).rejects.toThrow('PERMISSION_DENIED')
    expect(propose).not.toHaveBeenCalled(); expect(local).not.toHaveBeenCalled()
  })
  it('歧义先请求用户确认，未调用模型', async () => {
    const propose = vi.fn(), local = vi.fn()
    const resolution: DeixisResolution = { text: '这里停一下', mentions: [], issues: ['请确认停留区间'], negated: false }
    const result = await requestSemanticIntent({ draft: fixture(), resolutions: [resolution], lines: lines(), authorize: async () => true, propose, local })
    expect(result.status).toBe('confirmation_required'); expect(propose).not.toHaveBeenCalled()
  })
  it('封闭 schema 拒绝 pins、任意命令和未知属性；合法结果不改原稿', () => {
    const draft = fixture(), before = structuredClone(draft)
    expect(semanticIntentPlanSchema.safeParse({ ...plan(), pins: [] }).success).toBe(false)
    expect(semanticIntentPlanSchema.safeParse({ ...plan(), execute: 'anything' }).success).toBe(false)
    expect(reviewSemanticIntent(plan(), draft, []).status).toBe('candidate')
    expect(draft).toEqual(before)
    expect(reviewSemanticIntent({ ...plan(), draftDigest: `sha256:${'0'.repeat(64)}` }, draft, []).status).toBe('local_fallback')
  })
  it('“别动它”即使模型遗漏保护也不能执行', () => {
    const draft = fixture()
    const resolution = { text: '别动它', negated: true, issues: [], mentions: [{ selected: { targetRefs: [draft.targets[0].ref] }, candidates: [], issues: [] }] } as unknown as DeixisResolution
    const result = reviewSemanticIntent(plan(), draft, [resolution])
    expect(result.status).toBe('confirmation_required'); expect(result.protectedRefs).toEqual([draft.targets[0].ref]); expect(result.plan).toBeUndefined()
  })
  it.each([new Error('provider failed'), { invalid: true }])('失败或非法输出仅回退本地一次，收费调用不重试', async output => {
    const propose = vi.fn(async () => { if (output instanceof Error) throw output; return output }), local = vi.fn(async () => {})
    const result = await requestSemanticIntent({ draft: fixture(), resolutions: [], lines: lines(), authorize: async () => true, propose, local })
    expect(result.status).toBe('local_fallback'); expect(propose).toHaveBeenCalledTimes(1); expect(local).toHaveBeenCalledTimes(1)
  })
  it('慢一点不自行推断结束帧，取消不回退或重放', async () => {
    const draft = fixture()
    expect(reviewSemanticIntent({ ...plan(), actions: [{ kind: 'slower', targetRef: draft.targets[0].ref, takeId: draft.takes[0].id, factor: 2 }] }, draft, []).status).toBe('confirmation_required')
    const controller = new AbortController(), local = vi.fn()
    await expect(requestSemanticIntent({ draft, resolutions: [], lines: lines(), signal: controller.signal, authorize: async () => true, propose: async () => { controller.abort(); throw new Error('cancelled') }, local })).rejects.toThrow()
    expect(local).not.toHaveBeenCalled()
  })
  it('正文授权前不读任何资源；纯文本投影不包含原音和图片', async () => {
    const session = recordingFixtureSession(), read = vi.fn()
    expect(() => semanticRecordingInput(session, read, [1920, 1080])).toThrow('PERMISSION_DENIED')
    expect(read).not.toHaveBeenCalled()
    session.consent!.textUpload = true
    session.audio = { resourceId: 'secret-audio', digest: session.sourceDigest, bytes: 48 }
    const output: string[] = []
    for await (const line of semanticRecordingInput(session, read, [1920, 1080])) output.push(line)
    expect(output.join('\n')).not.toContain('secret-audio')
    expect(JSON.parse(output.at(-1)!)).toMatchObject({ imageAttachments: [], execution: expect.stringContaining('preview-only') })
  })
  it('分页采用最后一次文字校正，保留真实时间，排除删除片段并核对页归属', async () => {
    const session = recordingFixtureSession('static')
    const original: TranscriptEntry = { kind: 'transcript', eventId: 'original', seq: 0, monoUs: 100, timeline: null, unavailableReason: 'static', clockSegmentRef: 'clock', text: '移动它', utteranceId: 'u', audioSegmentRef: 'audio', startSample: 0, endSample: 100, monoSpanUs: [100, 200], timelineSpans: [], granularity: 'segment', alignmentQuality: 'coarse', source: 'asr' }
    const records: TranscriptEntry[] = [original, { ...original, eventId: 'excluded', utteranceId: 'deleted', seq: 1, monoUs: 300, startSample: 100, endSample: 200, monoSpanUs: [300, 400] },
      { ...original, eventId: 'correction-1', seq: 2, originalEventRef: original.eventId, source: 'user', text: '移动这个' },
      { ...original, eventId: 'correction-2', seq: 3, originalEventRef: original.eventId, source: 'user', text: '别动它' }]
    const pages = new Map<string, CreativeIntentPage>()
    for (const entry of records) {
      const page: CreativeIntentPage = { kind: 'transcript', version: 1, ownerRef: session.ownerRef, sourceDigest: session.sourceDigest, monoSpanUs: [entry.monoUs, entry.monoUs], seqSpan: [entry.seq, entry.seq], count: 1, entries: [entry] }
      pages.set(entry.eventId, page)
      session.pages.push({ resourceId: entry.eventId, digest: session.sourceDigest, bytes: 1, kind: page.kind, monoSpanUs: page.monoSpanUs, seqSpan: page.seqSpan, count: 1 })
    }
    session.corrections = [{ originalEventRef: original.eventId, correctedEventRef: 'correction-1' }, { originalEventRef: original.eventId, correctedEventRef: 'correction-2' }]
    session.segmentExclusions = [{ audioSegmentRef: 'audio', sampleSpan: [100, 200] }]
    const read = vi.fn(async (id: string) => pages.get(id)), events: ExplanationEvent[] = []
    for await (const event of semanticRecordingEvents(session, read)) events.push(event)
    expect(events).toEqual([{ ...original, eventId: 'correction-2', originalEventRef: original.eventId, source: 'user', text: '别动它' }])
    pages.set('original', { ...pages.get('original')!, ownerRef: { kind: 'document.video_edit', id: 'another' } })
    await expect(semanticRecordingEvents(session, read).next()).rejects.toThrow('来源不匹配')
  })
})
