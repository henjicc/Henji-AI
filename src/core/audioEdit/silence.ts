import { subtractRanges } from './edits'
import { audioEditWordGaps, buildAudioEditTimeline } from './timeline'
import type { AudioEditBatchSettings, AudioEditProjectDocument, AudioEditRange, AudioEditSuggestion } from './types'

type SilenceDocument = Pick<AudioEditProjectDocument, 'source' | 'transcript' | 'cuts'>

/** 声学证据先投影到成片，只有实际相邻的安静片段才能共同构成一个停顿。 */
export function audioEditSilenceSuggestions(
  document: SilenceDocument, intervals: readonly AudioEditRange[], settings: AudioEditBatchSettings, range?: AudioEditRange,
): AudioEditSuggestion[] {
  const spans = buildAudioEditTimeline(document.source.durationFrames, document.transcript, document.cuts)
  const evidence: AudioEditRange[] = []
  const ordered = [...intervals, ...(document.cuts ?? []).filter((cut) => cut.enabled && cut.mode === 'mute')].sort((a, b) => a.startFrame - b.startFrame)
  let pauseIndex = 0
  for (const span of spans) {
    while (pauseIndex < ordered.length && ordered[pauseIndex].endFrame <= span.sourceStartFrame) pauseIndex++
    for (let k = pauseIndex; k < ordered.length && ordered[k].startFrame < span.sourceEndFrame; k++) {
      const startFrame = Math.max(span.sourceStartFrame, ordered[k].startFrame), endFrame = Math.min(span.sourceEndFrame, ordered[k].endFrame)
      if (endFrame > startFrame) evidence.push({ startFrame, endFrame })
    }
  }
  // 接缝里没有保留的词，声学证据确认有停顿后，把念坏那遍遗留的碎字一并视为待清理的气口。
  const seams = audioEditWordGaps(document.transcript, spans).filter(({ previous, next, seam }) => seam
    && evidence.some((pause) => pause.startFrame < next.startFrame && pause.endFrame > previous.endFrame))
    .map(({ previous, next }) => ({ startFrame: previous.endFrame, endFrame: next.startFrame }))
  const safe = subtractRanges([...ordered, ...seams], document.transcript.filter((block) => block.included || block.locked))
    .sort((a, b) => a.startFrame - b.startFrame)
  const quiet: AudioEditRange[] = []
  for (const part of safe) {
    const last = quiet.at(-1)
    if (last && part.startFrame <= last.endFrame) last.endFrame = Math.max(last.endFrame, part.endFrame)
    else quiet.push({ ...part })
  }
  const pauses: Array<AudioEditRange & { length: number; outputStart: number; outputEnd: number; seam: boolean }> = []
  let index = 0
  for (const span of spans) {
    while (index < quiet.length && quiet[index].endFrame <= span.sourceStartFrame) index++
    for (let k = index; k < quiet.length && quiet[k].startFrame < span.sourceEndFrame; k++) {
      const startFrame = Math.max(span.sourceStartFrame, quiet[k].startFrame), endFrame = Math.min(span.sourceEndFrame, quiet[k].endFrame)
      if (endFrame <= startFrame) continue
      const outputStart = span.outputStartFrame + startFrame - span.sourceStartFrame, outputEnd = outputStart + endFrame - startFrame
      const last = pauses.at(-1)
      if (last && outputStart === last.outputEnd) {
        last.seam ||= startFrame > last.endFrame
        last.endFrame = endFrame; last.outputEnd = outputEnd; last.length += endFrame - startFrame
      } else pauses.push({ startFrame, endFrame, outputStart, outputEnd, length: endFrame - startFrame, seam: false })
    }
  }
  const threshold = settings.silenceThresholdMs * document.source.sampleRate / 1000
  const retained = Math.round(settings.retainedSilenceMs * document.source.sampleRate / 1000)
  const duration = spans.at(-1)?.outputEndFrame ?? 0
  return pauses.filter((pause) => pause.length > retained && (pause.seam || pause.length >= threshold)
    && (settings.trimEdges || (pause.outputStart > 0 && pause.outputEnd < duration))
    && (!range || (pause.startFrame >= range.startFrame && pause.endFrame <= range.endFrame)))
    .map(({ startFrame, endFrame }) => ({ startFrame, endFrame, id: `silence:${startFrame}:${endFrame}`, kind: 'long_silence', evidence: 'audio',
      title: '压缩停顿', detail: `保留 ${settings.retainedSilenceMs} 毫秒气口`, blockIds: [], confidence: 'high', status: 'pending' }))
}
