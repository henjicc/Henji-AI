import type {
  AudioEditTimelineSpan,
  AudioEditTranscriptBlock,
} from './types'

function clampFrame(frame: number, durationFrames: number): number {
  if (!Number.isFinite(frame)) return 0
  return Math.max(0, Math.min(durationFrames, Math.round(frame)))
}

/**
 * Compile non-destructive transcript decisions into retained source spans.
 * Coordinates are integer PCM frames and all intervals are left-closed/right-open.
 */
export function buildAudioEditTimeline(
  durationFrames: number,
  blocks: readonly AudioEditTranscriptBlock[],
): AudioEditTimelineSpan[] {
  const duration = Math.max(0, Math.round(durationFrames))
  if (duration === 0) return []

  const removed = blocks
    .filter((block) => !block.included)
    .map((block) => ({
      start: clampFrame(Math.min(block.startFrame, block.endFrame), duration),
      end: clampFrame(Math.max(block.startFrame, block.endFrame), duration),
    }))
    .filter((range) => range.end > range.start)
    .sort((left, right) => left.start - right.start || left.end - right.end)

  const merged: Array<{ start: number; end: number }> = []
  for (const range of removed) {
    const previous = merged.at(-1)
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end)
    } else {
      merged.push({ ...range })
    }
  }

  const spans: AudioEditTimelineSpan[] = []
  let sourceCursor = 0
  let outputCursor = 0
  for (const range of merged) {
    if (range.start > sourceCursor) {
      const length = range.start - sourceCursor
      spans.push({
        sourceStartFrame: sourceCursor,
        sourceEndFrame: range.start,
        outputStartFrame: outputCursor,
        outputEndFrame: outputCursor + length,
      })
      outputCursor += length
    }
    sourceCursor = Math.max(sourceCursor, range.end)
  }
  if (sourceCursor < duration) {
    const length = duration - sourceCursor
    spans.push({
      sourceStartFrame: sourceCursor,
      sourceEndFrame: duration,
      outputStartFrame: outputCursor,
      outputEndFrame: outputCursor + length,
    })
  }
  return spans
}

export function editedDurationFrames(spans: readonly AudioEditTimelineSpan[]): number {
  return spans.at(-1)?.outputEndFrame ?? 0
}

export function outputFrameToSourceFrame(
  outputFrame: number,
  spans: readonly AudioEditTimelineSpan[],
): number | null {
  if (spans.length === 0) return null
  const target = Math.max(0, Math.round(outputFrame))
  const span = spans.find((candidate) => target >= candidate.outputStartFrame && target < candidate.outputEndFrame)
    ?? (target === editedDurationFrames(spans) ? spans.at(-1) : undefined)
  if (!span) return null
  return Math.min(
    span.sourceEndFrame,
    span.sourceStartFrame + Math.max(0, target - span.outputStartFrame),
  )
}

export function sourceFrameToOutputFrame(
  sourceFrame: number,
  spans: readonly AudioEditTimelineSpan[],
): number | null {
  const target = Math.max(0, Math.round(sourceFrame))
  const span = spans.find((candidate) => target >= candidate.sourceStartFrame && target < candidate.sourceEndFrame)
    ?? (target === spans.at(-1)?.sourceEndFrame ? spans.at(-1) : undefined)
  if (!span) return null
  return Math.min(
    span.outputEndFrame,
    span.outputStartFrame + Math.max(0, target - span.sourceStartFrame),
  )
}

export function nextRetainedSourceFrame(
  sourceFrame: number,
  spans: readonly AudioEditTimelineSpan[],
): number | null {
  const target = Math.max(0, Math.round(sourceFrame))
  const containing = spans.find((span) => target >= span.sourceStartFrame && target < span.sourceEndFrame)
  if (containing) return target
  return spans.find((span) => span.sourceStartFrame >= target)?.sourceStartFrame ?? null
}

export function findTranscriptBlockAtSourceFrame(
  sourceFrame: number,
  blocks: readonly AudioEditTranscriptBlock[],
  includeRemoved: boolean,
): AudioEditTranscriptBlock | null {
  const frame = Math.max(0, Math.round(sourceFrame))
  return blocks.find((block) =>
    (includeRemoved || block.included)
    && frame >= block.startFrame
    && frame < block.endFrame
  ) ?? null
}

/**
 * Resolve the transcript block that should remain highlighted while audio plays.
 * ASR word timestamps commonly leave tiny gaps between adjacent words, so retain
 * the preceding block across a small, explicit tolerance instead of flickering.
 */
export function findTranscriptBlockForPlayback(
  sourceFrame: number,
  blocks: readonly AudioEditTranscriptBlock[],
  includeRemoved: boolean,
  gapToleranceFrames: number,
): AudioEditTranscriptBlock | null {
  const exact = findTranscriptBlockAtSourceFrame(sourceFrame, blocks, includeRemoved)
  if (exact) return exact
  const frame = Math.max(0, Math.round(sourceFrame))
  const tolerance = Math.max(0, Math.round(gapToleranceFrames))
  let previous: AudioEditTranscriptBlock | null = null
  for (const block of blocks) {
    if ((!includeRemoved && !block.included) || block.endFrame > frame) continue
    if (!previous || block.endFrame > previous.endFrame) previous = block
  }
  return previous && frame - previous.endFrame <= tolerance ? previous : null
}
