import { z } from 'zod'
import { applicationRefSchema } from '../application-control/identifiers'
import { findTranscriptSearchRanges, normalizeTranscriptSearch } from './transcriptSearch'
import { joinAudioEditText } from '../audioEdit/captions'
import { screenChangeSchema } from './screenChangeEvidence'

export const mediaContentKindSchema = z.enum(['transcript', 'caption', 'description', 'chapter', 'pause', 'scene', 'screen_change'])
export type MediaContentKind = z.infer<typeof mediaContentKindSchema>
export const mediaContentRangeSchema = z.object({ fromUs: z.number().int().nonnegative().safe(), toUs: z.number().int().nonnegative().safe() }).strict().refine(value => value.toUs >= value.fromUs, '源范围倒置。')
export type MediaContentRange = z.infer<typeof mediaContentRangeSchema>
export const mediaContentRecordSchema = z.object({
  id: z.string().min(1), kind: mediaContentKindSchema, text: z.string().max(4000), textTruncated: z.boolean(),
  ranges: z.array(mediaContentRangeSchema).max(128), rangeCount: z.number().int().nonnegative(),
  basis: z.enum(['saved', 'analysis', 'timeline', 'intent']), precision: z.enum(['word', 'segment', 'caption', 'interval', 'point']),
  originRef: applicationRefSchema, recordId: z.string().min(1), sourceVerified: z.boolean(),
  screenChange: screenChangeSchema.extend({ samplingFps: z.number().min(1).max(60), stage: z.enum(['coarse', 'refined']) }).strict().optional(),
}).strict()
export type MediaContentRecord = z.infer<typeof mediaContentRecordSchema>
/** Runtime observation only; this is never saved into a media/document file. */
export const mediaContentQueryProgressSchema = z.object({
  id: z.string().uuid(), state: z.enum(['running', 'completed', 'failed', 'cancelled']),
  phase: z.enum(['checking_source', 'listing_documents', 'reading_documents', 'checking_associated_sources', 'reading_text', 'analyzing_audio', 'analyzing_video', 'verifying_result', 'finished']),
  message: z.string().max(1000), completedUnits: z.number().int().nonnegative(), totalUnits: z.number().int().nonnegative().nullable(),
  phaseProgress: z.number().min(0).max(1).nullable(), updatedAt: z.string().datetime(), error: z.string().max(2000).optional(),
}).strict()
export type MediaContentQueryProgress = z.infer<typeof mediaContentQueryProgressSchema>
export type MediaContentQueryProgressUpdate = Pick<MediaContentQueryProgress, 'phase' | 'message'> & Partial<Pick<MediaContentQueryProgress, 'completedUnits' | 'totalUnits' | 'phaseProgress'>>
export interface MediaContentFact extends Omit<MediaContentRecord, 'textTruncated' | 'rangeCount' | 'sourceVerified'> {
  /** True only after this fact's source has been checked against the actual file. */
  sourceVerified?: boolean
  /** Only consecutive included words from the same source/stream share a phrase-search group. */
  transcriptGroup?: string
}
export interface MediaContentQuery { text?: string; fromUs?: number; toUs?: number; kinds?: readonly MediaContentKind[] }

/** Merge touching intervals, retaining gaps introduced by deleted source content. */
export function mergeMediaContentRanges(values: readonly MediaContentRange[]): MediaContentRange[] {
  const result: MediaContentRange[] = []
  for (const value of [...values].sort((a, b) => a.fromUs - b.fromUs || a.toUs - b.toUs)) {
    const previous = result.at(-1)
    if (previous && value.fromUs <= previous.toUs) previous.toUs = Math.max(previous.toUs, value.toUs)
    else result.push({ ...value })
  }
  return result
}

function combine(facts: readonly MediaContentFact[]): MediaContentFact {
  const first = facts[0]
  return { ...first, id: `${first.id}..${facts.at(-1)!.id}`, text: facts.reduce((text, fact) => joinAudioEditText(text, fact.text), ''),
    ranges: mergeMediaContentRanges(facts.flatMap(fact => fact.ranges)), sourceVerified: facts.every(fact => fact.sourceVerified === true), precision: facts.every(fact => fact.precision === 'word') ? 'word' : 'segment' }
}

/** Source facts and document projections share one bounded query model, not another persistence model. */
export function queryMediaContentIndex(facts: readonly MediaContentFact[], query: MediaContentQuery): MediaContentRecord[] {
  const kinds = new Set(query.kinds ?? mediaContentKindSchema.options)
  const groups = new Map<string, MediaContentFact[]>(); const selected: MediaContentFact[] = []
  const needle = query.text ? normalizeTranscriptSearch(query.text) : undefined
  if (query.text && !needle) throw new Error('检索文字须包含文字或数字。')
  for (const fact of facts) {
    if (!kinds.has(fact.kind)) continue
    if (fact.kind === 'transcript' && fact.transcriptGroup) {
      const group = groups.get(fact.transcriptGroup) ?? []; group.push(fact); groups.set(fact.transcriptGroup, group)
    } else if (!needle || normalizeTranscriptSearch(fact.text).includes(needle)) selected.push(fact)
  }
  for (const group of groups.values()) {
    // Providers preserve source word order and create a new group across excluded/protected boundaries.
    if (query.text) {
      for (const match of findTranscriptSearchRanges(group, query.text)) selected.push(combine(group.slice(match.start, match.end + 1)))
    } else {
      let chunk: MediaContentFact[] = []; let length = 0
      for (const fact of group) {
        if (chunk.length && (length + fact.text.length > 180 || chunk.length >= 32)) { selected.push(combine(chunk)); chunk = []; length = 0 }
        chunk.push(fact); length += fact.text.length
      }
      if (chunk.length) selected.push(combine(chunk))
    }
  }
  const fromUs = query.fromUs ?? 0; const toUs = query.toUs ?? Infinity
  return selected.filter(fact => fact.ranges.some(range => range.fromUs === range.toUs ? range.fromUs >= fromUs && range.fromUs < toUs : range.toUs > fromUs && range.fromUs < toUs))
    .sort((a, b) => (a.ranges[0]?.fromUs ?? 0) - (b.ranges[0]?.fromUs ?? 0) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id))
    .map(({ transcriptGroup: _group, ...fact }) => ({ ...fact, sourceVerified: fact.sourceVerified === true, text: fact.text.slice(0, 4000), textTruncated: fact.text.length > 4000, rangeCount: fact.ranges.length, ranges: fact.ranges.slice(0, 128) }))
}
