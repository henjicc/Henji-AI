import type { z } from 'zod'
import { createLogger } from '@/core/logging'
import { assertApplicationCallerGrant } from '@/core/application-control/callerContext'
import { queryVideoEditSourceMapCapability, type videoEditSourceMapRecordSchema } from '@/core/application-control/domains/videoEdit/videoEditSourceMapCapability'
import { queryVideoEditContentCapability } from '@/core/application-control/domains/videoEdit/videoEditContentIndexCapability'
import { videoEditComposition } from '@/core/videoEdit/document'
import { VideoEditSourceMapIndex, projectVideoEditSourceMapRanges, type VideoEditSourceMapEntry } from '@/core/videoEdit/sourceMap'
import type { CapabilityExecutionContext } from '@/features/application-control'
import { requireVideoEditInstance, type VideoEditInstance } from './videoEditService'
import { splitVideoEditRef } from './videoEditReflection'
import { isVideoEditContentCurrent } from './videoEditDocumentAlgorithm'
import { readVideoEditContentIndex, type VideoEditContentValidation } from './videoEditContentIndex'

type SourceMapRecord = z.infer<typeof videoEditSourceMapRecordSchema>
interface Snapshot { key: string; records: VideoEditSourceMapEntry[] }
interface State { index: VideoEditSourceMapIndex; snapshots: Map<string, Snapshot> }
const states = new WeakMap<VideoEditInstance, State>()
const logger = createLogger('features.videoEdit.sourceMap')
const timeline = (range: { from: number; to: number }) => ({ fromFrame: range.from, toFrame: range.to })

