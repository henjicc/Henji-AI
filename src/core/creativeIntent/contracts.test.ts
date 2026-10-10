import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { clockEventIssue, clockSegmentSchema, motionDraftSchema, sampleSchema, sameCandidateInput, timelineSpanSchema } from './contracts'
import { commandEventSchema, deltaEventSchema, explanationSessionSchema, transcriptEventSchema, visualEvidenceSchema } from './schema'
import { creativeIntentPageSchema, readCreativeIntentPages } from './pages'
import { motionCandidateIdentity } from './candidates'
import { createMotionFixture, fixtureDigest, fixtureOwner, fixtureSequence } from './fixtures/motionFixtures'

const timeline = (frame: number, visitRef = 'v0'): { sequenceRef: typeof fixtureSequence; frame: number; fps: { numerator: number; denominator: number }; visitRef: string } => ({ sequenceRef: fixtureSequence, frame, fps: { numerator: 30, denominator: 1 }, visitRef })
const stamp = { seq: 1, monoUs: 100, timeline: timeline(120), clockSegmentRef: 'hold', eventId: 'e0' }
const hash = async (text: string): Promise<string> => `sha256:${createHash('sha256').update(text).digest('hex')}`

describe('creative intent contracts', () => {
  it('strict schemas reject illegal clocks, scales, unknown fields and foreign pins', () => {
    const f = createMotionFixture('S02'); expect(motionDraftSchema.parse(f.input.draft)).toEqual(f.input.draft)
    for (const patch of [{ monoUs: Number.MAX_SAFE_INTEGER + 1 }, { seq: -1 }, { monoUs: NaN }, { script: 'execute' }, { timeline: null }, { pose: { ...f.input.samples[0].pose, scaleXY: [0, 1] } }]) expect(sampleSchema.safeParse({ ...f.input.samples[0], ...patch }).success).toBe(false)
    const draft = structuredClone(f.input.draft); draft.pins[0].targetRef = { ...draft.pins[0].targetRef, id: 'foreign' }; expect(motionDraftSchema.safeParse(draft).success).toBe(false)
  })
  it('E01/E03: hold, reverse and zero-time seek coexist; requested does not replace presented', () => {
    const hold = { id: 'hold', monoSpanUs: [0, 1000], mode: 'hold', start: timeline(120), end: timeline(120), anchors: [{ monoUs: 100, presentedFrame: 120, requestedFrame: 180, sequenceRef: fixtureSequence, visitRef: 'v0', playbackDirection: 0, playbackRate: 1, playing: false, epoch: 0, uncertaintyUs: 10 }] }
    const parsed = clockSegmentSchema.parse(hold); expect(parsed.anchors[0].presentedFrame).toBe(120)
    expect(clockSegmentSchema.safeParse({ ...hold, end: timeline(121) }).success).toBe(false)
    expect(clockSegmentSchema.safeParse({ ...hold, start: null }).success).toBe(false)
    expect(clockSegmentSchema.safeParse({ ...hold, anchors: [{ ...hold.anchors[0], presentedFrame: 121 }] }).success).toBe(false)
    expect(clockSegmentSchema.safeParse({ ...hold, mode: 'scrub', start: timeline(180), end: timeline(120) }).success).toBe(true)
    expect(clockSegmentSchema.safeParse({ ...hold, mode: 'seek', monoSpanUs: [100, 100], end: timeline(120, 'v1') }).success).toBe(true)
    expect(clockSegmentSchema.safeParse({ id: 'gap', mode: 'gap', monoSpanUs: [1000, 2000], start: null, end: null, anchors: [] }).success).toBe(true)
    expect(clockSegmentSchema.safeParse({ ...hold, mode: 'gap' }).success).toBe(false)
  })
  it('E03: cross-seek sentences preserve real spans and segment granularity', () => {
    const utterance = { ...stamp, kind: 'transcript', utteranceId: 'u0', text: '从这里到那边', audioSegmentRef: 'audio0', startSample: 0, endSample: 16000, monoSpanUs: [0, 1000000], timelineSpans: [{ monoSpanUs: [0, 500000], clockSegmentRef: 'hold', start: timeline(120), end: timeline(120), evidenceSeqs: [1], quality: 'presented' }, { monoSpanUs: [500000, 1000000], clockSegmentRef: 'reverse', start: timeline(180, 'v1'), end: timeline(150, 'v1'), evidenceSeqs: [2], quality: 'presented' }], granularity: 'segment', alignmentQuality: 'coarse', source: 'asr' }
    expect(transcriptEventSchema.parse(utterance).timelineSpans).toHaveLength(2)
    expect(transcriptEventSchema.safeParse({ ...utterance, wordId: 'fake-word' }).success).toBe(false)
    expect(timelineSpanSchema.safeParse({ ...utterance.timelineSpans[0], end: timeline(120, 'v1') }).success).toBe(false)
  })
  it('E01/E02/E04: gaps accept only recording boundary facts, and static events keep null time', () => {
    const gap = clockSegmentSchema.parse({ id: 'gap', mode: 'gap', monoSpanUs: [1000, 2000], start: null, end: null, anchors: [] })
    const clocks = new Map([[gap.id, gap]])
    const boundary = { monoUs: 1000, timeline: null, clockSegmentRef: 'gap', kind: 'control', unavailableReason: 'gap' }
    expect(clockEventIssue(boundary, clocks)).toBeUndefined()
    expect(clockEventIssue({ ...boundary, monoUs: 1500 }, clocks)).toMatch('gap')
    expect(clockEventIssue({ ...boundary, kind: 'pointer' }, clocks)).toMatch('gap')
    const staticClock = clockSegmentSchema.parse({ id: 'static', mode: 'hold', monoSpanUs: [0, 1000], start: null, end: null, anchors: [] })
    expect(clockEventIssue({ ...boundary, monoUs: 20, clockSegmentRef: 'static', kind: 'pointer', unavailableReason: 'static' }, [staticClock])).toBeUndefined()
    const delta = { ...stamp, kind: 'delta', operationRef: { kind: 'operation.edit', id: 'move0' }, changes: [{ targetRef: fixtureOwner, property: 'position', before: [.1, .2], after: [.3, .4] }] }
    expect(deltaEventSchema.safeParse(delta).success).toBe(true)
    expect(deltaEventSchema.safeParse({ ...delta, changes: [{ ...delta.changes[0], after: 2 }] }).success).toBe(false)
  })
  it('E05: undo and redo append operation relationships; failed commands have no state changes', () => {
    const event = { ...stamp, kind: 'command', operationRef: { kind: 'operation.edit', id: 'undo0' }, phase: 'undo', relatedOperationRef: { kind: 'operation.edit', id: 'move0' }, targets: [fixtureOwner], beforeDigest: fixtureDigest, afterDigest: `sha256:${'b'.repeat(64)}` }
    expect(commandEventSchema.parse(event).relatedOperationRef?.id).toBe('move0')
    expect(commandEventSchema.safeParse({ ...event, relatedOperationRef: undefined }).success).toBe(false)
    expect(commandEventSchema.safeParse({ ...event, phase: 'failed' }).success).toBe(false)
  })
  it('E08: image manifest binds historical state and actual visit, without a frame count product cap', () => {
    const frame = { ...stamp, stateDigest: fixtureDigest, geometrySnapshotRef: 'geometry0', sourceRefs: [fixtureOwner], pointer: [.2, .3], reason: 'pointing', attachmentRect: [0, 0, 640, 360] }
    const evidence = { id: 'visual0', kind: 'frame', resourceRef: { resourceId: 'resource0', digest: fixtureDigest, bytes: 10 }, size: [640, 360], pixelBudget: 2500000, frames: [frame] }
    expect(visualEvidenceSchema.safeParse(evidence).success).toBe(true)
    expect(visualEvidenceSchema.safeParse({ ...evidence, frames: [{ ...frame, timeline: null }] }).success).toBe(false)
    expect(visualEvidenceSchema.safeParse({ ...evidence, pixelBudget: 100 }).success).toBe(false)
  })
  it('headers preserve private resources and forbid deleted audio references or fake recording consent', () => {
    const session = { id: 'session0', version: 1, ownerRef: fixtureOwner, createdAt: '2026-10-11T00:00:00Z', state: 'idle', mode: 'static', sourceDigest: fixtureDigest, retentionStatus: 'absent', clockSegments: [], pages: [], visualEvidenceRefs: [], bindings: [], segmentExclusions: [], corrections: [], annotationRefs: [], appliedReceiptRefs: [], finalPoseRefs: [] }
    expect(explanationSessionSchema.safeParse(session).success).toBe(true)
    expect(explanationSessionSchema.safeParse({ ...session, state: 'recording' }).success).toBe(false)
    expect(explanationSessionSchema.safeParse({ ...session, retentionStatus: 'deleted', audio: { resourceId: 'audio', digest: fixtureDigest, bytes: 1 } }).success).toBe(false)
  })
  it('candidate identities include draft, owner, baseline and geometry, regardless of target directory order', () => {
    const identity = motionCandidateIdentity(createMotionFixture('S02').input.draft)
    expect(sameCandidateInput(identity, structuredClone(identity))).toBe(true)
    const changed = structuredClone(identity); changed.targetBases[0].geometryDigest = `sha256:${'b'.repeat(64)}`; expect(sameCandidateInput(identity, changed)).toBe(false)
  })
})

