import { z } from 'zod'
import type { RecordingDocument } from './document'
import { recordingRange } from './range'
import type { RecordingRange, RecordingUnderstanding } from './understanding'

export const recordingMovieRecipeSchema = z.object({
  trimPauses: z.boolean().default(true), trimFillers: z.boolean().default(true),
  waitSpeed: z.union([z.literal(1), z.literal(4), z.literal(8)]).default(4),
  attention: z.enum(['off', 'light', 'medium', 'strong']).default('medium'),
  cursor: z.boolean().default(true), captions: z.boolean().default(true), steps: z.boolean().default(true),
  camera: z.enum(['off', 'circle', 'person']).default('circle'),
  // 录屏默认不加画框（用户 2026-10-24：只录了一个窗口时缩小放在背景上即可，画框要明确要求才加）
  frame: z.boolean().default(false),
  normalizeAudio: z.boolean().default(true),
  formats: z.array(z.enum(['landscape', 'portrait', 'square'])).min(1).max(3).default(['landscape']).refine(v => new Set(v).size === v.length, '画幅不能重复'),
}).strict()
export type RecordingMovieRecipe = z.infer<typeof recordingMovieRecipeSchema>
export const RECORDING_MOVIE_RECIPES = {
  tutorial: recordingMovieRecipeSchema.parse({}),
  concise: recordingMovieRecipeSchema.parse({ waitSpeed: 8, attention: 'strong' }),
  original: recordingMovieRecipeSchema.parse({ trimPauses: false, trimFillers: false, waitSpeed: 1, attention: 'off', frame: false }),
}
export interface RecordingMovieSpan extends RecordingRange { outputStartUs: number; outputEndUs: number; speed: number }
function overlaps(ranges: readonly RecordingRange[]): (range: RecordingRange) => boolean {
  const sorted = [...ranges].sort((a, b) => a.startUs - b.startUs), ends: number[] = []
  for (const range of sorted) ends.push(Math.max(ends.at(-1) ?? 0, range.endUs))
  return range => {
    let left = 0, right = sorted.length
    while (left < right) { const mid = (left + right) >>> 1; if (sorted[mid].startUs < range.endUs) left = mid + 1; else right = mid }
    return left > 0 && ends[left - 1] > range.startUs
  }
}

/** One global edit map drives every sound/picture/text lane. Gaps remain gaps, never fabricated footage. */
export function recordingMovieSpans(recording: RecordingDocument, understanding: RecordingUnderstanding, recipe: RecordingMovieRecipe): RecordingMovieSpan[] {
  if (!recording.media.some(v => v.durationUs > 0)) throw new Error('会话没有可生成的原片。')
  const { startUs: origin, endUs: end } = recordingRange(recording)
  const speech = overlaps(understanding.transcript), protectedWords = overlaps(understanding.transcript.filter(t => t.protected || t.granularity !== 'word'))
  const changes = understanding.candidates.flatMap(candidate => {
    if (candidate.status === 'rejected') return []
    const cut = candidate.kind === 'mistake' ? candidate.status === 'accepted' : candidate.kind === 'pause' ? recipe.trimPauses : candidate.kind === 'filler' && recipe.trimFillers
    const speed = cut ? 0 : candidate.kind === 'wait' ? recipe.waitSpeed : 1
    if (speed === 1) return []
    // Sentence-level ASR and protected words never license destructive word cuts; speech is not waiting.
    if (candidate.status !== 'accepted' && (candidate.kind === 'filler' ? protectedWords(candidate) : speech(candidate))) return []
    const start = Math.max(origin, candidate.startUs), stop = Math.min(end, candidate.endUs)
    return stop > start ? [{ start, stop, speed }] : []
  })
  const edges = changes.flatMap((value, id) => [{ time: value.start, id, speed: value.speed, add: true }, { time: value.stop, id, speed: value.speed, add: false }]).sort((a, b) => a.time - b.time)
  const active = new Map<number, number>(), result: RecordingMovieSpan[] = []
  let previous = origin, output = 0
  const append = (stop: number): void => {
    const speed = active.has(0) ? 0 : active.has(8) ? 8 : active.has(4) ? 4 : 1
    if (stop > previous && speed) {
      const duration = (stop - previous) / speed
      const last = result.at(-1)
      if (last && last.endUs === previous && last.speed === speed) { last.endUs = stop; last.outputEndUs = output + duration }
      else result.push({ startUs: previous, endUs: stop, outputStartUs: output, outputEndUs: output + duration, speed })
      output += duration
    }
    previous = stop
  }
  for (const edge of edges) { append(edge.time); const count = (active.get(edge.speed) ?? 0) + (edge.add ? 1 : -1); if (count) active.set(edge.speed, count); else active.delete(edge.speed) }
  append(end)
  if (!result.length) throw new Error('配方会剪掉全部内容，请保留至少一个片段。')
  return result
}
export function mapRecordingMovieRange(spans: readonly RecordingMovieSpan[], range: RecordingRange): Array<RecordingRange & { outputStartUs: number; outputEndUs: number; speed: number }> {
  return spans.flatMap(span => {
    const startUs = Math.max(range.startUs, span.startUs), endUs = Math.min(range.endUs, span.endUs)
    return endUs > startUs ? [{ startUs, endUs, outputStartUs: span.outputStartUs + (startUs - span.startUs) / span.speed, outputEndUs: span.outputStartUs + (endUs - span.startUs) / span.speed, speed: span.speed }] : []
  })
}
