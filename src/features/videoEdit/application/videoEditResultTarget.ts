import { createLogger } from '@/core/logging'
import { videoEditClipSchema, videoEditCreativeSourceSchema, type VideoEditCreativeSource, type VideoEditDocument } from '@/core/videoEdit/document'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { importVideoEditCaptions } from '@/core/videoEdit/timedContent'
import { videoEditFps } from '@/core/videoEdit/time'
import type { AssetRecord } from '@/platform/contracts/assetLibrary'
import { getDocumentOperations } from '@/features/documents/documentOperations'
import { getDocumentSessionRegistry } from '@/features/documents/documentSessionRegistry'
import { getPlatform } from '@/platform/runtime'
import { videoEditResultPlacementSchema, type VideoEditResultPlacement } from '@/core/videoEdit/creativeResult'
import { importVideoEditSources, sameVideoEditMediaPath } from './videoEditMedia'
import { listVideoEditInstances, requireVideoEditInstance, saveVideoEdit, verifyVideoEditSaved, type VideoEditInstance } from './videoEditService'

const logger = createLogger('features.videoEdit.results')
export type { VideoEditResultPlacement } from '@/core/videoEdit/creativeResult'
export interface VideoEditResultTarget { readonly projectId: string; readonly sequenceId: string; readonly id: string }
/** Only formal source adapters may produce a ready asset and fixed completion identity. */
export interface VideoEditCreativeResult { asset: AssetRecord; origin: VideoEditCreativeSource; captions?: string }
export interface VideoEditResultReceipt { projectId: string; sequenceId: string; clipId: string; assetId: string; verified: boolean }
interface TargetState {
  owner: VideoEditInstance
  baseline: VideoEditDocument
  placement: VideoEditResultPlacement
  busy: boolean
  committed?: { document: VideoEditDocument; result: string; receipt: VideoEditResultReceipt }
}
const targets = new WeakMap<VideoEditResultTarget, TargetState>()

function stateOf(target: VideoEditResultTarget, signal?: AbortSignal): TargetState {
  signal?.throwIfAborted()
  const state = targets.get(target)
  if (!state || !listVideoEditInstances().includes(state.owner)) throw new Error('原剪辑工程已关闭，请重新选择结果位置。')
  return state
}
export function assertVideoEditResultTarget(target: VideoEditResultTarget, signal?: AbortSignal): void {
  const state = stateOf(target, signal)
  if (state.owner.document !== (state.committed?.document ?? state.baseline)) throw new Error('原剪辑工程已有修改，请重新选择结果位置；已完成文件仍保留。')
}
/** Called before any producer/read/export awaits. UI focus is never a destination. */
export function captureVideoEditResultTarget(projectId: string, sequenceId: string, placement: VideoEditResultPlacement): VideoEditResultTarget {
  placement = videoEditResultPlacementSchema.parse(placement)
  const owner = requireVideoEditInstance(projectId)
  const sequence = owner.document.sequences.find(value => value.id === sequenceId)
  if (!sequence) throw new Error('原序列不存在。')
  const clip = placement.mode === 'replace' ? sequence.clips.find(value => value.id === placement.clipId) : undefined
  if (placement.mode === 'replace' && (!clip || clip.kind === 'adjustment')) throw new Error('请选择可替换的原画面或声音片段。')
  const track = placement.mode === 'add' ? sequence.tracks.find(value => value.id === placement.trackId) : sequence.tracks.find(value => value.index === clip?.track)
  if (!track || track.locked) throw new Error('原目标轨道不存在或已锁定。')
  if (placement.mode === 'add' && (!Number.isSafeInteger(placement.frame) || placement.frame < 0 || placement.frame >= Math.floor(videoEditFps(sequence.frameRate) * 1800) || placement.duration !== undefined && (!Number.isSafeInteger(placement.duration) || placement.duration < 1))) throw new Error('请选择序列范围内的落点与正整数帧时长。')
  const target = Object.freeze({ projectId, sequenceId, id: crypto.randomUUID() })
  targets.set(target, { owner, baseline: owner.document, placement: { ...placement }, busy: false })
  return target
}