export async function queryVideoEditSourceMap(raw: unknown, context: Pick<CapabilityExecutionContext, 'signal' | 'callerGrant' | 'requestId'>): Promise<Record<string, unknown>> {
  const input = queryVideoEditSourceMapCapability.inputSchema.parse(raw)
  const { projectId, childId } = splitVideoEditRef(input.sequenceRef)
  if (projectId !== input.documentRef.id || !childId) throw new Error('sequenceRef 必须属于 documentRef，请使用完整序列引用。')
  const owner = requireVideoEditInstance(projectId); const version = owner.contentVersion; const document = owner.document
  const assertCurrent = (): void => {
    context.signal.throwIfAborted()
    if (context.callerGrant) assertApplicationCallerGrant(context.callerGrant)
    if (!isVideoEditContentCurrent(owner, version)) throw new Error('来源映射期间剪辑已关闭或内容改变，请重新查询。')
  }
  logger.info('成片来源映射开始', { event: 'video_edit.source_map.query.start', requestId: context.requestId, context: { documentId: projectId, sequenceId: childId, from: input.from, to: input.to } })
  try {
    assertCurrent()
    const composition = videoEditComposition(document, childId)
    let state = states.get(owner)
    if (!state) { state = { index: new VideoEditSourceMapIndex(), snapshots: new Map() }; states.set(owner, state) }
    const key = JSON.stringify([childId, version, input.from, input.to, [...new Set(input.mediums)].sort(), input.includeContent, input.contentLimit, [...new Set(input.contentKinds)].sort(), input.discoveryScope])
    let queryId: string; let offset = 0; let snapshot: Snapshot
    if (input.cursor) {
      const cursor = /^([a-f0-9-]{36}):(\d+)$/.exec(input.cursor); const saved = cursor && state.snapshots.get(cursor[1])
      if (!saved || saved.key !== key) throw new Error('来源映射分页已失效，请保持原条件重新查询。')
      queryId = cursor[1]; offset = Number(cursor[2]); snapshot = saved
      if (!Number.isSafeInteger(offset) || offset >= saved.records.length) throw new Error('来源映射分页位置无效，请重新查询。')
    } else {
      queryId = crypto.randomUUID()
      snapshot = { key, records: state.index.query(composition, { from: input.from, to: input.to }, input.mediums) }
      while (state.snapshots.size >= 4) state.snapshots.delete(state.snapshots.keys().next().value!)
      state.snapshots.set(queryId, snapshot)
    }
    const warnings = new Set<string>(['轨道结构只给出来源候选，不分析像素遮挡；透明底板和外框不能证明下层不可见。'])
    const contentReads = new Map<string, z.infer<typeof queryVideoEditContentCapability.outputSchema>>()
    const validations: VideoEditContentValidation[] = []
    const records: SourceMapRecord[] = []
    for (const entry of snapshot.records.slice(offset, offset + input.limit)) {
      assertCurrent()
      const record: SourceMapRecord = { id: entry.id, medium: entry.medium, kind: entry.kind, timeline: timeline(entry.timeline), path: entry.path.map(step => ({
        sequenceRef: { kind: 'video_edit.sequence', id: `${projectId}:${step.sequenceId}` }, clipRef: { kind: 'video_edit.clip', id: `${projectId}:${step.clipId}` }, itemRef: { kind: 'video_edit.item', id: `${projectId}:${step.itemId}` }, track: step.track,
      })), sourceKind: entry.sourceKind, ...(entry.mediaId ? { mediaRef: { kind: 'video_edit.media', id: `${projectId}:${entry.mediaId}` } } : {}), source: { ...entry.source }, ...(entry.firstSample ? { firstSample: { ...entry.firstSample } } : {}), content: null }
      if (input.includeContent && entry.mediaId) {
        const itemId = entry.path.at(-1)!.itemId
        const fromUs = entry.source.fromUs; const toUs = Math.max(fromUs + 1, entry.source.toUs)
        const contentKey = JSON.stringify([itemId, fromUs, toUs])
        try {
          let content = contentReads.get(contentKey)
          if (!content) {
            content = queryVideoEditContentCapability.outputSchema.parse(await readVideoEditContentIndex({ documentRef: input.documentRef, itemRef: { kind: 'video_edit.item', id: `${projectId}:${itemId}` }, fromUs, toUs, discoveryScope: input.discoveryScope, limit: input.contentLimit, kinds: input.contentKinds }, context, { captureValidation: validation => validations.push(validation) }))
            contentReads.set(contentKey, content)
          }
          record.content = { records: content.records.map(fact => ({ record: fact, timelineRanges: projectVideoEditSourceMapRanges(entry, fact.ranges).map(timeline) })), total: content.total, nextCursor: content.nextCursor, complete: content.discovery.complete }
          for (const warning of content.warnings) warnings.add(warning)
        } catch (error) {
          assertCurrent()
          const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000)
          record.content = { records: [], total: 0, nextCursor: null, complete: false, error: message }
          warnings.add('部分素材内容未能读取或核实；结构映射仍保留，请检查各项 content.error 后重试。')
          logger.warn('来源映射的内容证据未能读取', { event: 'video_edit.source_map.content.unavailable', requestId: context.requestId, context: { documentId: projectId, itemId }, error })
        }
      }
      records.push(record)
    }
    for (const validation of validations) { assertCurrent(); await validation.assertCurrent() }
    for (const validation of validations) validation.assertCurrentSync()
    assertCurrent()
    const warningList = [...warnings]
    logger.info('成片来源映射完成', { event: 'video_edit.source_map.query.completed', requestId: context.requestId, context: { documentId: projectId, sequenceId: childId, total: snapshot.records.length, returned: records.length } })
    return { documentRef: input.documentRef, sequenceRef: input.sequenceRef, clock: 'sequence_frames', coverageBasis: 'timeline_structure', visibilityVerified: false,
      range: { fromFrame: input.from, toFrame: input.to }, records, total: snapshot.records.length, nextCursor: offset + input.limit < snapshot.records.length ? `${queryId}:${offset + input.limit}` : null,
      warnings: warningList.length > 20 ? [...warningList.slice(0, 19), `另有 ${warningList.length - 19} 项提示；请同时检查各项 content.complete 和 content.error。`] : warningList, message: `找到 ${snapshot.records.length} 项结构来源，本次返回 ${records.length} 项；实际画面与声音仍需观察复核。` }
  } catch (error) {
    const meta = { event: context.signal.aborted ? 'video_edit.source_map.query.cancelled' : 'video_edit.source_map.query.failed', requestId: context.requestId, context: { documentId: projectId, sequenceId: childId } }
    if (context.signal.aborted) logger.info('成片来源映射已取消', meta)
    else logger.error('成片来源映射失败', error, meta)
    throw error
  }
}
