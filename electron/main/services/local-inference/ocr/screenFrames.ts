import { ffmpegFrames } from '../frameReader'
import { ppocrInputSize } from '../analyzers/textDetection'
import { changedTiles } from './frameChanges'
import type { OcrPrivacyJob } from './protocol'
import { availableParallelism } from 'node:os'
import type { PrivacyBox } from '../../../../../src/core/screenRecording/privacy'

// The CRF23 encoded still fixture differs by at most 8/255 in a handful of scan pixels across I/P frames.
// Keep every larger difference (no minimum changed area); compare against the accepted reference so edits accumulate.
export const SCREEN_CODEC_NOISE = 8

/** Compress consecutive selected indices, preserving the original ten-Hz frame clock through FFmpeg select. */
export function frameSelection(indices: readonly number[]): string {
  const ranges: string[] = []
  for (let i = 0; i < indices.length; i++) {
    const start = indices[i]; let end = start
    while (indices[i + 1] === end + 1) end = indices[++i]
    ranges.push(start === end ? `eq(n,${start})` : `between(n,${start},${end})`)
  }
  // av_expr has a bounded recursive parser; a flat sum of hundreds of terms exceeds it.
  let terms = ranges
  while (terms.length > 16) {
    const groups: string[] = []
    for (let i = 0; i < terms.length; i += 16) groups.push(`(${terms.slice(i, i + 16).join('+')})`)
    terms = groups
  }
  return terms.join('+') || '0'
}

/**
 * Scan at the detector's resolution, then decode only selected original-resolution frames.
 * The other instants reuse the last immutable pixels: no OCR crop ever comes from the small scan.
 * Codec noise is bounded per channel against the last accepted image (not just the previous image),
 * so gradual edits accumulate. Moving cursors are removed from the comparison reference using its
 * previous background; stationary pointers are compared normally, including visible edits beneath them.
 */
export async function* screenOcrFrames(job: OcrPrivacyJob, signal: AbortSignal, progress: (done: number, total: number) => void, onChanges?: (changes: readonly PrivacyBox[]) => void): AsyncGenerator<Uint8Array> {
  const size = ppocrInputSize(job.display.width, job.display.height), sx = size.width / job.display.width, sy = size.height / job.display.height
  const indices: number[] = [], cursor = job.cursor ?? [], total = Math.ceil(job.durationSeconds * job.fps)
  const selectedChanges: PrivacyBox[][] = []
  let reference: Uint8Array | undefined, previousPoint: [number, number] | null = null, ci = -1, count = 0
  const options = { decodeThreads: Math.min(6, availableParallelism()), filterThreads: 2 }
  for await (const rgb of ffmpegFrames(job.ffmpegPath, job, size, signal, undefined, options)) {
    signal.throwIfAborted()
    const time = job.startUs + Math.round(count * 1e6 / job.fps)
    while (ci + 1 < cursor.length && cursor[ci + 1].monoUs <= time) ci++
    const rawPoint = ci < 0 ? null : cursor[ci].point
    const point: [number, number] | null = rawPoint ? [rawPoint[0] * sx, rawPoint[1] * sy] : null
    const moving = point && (!previousPoint || point[0] !== previousPoint[0] || point[1] !== previousPoint[1])
    const scale = Math.max(sx, sy)
    const changes = changedTiles(reference, rgb, size.width, size.height, moving ? [point] : [], { noiseTolerance: SCREEN_CODEC_NOISE, cursorScale: scale })
    if (changes.length) {
      indices.push(count); selectedChanges.push(changes)
      if (reference && moving) {
        const clean = rgb.slice(), left = Math.min(size.width, Math.max(0, Math.floor(point[0] - 8 * scale))), right = Math.max(0, Math.min(size.width, Math.ceil(point[0] + 48 * scale)))
        for (let y = Math.max(0, Math.floor(point[1] - 8 * scale)); y < Math.min(size.height, Math.ceil(point[1] + 48 * scale)); y++) {
          const start = (y * size.width + left) * 3, end = (y * size.width + right) * 3
          clean.set(reference.subarray(start, end), start)
        }
        reference = clean
      } else reference = rgb
    }
    previousPoint = point
    count++; progress(count, total)
  }
  if (!count) return
  reference = undefined
  // The scan already proved the tail unchanged. Do not decode that tail a second time just to reach EOF.
  const originalJob = { ...job, durationSeconds: Math.min(job.durationSeconds, (indices.at(-1)! + 1) / job.fps) }
  const selected = ffmpegFrames(job.ffmpegPath, originalJob, job.display, signal, frameSelection(indices), { ...options, recycleBuffers: 2 })[Symbol.asyncIterator]()
  let current: Uint8Array | undefined, next = 0
  try {
    for (let index = 0; index < count; index++) {
      signal.throwIfAborted()
      if (indices[next] === index) {
        const frame = await selected.next()
        if (frame.done) throw new Error('文字识别原图取帧不完整。')
        current = frame.value; onChanges?.(selectedChanges[next]); next++
      } else onChanges?.([])
      yield current!
    }
  } finally { await selected.return?.(undefined) }
}
