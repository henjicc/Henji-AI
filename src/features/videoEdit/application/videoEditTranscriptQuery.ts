import { createLogger } from '@/core/logging'
import { ApplicationPreflightFailure } from '@/core/application-control/execution/transactionFailure'
import type { ApplicationRef } from '@/core/application-control'
import { videoEditComposition } from '@/core/videoEdit/document'
import { queryVideoEditTranscript, type VideoEditTranscriptMatch, type VideoEditTranscriptQuery } from '@/core/videoEdit/transcriptQuery'
import type { VideoEditTextSelector } from '@/core/videoEdit/textTranscript'
import { requireVideoEditInstance, type VideoEditInstance } from './videoEditService'

const logger = createLogger('features.videoEdit.transcriptQuery')
interface QueryResult { sequenceId: string; contentVersion: number; key: string; matches: VideoEditTranscriptMatch[] }
const results = new WeakMap<VideoEditInstance, Map<string, QueryResult>>()
const MAX_QUERIES = 4
export interface VideoEditTranscriptQueryPage {
  matches: (Omit<VideoEditTranscriptMatch, 'clipId' | 'itemId' | 'wordRange'> & {
    matchId: string; clipRef?: ApplicationRef; itemRef?: ApplicationRef
    selector?: { kind: 'match'; matchId: string }
  })[]
  total: number; nextCursor: string | null
}

export function readVideoEditTranscriptQuery(projectId: string, sequenceId: string, query: VideoEditTranscriptQuery, page: { cursor?: string; limit: number }): VideoEditTranscriptQueryPage {
  const owner = requireVideoEditInstance(projectId)
  let retained = results.get(owner)
  if (!retained) { retained = new Map(); results.set(owner, retained) }
  const key = JSON.stringify([sequenceId, query.text, query.from, query.to, query.clipId, query.itemId, query.source, query.contextWords])
  let queryId: string; let offset = 0; let result: QueryResult
  if (page.cursor) {
    const match = /^([a-f0-9-]{36}):(\d+)$/.exec(page.cursor)
    const known = match && retained.get(match[1])
    if (!known || known.key !== key || known.contentVersion !== owner.contentVersion) throw new ApplicationPreflightFailure('检索分页已失效，请按原条件重新查询。')
    queryId = match[1]; offset = Number(match[2]); result = known
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= result.matches.length) throw new ApplicationPreflightFailure('检索分页位置无效，请重新查询。')
  } else {
    logger.info('转录局部检索开始', { event: 'video_edit.transcript.query.start', context: { projectId, sequenceId } })
    try {
      result = { key, sequenceId, contentVersion: owner.contentVersion, matches: queryVideoEditTranscript(videoEditComposition(owner.document, sequenceId), query) }
      queryId = crypto.randomUUID()
      while (retained.size >= MAX_QUERIES) retained.delete(retained.keys().next().value!)
      retained.set(queryId, result)
      logger.info('转录局部检索完成', { event: 'video_edit.transcript.query.completed', context: { projectId, sequenceId, total: result.matches.length } })
    } catch (error) { logger.error('转录局部检索失败', { event: 'video_edit.transcript.query.failed', context: { projectId, sequenceId }, error }); throw error }
  }
  const matches = result.matches.slice(offset, offset + page.limit).map((value, index) => {
    const { clipId, itemId, wordRange, ...match } = value
    const matchId = `${queryId}:${offset + index}`
    return { ...match, matchId, ...(clipId ? { clipRef: { kind: 'video_edit.clip' as const, id: `${projectId}:${clipId}` } } : {}), ...(itemId ? { itemRef: { kind: 'video_edit.item' as const, id: `${projectId}:${itemId}` } } : {}),
      ...(value.editable && wordRange ? { selector: { kind: 'match' as const, matchId } } : {}) }
  })
  return { matches, total: result.matches.length, nextCursor: offset + page.limit < result.matches.length ? `${queryId}:${offset + page.limit}` : null }
}

/** The caller cannot manufacture ranges or a revision: only a retained, current query can select words. */
export function resolveVideoEditTranscriptMatch(projectId: string, sequenceId: string, matchId: string): VideoEditTextSelector {
  const owner = requireVideoEditInstance(projectId); const parsed = /^([a-f0-9-]{36}):(\d+)$/.exec(matchId)
  const result = parsed && results.get(owner)?.get(parsed[1])
  if (!result || result.sequenceId !== sequenceId || result.contentVersion !== owner.contentVersion) throw new ApplicationPreflightFailure('检索候选已失效，请重新查询后选择。')
  const match = result.matches[Number(parsed![2])]
  if (!match?.editable || !match.wordRange) throw new ApplicationPreflightFailure('此候选只有字幕或句级时间，或含受保护内容；请读取原词级转录后选择。')
  return { kind: 'words', ranges: [match.wordRange] }
}
