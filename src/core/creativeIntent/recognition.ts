import type { PreparedTake } from './sampling'

export interface MotionEvidence { kind: 'dwell' | 'overshoot'; frames: [number, number]; sampleIds: string[] }
/** Conservative P1 evidence. No cycle/spring classification or inferred animation from wall-clock holds. */
export function recognizeMotionEvidence(take: PreparedTake): MotionEvidence[] {
  const events: MotionEvidence[] = []; const p = take.points
  let start = -1
  const same = (a: number, b: number): boolean => JSON.stringify(p[a].pose) === JSON.stringify(p[b].pose)
  for (let i = 1; i < p.length; i++) {
    if (same(i - 1, i) && start < 0) start = i - 1
    if (start >= 0 && (!same(i - 1, i) || i === p.length - 1)) {
      const end = same(i - 1, i) ? i : i - 1
      if (end > start && p[end].frame > p[start].frame) events.push({ kind: 'dwell', frames: [p[start].frame, p[end].frame], sampleIds: [...p[start].sampleIds, ...p[end].sampleIds] })
      start = -1
    }
  }
  if (p.length < 3) return events
  const from = p[0].pose.position; const to = p[p.length - 1].pose.position; const dx = to[0] - from[0]; const dy = to[1] - from[1]; const distance = dx * dx + dy * dy
  if (distance < 1e-8) return events
  const projection = p.map(v => ((v.pose.position[0] - from[0]) * dx + (v.pose.position[1] - from[1]) * dy) / distance)
  const peak = projection.reduce((max, v) => Math.max(max, v), -Infinity); const i = projection.indexOf(peak)
  if (peak > 1.005 && i > 0 && i < p.length - 1) events.push({ kind: 'overshoot', frames: [p[i].frame, p[i].frame], sampleIds: p[i].sampleIds })
  return events
}
