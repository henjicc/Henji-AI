import type { z } from 'zod'
import { applicationRefSchema } from '../application-control/identifiers'
import { clockEventIssue, refKey, type ClockSegment } from './contracts'
import { decodePersistenceResource } from '../persistence/resourceContracts'
import type { CreativeIntentPage } from './pageSchema'
export { creativeIntentPageSchema, type CreativeIntentPage } from './pageSchema'

/** Reader validates one sealed page at a time. I/O, SHA-256 and ownership leases belong to the host. */
export async function* readCreativeIntentPages(source: AsyncIterable<{ text: string; digest: string }>, context: {
  ownerRef: z.infer<typeof applicationRefSchema>; sourceDigest: string; hash: (text: string) => Promise<string>; cancelled?: () => boolean; clockSegments?: readonly ClockSegment[]
}): AsyncGenerator<CreativeIntentPage> {
  let lastSeq = -1; let lastMonoUs = -1
  const clocks = context.clockSegments && new Map(context.clockSegments.map(s => [s.id, s]))
  for await (const resource of source) {
    if (context.cancelled?.()) throw new Error('creative-intent:cancelled')
    if (await context.hash(resource.text) !== resource.digest) throw new Error('creative-intent:page-digest')
    const page = decodePersistenceResource('creative-intent-page', JSON.parse(resource.text))
    if (refKey(page.ownerRef) !== refKey(context.ownerRef) || page.sourceDigest !== context.sourceDigest) throw new Error('creative-intent:page-owner')
    if (page.kind !== 'clock') {
      if (clocks) for (const event of page.entries) { const issue = clockEventIssue(event, clocks); if (issue) throw new Error(`creative-intent:page-clock: ${issue}`) }
      const first = page.entries[0]
      if (first.seq <= lastSeq || first.monoUs < lastMonoUs) throw new Error('creative-intent:page-order')
      const last = page.entries[page.entries.length - 1]; lastSeq = last.seq; lastMonoUs = last.monoUs
    }
    yield page
  }
}
