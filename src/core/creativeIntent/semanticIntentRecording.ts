import { creativeIntentPageSchema } from './pages'
import { serializeRecordingInput } from './recordingSerializer'
import { refKey, type CreativeIntentPageRef } from './contracts'
import { resolveDeixis, type DeixisResolution } from './deixis'
import type { ExplanationEvent, ExplanationSession, TranscriptEntry } from './schema'
type ReadPage = (resourceId: string) => Promise<unknown>
async function readRecordingPage(session: ExplanationSession, ref: CreativeIntentPageRef, read: ReadPage) {
  const page = creativeIntentPageSchema.parse(await read(ref.resourceId))
  if (page.kind !== ref.kind || refKey(page.ownerRef) !== refKey(session.ownerRef) || page.sourceDigest !== session.sourceDigest) throw new Error('讲解页来源不匹配。')
  return page
}

/** Shared private recording projection for Pi; reads bounded pages, excludes original audio. */
export async function* semanticRecordingEvents(session: ExplanationSession, read: ReadPage): AsyncGenerator<ExplanationEvent> {
  const corrections = new Map(session.corrections.map(c => [c.originalEventRef, c.correctedEventRef]))
  const kinds = [...new Set(session.pages.map(p => p.kind))].filter(k => !['clock', 'samples', 'audio'].includes(k))
  const streams = kinds.map(kind => (async function* (): AsyncGenerator<ExplanationEvent> {
    for (const ref of session.pages.filter(p => p.kind === kind)) {
      const page = await readRecordingPage(session, ref, read)
      if (page.kind === 'clock' || page.kind === 'samples' || page.kind === 'audio') continue
      for (const original of page.entries) {
        if (original.kind !== 'transcript') { yield original; continue }
        if (original.source === 'user') continue
        if (session.segmentExclusions.some(e => e.audioSegmentRef === original.audioSegmentRef && e.sampleSpan[0] < original.endSample && original.startSample < e.sampleSpan[1])) continue
        const replacement = corrections.get(original.eventId)
        let corrected: TranscriptEntry | undefined
        if (replacement) for (const candidate of session.pages.filter(p => p.kind === 'transcript')) {
          const correctedPage = await readRecordingPage(session, candidate, read)
          if (correctedPage.kind === 'transcript') corrected = correctedPage.entries.find(e => e.eventId === replacement && e.originalEventRef === original.eventId && e.source === 'user') ?? corrected
          if (corrected) break
        }
        if (replacement && !corrected) throw new Error('校正后的词稿缺失，请恢复原记录。')
        yield corrected ? { ...original, text: corrected.text, source: corrected.source, eventId: corrected.eventId, originalEventRef: original.eventId } : original
      }
    }
  })())
  const heads = await Promise.all(streams.map(s => s.next()))
  while (heads.some(h => !h.done)) {
    let index = -1
    heads.forEach((h, i) => { if (!h.done && (index < 0 || h.value.monoUs < heads[index].value!.monoUs || h.value.monoUs === heads[index].value!.monoUs && h.value.seq < heads[index].value!.seq)) index = i })
    yield heads[index].value!; heads[index] = await streams[index].next()
  }
}
export function semanticRecordingInput(session: ExplanationSession, read: ReadPage, size: [number, number]) {
  if (!session.consent?.textUpload) throw new Error('PERMISSION_DENIED:请先在录制宿主确认讲解文字外发范围。')
  return (async function* () {
  let record = 0
  for await (const line of serializeRecordingInput(session, semanticRecordingEvents(session, read), { size, includeImages: false })) {
    // A single very long utterance is split, never truncated or rejected as a product limit.
    if (line.length <= 8000) yield line
    else for (let offset = 0; offset < line.length; offset += 8000) yield JSON.stringify({ kind: 'text-fragment', record, offset, total: line.length, text: line.slice(offset, offset + 8000) })
    record++
  }
  })()
}
export async function semanticRecordingResolutions(session: ExplanationSession, read: ReadPage): Promise<DeixisResolution[]> {
  const resolutions: DeixisResolution[] = []
  const groups = new Map<string, TranscriptEntry[]>()
  for await (const event of semanticRecordingEvents(session, read)) if (event.kind === 'transcript') { const entries = groups.get(event.utteranceId) ?? []; entries.push(event); groups.set(event.utteranceId, entries) }
  for (const entries of groups.values()) {
    const [from, to] = entries.reduce<[number, number]>((span, e) => [Math.min(span[0], e.monoSpanUs[0]), Math.max(span[1], e.monoSpanUs[1])], [Infinity, 0])
    const evidence: ExplanationEvent[] = []
    for (const ref of session.pages.filter(p => ['pointer', 'geometry', 'annotation', 'command', 'delta'].includes(p.kind) && p.monoSpanUs[1] >= from - 800_000 && p.monoSpanUs[0] <= to + 250_000)) {
      const page = await readRecordingPage(session, ref, read)
      if (page.kind !== 'samples' && page.kind !== 'clock') evidence.push(...page.entries)
    }
    resolutions.push(resolveDeixis(entries, evidence, session.clockSegments, session.bindings))
  }
  return resolutions
}
