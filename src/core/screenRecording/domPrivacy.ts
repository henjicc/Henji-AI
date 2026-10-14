import type { CaptureEvent } from '../captureLog/events'
import type { PrivacyCandidate } from './privacy'
/** DOM snapshots terminate at the next snapshot/control barrier and never cross missing media or pauses. */
export function recordingDomPrivacyCandidates(events: readonly CaptureEvent[], media: readonly { id: string; kind: string; monoUs: number; durationUs: number }[], id: () => string): PrivacyCandidate[] {
  const snapshots = events.filter(e => e.kind === 'sensitive' || e.kind === 'control').sort((a, b) => a.monoUs - b.monoUs)
  const result: PrivacyCandidate[] = [], active = new Map<string, PrivacyCandidate>()
  for (const [index, event] of snapshots.entries()) {
    if (event.kind !== 'sensitive') { active.clear(); continue }
    const nextUs = snapshots[index + 1]?.monoUs ?? Infinity, next = new Map<string, PrivacyCandidate>()
    for (const region of event.regions) for (const source of media.filter(m => m.kind === 'screen')) {
      const startUs = Math.max(event.monoUs, source.monoUs), endUs = Math.min(nextUs, source.monoUs + source.durationUs)
      if (endUs <= startUs) continue
      const key = `${source.id}:${region.id}`, previous = active.get(key)
      const candidate = previous?.endUs === startUs ? previous : { id: id(), mediaId: source.id, kind: 'password' as const, hint: 'password · ••••', fingerprint: '0'.repeat(64), startUs, endUs, status: 'pending' as const, samples: [] }
      if (candidate !== previous) result.push(candidate)
      const last = candidate.samples.at(-1), previousUs = startUs - 100000
      if (last && previousUs > last.monoUs && JSON.stringify(last.box) !== JSON.stringify(region.box)) candidate.samples.push({ ...last, monoUs: previousUs })
      candidate.endUs = endUs
      if (candidate.samples.at(-1)?.monoUs !== startUs) candidate.samples.push({ monoUs: startUs, box: region.box, confidence: 1 })
      next.set(key, candidate)
    }
    active.clear(); for (const [key, value] of next) active.set(key, value)
  }
  return result
}
