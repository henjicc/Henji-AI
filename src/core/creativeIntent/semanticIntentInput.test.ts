import { expect, it } from 'vitest'
import { semanticVisualBatches, scaleSemanticVisual } from './semanticIntentInput'
import { explanationSessionSchema, type VisualEvidence } from './schema'

const digest = `sha256:${'a'.repeat(64)}`
const visual = (seq: number): VisualEvidence => ({ id: `image-${seq}`, kind: 'frame', resourceRef: { resourceId: `image-${seq}`, digest, bytes: 10 },
  size: [1280, 720], pixelBudget: 1280 * 720, frames: [{ eventId: `pointer-${seq}`, seq, monoUs: seq, timeline: null, unavailableReason: 'static', clockSegmentRef: 'static', stateDigest: digest,
    geometrySnapshotRef: 'geometry', sourceRefs: [], pointer: [.5, .25], reason: 'appearance', attachmentRect: [0, 0, 1280, 720] }] })
it('necessary visuals are batched without dropping unresolved history or merging distinct visits', () => {
  const visuals = Array.from({ length: 17 }, (_, seq) => visual(seq))
  const session = explanationSessionSchema.parse({ id: 'session', version: 1, ownerRef: { kind: 'image_edit.document', id: 'v3:doc' }, createdAt: new Date().toISOString(), state: 'reviewing', mode: 'static', sourceDigest: digest, retentionStatus: 'absent',
    clockSegments: [{ id: 'static', monoSpanUs: [0, 20], mode: 'hold', start: null, end: null, anchors: [] }], pages: [], visualEvidenceRefs: [...visuals, visuals[0]], bindings: [], segmentExclusions: [], corrections: [], annotationRefs: [], appliedReceiptRefs: [], finalPoseRefs: [] })
  expect(semanticVisualBatches(session, [])).toEqual([])
  const batches = semanticVisualBatches(session, [{ text: '调整颜色和构图', mentions: [], issues: [], negated: false }])
  expect(batches.flat().map(v => v.id)).toEqual(visuals.map(v => v.id))
  expect(batches.every(batch => batch.length <= 6)).toBe(true)
  const scaled = scaleSemanticVisual(visuals[0], 640, 360)
  expect(scaled.frames[0].attachmentRect).toEqual([0, 0, 640, 360])
  expect(scaled.frames[0].pointer).toEqual([.5, .25])
  expect(() => scaleSemanticVisual(visuals[0], 2000, 2000)).toThrow('预算')
  const sheet = { ...visuals[0], kind: 'contact-sheet' as const, frames: visuals.map(v => v.frames[0]) }
  const split = semanticVisualBatches({ ...session, visualEvidenceRefs: [sheet] }, [{ text: '调整构图', mentions: [], issues: [], negated: false }])
  expect(split.flat().flatMap(v => v.frames).map(f => f.seq)).toEqual(visuals.map(v => v.frames[0].seq))
  expect(split.every(batch => batch.length <= 3)).toBe(true)
})
