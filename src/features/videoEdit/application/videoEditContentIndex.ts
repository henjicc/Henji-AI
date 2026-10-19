import { createLogger } from '@/core/logging'
import { assertApplicationCallerGrant } from '@/core/application-control/callerContext'
import type { AssetFileContent } from '@/platform/contracts/assetLibrary'
import { videoEditItemAudioLayout } from '@/core/videoEdit/audioChannels'
import { intersectRecordingRanges } from '@/core/screenRecording/segmentation'
import { queryVideoEditContentCapability } from '@/core/application-control/domains/videoEdit/videoEditContentIndexCapability'
import { queryMediaContentIndex, type MediaContentFact, type MediaContentRecord } from '@/core/media/contentIndex'
import { audioDocumentContentFacts, recordingMediaContentFacts, videoEditSavedContentFacts } from '@/core/videoEdit/contentIndex'
import { getPlatform } from '@/platform/runtime'
import type { CapabilityExecutionContext } from '@/features/application-control'
import { requireVideoEditInstance, type VideoEditInstance } from './videoEditService'
import { splitVideoEditRef } from './videoEditReflection'
import { sameVideoEditMediaPath } from './videoEditMedia'
import { isVideoEditContentCurrent } from './videoEditDocumentAlgorithm'
import { readSourceEnergyPauses } from './videoEditPauseMap'
import { readVideoEditContentDocuments } from './videoEditContentDocuments'
import { beginVideoEditContentQuery } from './videoEditContentQueryProgress'

const logger = createLogger('features.videoEdit.contentIndex')
type RelatedDocuments = Awaited<ReturnType<typeof readVideoEditContentDocuments>>
interface QuerySnapshot { key: string; records: MediaContentRecord[]; warnings: string[]; sourceVerified: boolean; audioOwners: RelatedDocuments['audios'][number]['owner'][]; discovery: RelatedDocuments['discovery'] }
const queries = new WeakMap<VideoEditInstance, Map<string, QuerySnapshot>>()
const fileIdentity = (value: AssetFileContent) => [value.contentIdentity, value.sizeBytes, value.fileModifiedAt]
/** Trusted domain composition can recheck an already-read source before returning a combined result. */
export interface VideoEditContentValidation { assertCurrent: () => Promise<void>; assertCurrentSync: () => void }