function sameAsset(media: VideoEditDocument['media'][number], asset: AssetRecord): boolean {
  return media.assetId === asset.id && media.kind === asset.mediaType && sameVideoEditMediaPath(media.path, asset.filePath)
    && media.assetContent?.contentIdentity === asset.contentIdentity && media.assetContent?.sizeBytes === asset.sizeBytes && media.assetContent?.fileModifiedAt === asset.fileModifiedAt
}
function publishedClip(document: VideoEditDocument, sequenceId: string, clipId: string, expected: string): boolean {
  const clip = document.sequences.find(sequence => sequence.id === sequenceId)?.clips.find(clip => clip.id === clipId)
  return Boolean(clip) && JSON.stringify(videoEditClipSchema.parse(clip)) === expected
}
/**
 * 结果文件放进目标剪辑所在项目的“生成结果”（重要记录 006：其他工具的结果复制进项目再引用；
 * 同名同内容复用，从不覆盖）；返回剪辑里要引用的位置。已在项目里的原样返回。
 */
/** 需要新写出文件的来源（口播剪后声音）直接写进目标剪辑所在项目的“生成结果”；找不到项目时返回 null（改由用户选择位置）。 */
export async function videoEditResultOutputFolder(target: VideoEditResultTarget): Promise<string | null> {
  const container = stateOf(target).owner.session.documentMeta.container
  if (container.kind !== 'project') return null
  const project = await getDocumentOperations().findProject(container.projectId).catch(() => null)
  return project ? await getPlatform().system.paths.join(project.path, project.folders.generated) : null
}

export async function placeVideoEditResultInProject(target: VideoEditResultTarget, filePath: string): Promise<string> {
  const container = stateOf(target).owner.session.documentMeta.container
  if (container.kind !== 'project') return filePath
  const placed = await getDocumentOperations().importFile({ container, sourcePath: filePath, folder: 'generated' })
  if (placed.copied) logger.info('创作结果已复制进项目生成结果', { event: 'video_edit.result.copied_to_project', context: { projectId: container.projectId } })
  return placed.path
}
async function verifySaved(target: VideoEditResultTarget, state: TargetState): Promise<VideoEditResultReceipt> {
  await saveVideoEdit(target.projectId)
  assertVideoEditResultTarget(target)
  const stored = await verifyVideoEditSaved(target.projectId, state.committed!.document)
  assertVideoEditResultTarget(target)
  if (!stored) throw new Error('结果已加入原工程，但保存回读不一致，请重试保存。')
  return { ...state.committed!.receipt, verified: true }
}

