import type { ExplanationSession } from '../schema'
export function recordingFixtureSession(mode: ExplanationSession['mode'] = 'animated'): ExplanationSession {
  return { id: 'fixture-recording', version: 1, ownerRef: { kind: 'document.video_edit', id: 'fixture-document' }, createdAt: '2026-10-11T00:00:00.000Z', state: 'consenting', mode, sourceDigest: `sha256:${'1'.repeat(64)}`, consent: { noticeDigest: `sha256:${'2'.repeat(64)}`, userReceiptRef: 'fixture-consent', capture: true, keepAudio: false, audioUpload: false, textUpload: false, imageUpload: false }, retentionStatus: 'temporary', clockSegments: [], pages: [], visualEvidenceRefs: [], bindings: [], segmentExclusions: [], corrections: [], annotationRefs: [], appliedReceiptRefs: [], finalPoseRefs: [] }
}