export async function readVideoEditContentIndex(raw: unknown, context: Pick<CapabilityExecutionContext, 'signal' | 'callerGrant' | 'requestId'>, options?: { captureValidation?: (validation: VideoEditContentValidation) => void }): Promise<Record<string, unknown>> {
  const input = queryVideoEditContentCapability.inputSchema.parse(raw)
  const { projectId, childId } = splitVideoEditRef(input.itemRef)
  if (projectId !== input.documentRef.id || !childId) throw new Error('itemRef 必须属于 documentRef，请使用完整素材引用。')
  const permissions = context.callerGrant?.permissions
  if (input.audioDocumentRef && permissions && !permissions.includes('audio_edit:read')) throw new Error('PERMISSION_DENIED:读取关联口播需要 audio_edit:read。')
  if (input.recordingRef && permissions && !permissions.includes('screen_recording:read')) throw new Error('PERMISSION_DENIED:读取关联录制需要 screen_recording:read。')
  const owner = requireVideoEditInstance(projectId); const document = owner.document; const version = owner.contentVersion
  const item = document.items.find(item => item.id === childId)
  const media = document.media.find(media => media.id === item?.mediaId)
  if (!item || !media) throw new Error('请选择引用原始图片、视频或声音文件的素材项；嵌套序列须查询其原始素材。')
  const queryPermissions = ['video_edit:read', ...(['audio_edit:read', 'screen_recording:read'] as const).filter(permission =>
    (permission === 'audio_edit:read' ? input.audioDocumentRef : input.recordingRef) || input.discoveryScope !== 'none' && (!permissions || permissions.includes(permission)))]
  const platform = getPlatform(); const task = beginVideoEditContentQuery(owner, childId, context.signal, queryPermissions); const signal = task.signal
  const warnings: string[] = []
  logger.info('素材内容索引查询开始', { event: 'video_edit.content_index.query.start', requestId: context.requestId, context: { projectId, itemId: childId } })
  try {
    signal.throwIfAborted()
    const identity = await platform.assetLibrary.inspectFileContent(media.path, media.kind)
    signal.throwIfAborted()
    if (context.callerGrant) assertApplicationCallerGrant(context.callerGrant)
    const expected = media.assetContent
    if (expected?.contentIdentity && (expected.contentIdentity !== identity.contentIdentity || expected.sizeBytes !== identity.sizeBytes || expected.fileModifiedAt !== identity.fileModifiedAt)) throw new Error('原素材已改变，请重新定位素材后查询，不能继续使用旧转录。')
    const sourceVerified = Boolean(expected?.contentIdentity)
    if (!sourceVerified) warnings.push('此素材尚未保存导入时的文件身份；旧文字仅供查阅，不能据此证明与当前文件一致。')
    const related = await readVideoEditContentDocuments(input, owner.session.documentMeta.container, media.path, { ...context, signal }, task.report)
    warnings.push(...related.warnings)
    const audioOwners = related.audios.map(({ owner }) => owner)
    const key = JSON.stringify([childId, version, fileIdentity(identity), input.text, input.fromUs, input.toUs, [...new Set(input.kinds)].sort(), input.audioDocumentRef?.id, input.recordingRef?.id, related.signature])
    let retained = queries.get(owner)
    if (!retained) { retained = new Map(); queries.set(owner, retained) }
    let queryId: string; let offset = 0; let snapshot: QuerySnapshot
    const assertDocumentsCurrent = (): void => {
      signal.throwIfAborted(); context.signal.throwIfAborted()
      if (context.callerGrant) assertApplicationCallerGrant(context.callerGrant)
      if (!isVideoEditContentCurrent(owner, version)) throw new Error('查询期间关联内容已改变，请重新查询。')
      related.assertCurrentSync()
    }
    const current = async (): Promise<void> => {
      assertDocumentsCurrent()
      await related.assertCurrent()
      const now = await platform.assetLibrary.inspectFileContent(media.path, media.kind)
      if (JSON.stringify(fileIdentity(now)) !== JSON.stringify(fileIdentity(identity))) throw new Error('查询期间原素材已改变，请重新查询。')
      assertDocumentsCurrent()
      signal.throwIfAborted()
    }
    if (input.cursor) {
      const parsed = /^([a-f0-9-]{36}):(\d+)$/.exec(input.cursor)
      const known = parsed && retained.get(parsed[1])
      if (!known || known.key !== key || known.audioOwners.length !== audioOwners.length || known.audioOwners.some((audio, index) => audio !== audioOwners[index])) throw new Error('索引分页已失效，请保持原查询条件并重新查询。')
      queryId = parsed[1]; offset = Number(parsed[2]); snapshot = known
      if (!Number.isSafeInteger(offset) || offset >= known.records.length) throw new Error('索引分页位置无效，请重新查询。')
    } else {
      task.report({ phase: 'reading_text', message: '读取已有文字与章节' })
      const samePathMedia = document.media.filter(source => sameVideoEditMediaPath(source.path, media.path))
      const relatedMediaIds = new Set(samePathMedia.filter(source => source.id === media.id || source.assetContent?.contentIdentity === identity.contentIdentity
        && source.assetContent.sizeBytes === identity.sizeBytes && source.assetContent.fileModifiedAt === identity.fileModifiedAt).map(source => source.id))
      if (relatedMediaIds.size < samePathMedia.length) warnings.push('已排除同路径但未绑定当前文件身份的其他素材项。')
      const relatedItems = document.items.filter(value => value.mediaId && relatedMediaIds.has(value.mediaId)).map(value => value.id)
      const facts: MediaContentFact[] = videoEditSavedContentFacts(document, relatedItems, media).map(fact => ({ ...fact, sourceVerified }))
      for (const { owner: audio } of related.audios) facts.push(...audioDocumentContentFacts(audio.document).map(fact => ({ ...fact, sourceVerified: true })))
      for (const recording of related.recordings) facts.push(...recordingMediaContentFacts(recording.meta.id, recording.content, recording.content.media.filter(source => sameVideoEditMediaPath(source.path, media.path)).map(source => source.id)))
      const fromUs = Math.max(input.fromUs ?? 0, item.sourceRange?.inUs ?? 0)
      // A still has asset-level facts at source point zero, even though it has no intrinsic duration.
      const sourceEndUs = media.kind === 'image' ? 1 : Math.round(media.durationSeconds * 1e6)
      const toUs = Math.min(input.toUs ?? Infinity, item.sourceRange?.outUs ?? sourceEndUs)
      if (toUs > fromUs && input.kinds.includes('pause')) {
        if (media.kind === 'image' || media.hasAudio === false) warnings.push('此素材没有可分析的声音。')
        else {
          const layout = videoEditItemAudioLayout(item, media)
          const mappings = [...new Map((layout ?? [undefined]).map(mapping => [JSON.stringify(mapping?.sources), mapping])).values()]
          let valleys = [{ startUs: fromUs, endUs: toUs }]
          let completed = 0
          task.report({ phase: 'analyzing_audio', message: '分析当前素材的声音低谷', completedUnits: completed, totalUnits: mappings.length })
          for (const mapping of mappings) {
            signal.throwIfAborted()
            const pauses = await readSourceEnergyPauses(media.path, signal, { from: fromUs / 1e6, to: toUs / 1e6 }, mapping ? { channels: mapping.sources } : {})
            valleys = intersectRecordingRanges(valleys, pauses.map(pause => ({ startUs: Math.round(pause.startMs * 1000), endUs: Math.round(pause.endMs * 1000) })))
            task.report({ phase: 'analyzing_audio', message: '分析当前素材的声音低谷', completedUnits: ++completed, totalUnits: mappings.length })
          }
          facts.push(...valleys.filter(pause => pause.endUs - pause.startUs >= 100000).map((pause, index): MediaContentFact => ({ id: `pause:${index}`, kind: 'pause', text: '当前素材声道布局共同的全频与高频声音低谷', ranges: [{ fromUs: pause.startUs, toUs: pause.endUs }], basis: 'analysis', precision: 'interval', originRef: input.itemRef, recordId: `pause:${pause.startUs}`, sourceVerified: true })))
        }
      }
      if (toUs > fromUs && input.kinds.includes('scene')) {
        if (media.kind !== 'video') warnings.push('此素材没有视频镜头变化。')
        else {
          const requestId = crypto.randomUUID()
          task.report({ phase: 'analyzing_video', message: '分析画面镜头变化' })
          const unsubscribe = platform.sceneDetection.onProgress(event => {
            if (event.requestId === requestId) task.report({ phase: 'analyzing_video', message: '分析画面镜头变化', phaseProgress: event.progress })
          })
          const cancel = (): void => { void platform.sceneDetection.cancel(requestId).catch(error => logger.warn('取消素材画面分析失败', { event: 'video_edit.content_index.cancel_failed', error })) }
          signal.addEventListener('abort', cancel, { once: true })
          try {
            signal.throwIfAborted()
            const scenes = await platform.sceneDetection.detect({ requestId, source: media.path, startSeconds: fromUs / 1e6, endSeconds: toUs / 1e6, sensitivity: 50 })
            signal.throwIfAborted()
            facts.push(...scenes.cutsSeconds.map((time, index): MediaContentFact => ({ id: `scene:${index}`, kind: 'scene', text: '画面镜头变化候选', ranges: [{ fromUs: Math.round(time * 1e6), toUs: Math.round(time * 1e6) }], basis: 'analysis', precision: 'point', originRef: input.itemRef, recordId: `scene:${Math.round(time * 1e6)}`, sourceVerified: true })))
          } finally { signal.removeEventListener('abort', cancel); unsubscribe() }
        }
      }
      snapshot = { key, records: toUs > fromUs ? queryMediaContentIndex(facts, { ...input, fromUs, toUs }) : [], warnings, sourceVerified, audioOwners, discovery: related.discovery }
      queryId = crypto.randomUUID()
      while (retained.size >= 4) retained.delete(retained.keys().next().value!)
      retained.set(queryId, snapshot)
    }
    task.report({ phase: 'verifying_result', message: '复核文件与关联内容' })
    await current()
    options?.captureValidation?.({ assertCurrent: current, assertCurrentSync: assertDocumentsCurrent })
    const records = structuredClone(snapshot.records.slice(offset, offset + input.limit))
    logger.info('素材内容索引查询完成', { event: 'video_edit.content_index.query.completed', requestId: context.requestId, context: { projectId, itemId: childId, total: snapshot.records.length, returned: records.length } })
    task.finish('completed')
    return { documentRef: input.documentRef, itemRef: input.itemRef, clock: 'source_microseconds', sourceVerified: snapshot.sourceVerified, discovery: { ...snapshot.discovery }, records,
      total: snapshot.records.length, nextCursor: offset + input.limit < snapshot.records.length ? `${queryId}:${offset + input.limit}` : null, warnings: [...snapshot.warnings],
      message: `找到 ${snapshot.records.length} 条素材内容，本次返回 ${records.length} 条；来源时间为原文件微秒。` }
  } catch (error) {
    task.finish('failed', error)
    const meta = { event: signal.aborted ? 'video_edit.content_index.query.cancelled' : 'video_edit.content_index.query.failed', requestId: context.requestId, context: { projectId, itemId: childId } }
    if (signal.aborted) logger.info('素材内容索引查询已取消', meta)
    else logger.error('素材内容索引查询失败', error, meta)
    throw error
  }
}
