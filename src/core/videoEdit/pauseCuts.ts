export interface VideoEditPauseCutOptions {
  range?: { from: number; to: number }
  searchMs?: number
  retainedMs?: number
}
export interface VideoEditPauseCutCandidate {
  boundary: 'start' | 'end'
  targetFrame: number
  cutFrame: number
  retainedFromFrame: number
  retainedToFrame: number
}

/** Proposals only: both the cut and retained breath stay inside observed, inward-rounded quiet frames. */
export function videoEditPauseCutCandidates(pauses: readonly { startFrame: number; endFrame: number; kind: string; cutFrame?: number }[], fps: number, options: VideoEditPauseCutOptions): VideoEditPauseCutCandidate[] {
  if (!options.range) return []
  const radius = (options.searchMs ?? 300) * fps / 1000
  const retained = Math.max(0, Math.ceil((options.retainedMs ?? 120) * fps / 1000))
  const candidates: VideoEditPauseCutCandidate[] = []
  for (const boundary of ['start', 'end'] as const) {
    const targetFrame = boundary === 'start' ? options.range.from : options.range.to
    const pause = pauses.filter(value => value.kind === 'silence' && value.cutFrame !== undefined && Math.abs(value.cutFrame - targetFrame) <= radius)
      .sort((a, b) => Math.abs(a.cutFrame! - targetFrame) - Math.abs(b.cutFrame! - targetFrame) || a.cutFrame! - b.cutFrame!)[0]
    if (!pause || pause.cutFrame === undefined) continue
    const retainedToFrame = Math.min(pause.endFrame, Math.max(pause.startFrame + retained, pause.cutFrame + Math.ceil(retained / 2)))
    candidates.push({ boundary, targetFrame, cutFrame: pause.cutFrame, retainedFromFrame: Math.max(pause.startFrame, retainedToFrame - retained), retainedToFrame })
  }
  return candidates
}