describe('sealed page streaming', () => {
  const page = (entries = createMotionFixture('S02').input.samples.slice(0, 3)): zPage => ({ version: 1, ownerRef: fixtureOwner, sourceDigest: fixtureDigest, kind: 'samples', count: entries.length, monoSpanUs: [entries[0].monoUs, entries[entries.length - 1].monoUs], seqSpan: [entries[0].seq, entries[entries.length - 1].seq], entries })
  type zPage = { version: number; ownerRef: typeof fixtureOwner; sourceDigest: string; kind: string; count: number; monoSpanUs: number[]; seqSpan: number[]; entries: ReturnType<typeof createMotionFixture>['input']['samples'] }
  it('rejects count mismatch, duplicate sequence, reverse wall clock and missing null reasons', () => {
    const p = page(); expect(creativeIntentPageSchema.safeParse(p).success).toBe(true)
    expect(creativeIntentPageSchema.safeParse({ ...p, count: 9 }).success).toBe(false)
    expect(creativeIntentPageSchema.safeParse({ ...p, entries: [p.entries[1], p.entries[0], p.entries[2]] }).success).toBe(false)
  })
  it('reads consecutive pages lazily, verifies checksums and rejects truncated pages', async () => {
    const samples = createMotionFixture('S02').input.samples; let produced = 0
    async function* source(): AsyncGenerator<{ text: string; digest: string }> { for (const range of [[0, 3], [3, 6]]) { produced++; const text = JSON.stringify(page(samples.slice(...range))); yield { text, digest: await hash(text) } } }
    const reader = readCreativeIntentPages(source(), { ownerRef: fixtureOwner, sourceDigest: fixtureDigest, hash })
    expect(produced).toBe(0); expect((await reader.next()).value?.count).toBe(3); expect(produced).toBe(1)
    expect((await reader.next()).value?.seqSpan).toEqual([3, 5]); expect((await reader.next()).done).toBe(true)
    async function* damaged(): AsyncGenerator<{ text: string; digest: string }> { yield { text: '{', digest: fixtureDigest } }
    await expect(readCreativeIntentPages(damaged(), { ownerRef: fixtureOwner, sourceDigest: fixtureDigest, hash }).next()).rejects.toThrow('page-digest')
    async function* truncated(): AsyncGenerator<{ text: string; digest: string }> { yield { text: '{', digest: await hash('{') } }
    await expect(readCreativeIntentPages(truncated(), { ownerRef: fixtureOwner, sourceDigest: fixtureDigest, hash }).next()).rejects.toThrow()
    await expect(readCreativeIntentPages(source(), { ownerRef: { ...fixtureOwner, id: 'foreign' }, sourceDigest: fixtureDigest, hash }).next()).rejects.toThrow('page-owner')
  })
})
