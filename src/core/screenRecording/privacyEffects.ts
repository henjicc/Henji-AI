import type { PrivacyBox, PrivacyCandidate } from './privacy'
import { videoEditEffectSchema, type VideoEditEffect } from '../videoEdit/compositing'
import type { VideoEditMaskPoint } from '../videoEdit/maskPathAnimation'

function points([x, y, w, h]: PrivacyBox): VideoEditMaskPoint[] { return [[x, y, 0, 0, 0, 0], [x + w, y, 0, 0, 0, 0], [x + w, y + h, 0, 0, 0, 0], [x, y + h, 0, 0, 0, 0]] }
const hidden: VideoEditMaskPoint[] = [[2, 2, 0, 0, 0, 0], [3, 2, 0, 0, 0, 0], [3, 3, 0, 0, 0, 0], [2, 3, 0, 0, 0, 0]]
/** Source-anchored masks use the existing preview/export path; trim/retime/reverse need no new renderer. */
export function privacyCandidateEffect(candidate: PrivacyCandidate, mediaOriginUs: number, enabled = candidate.status === 'accepted'): VideoEditEffect {
  const keys = candidate.samples.map((sample, i) => {
    const next = candidate.samples[i + 1]?.box
    const [x, y, w, h] = sample.box
    // Cover the swept box between neighboring observations; do not expose moving letters between sampled frames.
    const box: PrivacyBox = next ? [Math.min(x, next[0]), Math.min(y, next[1]), Math.max(x + w, next[0] + next[2]) - Math.min(x, next[0]), Math.max(y + h, next[1] + next[3]) - Math.min(y, next[1])] : sample.box
    return { sourceTimeUs: sample.monoUs - mediaOriginUs, points: points(box), interpolation: 'hold' as const }
  })
  if (keys[0].sourceTimeUs > 0) keys.unshift({ sourceTimeUs: 0, points: hidden, interpolation: 'hold' })
  keys.push({ sourceTimeUs: candidate.endUs - mediaOriginUs, points: hidden, interpolation: 'hold' })
  return videoEditEffectSchema.parse({ id: `privacy:${candidate.id}`, name: `敏感信息 · ${candidate.hint}`, enabled, amount: 1,
    builtin: { id: 'mosaic', params: {} }, mask: { regionId: 'shapes', shapes: [{ id: candidate.id, kind: 'rect', points: points(candidate.samples[0].box), feather: 0, expand: 0,
      pathAnimation: { pointIds: ['tl', 'tr', 'br', 'bl'], keys } }] } })
}
export interface ConfirmedPrivacyFragment { mediaId: string; startUs: number; endUs: number; effect: VideoEditEffect }
/** 2.4 consumes this pure bridge while placing/slicing screen media. Pending/rejected candidates never become active masks. */
export function confirmedRecordingPrivacyFragments(candidates: readonly PrivacyCandidate[], media: readonly { id: string; monoUs: number }[]): ConfirmedPrivacyFragment[] {
  return candidates.filter(c => c.status === 'accepted').map(c => { const source = media.find(m => m.id === c.mediaId); if (!source) throw new Error('打码候选的原片不存在，请重新分析。'); return { mediaId: c.mediaId, startUs: c.startUs, endUs: c.endUs, effect: privacyCandidateEffect(c, source.monoUs) } })
}