/** One media import transaction owns the clip, provenance and output-clock captions. */
export async function commitVideoEditCreativeResult(target: VideoEditResultTarget, result: VideoEditCreativeResult, signal?: AbortSignal): Promise<VideoEditResultReceipt> {
  const state = stateOf(target, signal)
  if (state.busy) throw new Error('此结果正在回填，请等待完成。')
  state.busy = true
  const started = performance.now()
  try {
    assertVideoEditResultTarget(target, signal)
    const origin = videoEditCreativeSourceSchema.parse(result.origin)
    const asset = { ...result.asset }
    if (asset.mediaType === 'code' || asset.inspectionStatus !== 'ready' || !asset.contentIdentity || asset.sizeBytes === null || asset.fileModifiedAt === null) throw new Error('创作结果尚未完成本地媒体检查。')
    if (result.captions !== undefined && (asset.mediaType !== 'audio' || result.captions.length > 2 * 1024 * 1024)) throw new Error('口播字幕必须绑定已完成声音且不超过读取预算。')
    const resultKey = JSON.stringify([origin, asset.id, asset.filePath, asset.contentIdentity, result.captions])
    if (state.committed) {
      if (state.committed.result !== resultKey) throw new Error('原位置已接收另一份结果，请重新选择。')
      return await verifySaved(target, state)
    }
    let clipId = ''; let expectedClip = ''
    await importVideoEditSources(target.projectId, [{ assetId: asset.id }], undefined, signal, (document, itemIds) => {
      assertVideoEditResultTarget(target, signal)
      const item = document.items.find(item => itemIds.includes(item.id) && document.media.some(media => item.mediaId === media.id && sameAsset(media, asset)))
      if (!item) throw new Error('创作结果在引用期间已改变，请重新选择原结果。')
      const sequence = document.sequences.find(value => value.id === target.sequenceId)!
      const placement = state.placement
      const prior = placement.mode === 'replace' ? sequence.clips.find(value => value.id === placement.clipId)! : undefined
      const track = placement.mode === 'add' ? sequence.tracks.find(value => value.id === placement.trackId)!.index : prior!.track
      const frame = placement.mode === 'add' ? placement.frame : prior!.start
      const component = asset.mediaType === 'video' && prior?.sourceComponent ? { sourceComponent: prior.sourceComponent } : {}
      // A shorter timed replacement keeps its own length; stills fill the original slot.
      const natural = prior && asset.mediaType !== 'image' ? makeVideoEditItemClip(document, item.id, sequence.id, { frame, track, ...component }).duration : undefined
      const duration = placement.mode === 'add' ? placement.duration : Math.min(prior!.duration, natural ?? prior!.duration)
      const made = makeVideoEditItemClip(document, item.id, sequence.id, { frame, track, duration, ...component })
      const clip = prior ? { ...made, id: prior.id, x: prior.x, y: prior.y, scale: prior.scale, rotation: prior.rotation, opacity: prior.opacity, volume: prior.volume, brightness: prior.brightness, ...(prior.linkId ? { linkId: prior.linkId } : {}), ...(prior.groupId ? { groupId: prior.groupId } : {}), ...(prior.effects ? { effects: prior.effects } : {}), creativeSource: origin } : { ...made, creativeSource: origin }
      if (!prior && sequence.clips.some(value => value.track === track && value.start < clip.start + clip.duration && value.start + value.duration > clip.start)) throw new Error('原落点已有片段，请选择空余轨道或明确替换原片段。')
      const captions = result.captions === undefined ? sequence.captions : [...(sequence.captions ?? []).filter(caption => caption.clipId !== clip.id), ...importVideoEditCaptions(result.captions, sequence.frameRate, { offset: clip.start, clip })]
      clipId = clip.id
      // Schema parsing orders keys by declaration; compare the normalized published clip.
      expectedClip = JSON.stringify(videoEditClipSchema.parse(clip))
      return { ...document, sequences: document.sequences.map(value => value.id === sequence.id ? { ...sequence, clips: prior ? sequence.clips.map(value => value.id === prior.id ? clip : value) : [...sequence.clips, clip], ...(captions ? { captions } : {}) } : value) }
    }, state.placement.mode === 'replace' ? [state.placement.clipId] : [])
    stateOf(target)
    const committed = state.owner.document
    if (committed.revision > state.baseline.revision + 1 || !publishedClip(committed, target.sequenceId, clipId, expectedClip)) throw new Error('结果发布后原工程已有后续修改，请回读原片段；不会重复回填。')
    const receipt = { projectId: target.projectId, sequenceId: target.sequenceId, clipId, assetId: asset.id, verified: false }
    // 片段引用了来源文档：来源草稿哪怕只导入了素材，离开时也不能当空草稿删掉
    if (origin.type === 'document') getDocumentSessionRegistry().get(origin.docRef.docId)?.markInUse()
    state.committed = { document: committed, result: resultKey, receipt }
    // After the atomic edit, late cancellation cannot turn a committed result into a retry.
    const saved = await verifySaved(target, state)
    logger.info('创作结果已回填原剪辑位置', { event: 'video_edit.result.commit.completed', context: { ...saved, origin, durationMs: Math.round(performance.now() - started) } })
    return saved
  } catch (error) {
    logger.warn('创作结果回填未完成，原结果保留', { event: 'video_edit.result.commit.failed', error, context: { projectId: target.projectId, sequenceId: target.sequenceId, committed: Boolean(state.committed) } })
    throw error
  } finally { state.busy = false }
}
