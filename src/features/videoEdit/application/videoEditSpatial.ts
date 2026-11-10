import { z } from 'zod'
import { createLogger } from '@/core/logging'
import type { ApplicationRef, JsonValue } from '@/core/application-control'
import { ApplicationPersistenceFailure } from '@/core/application-control/execution/persistence'
import { videoEditComposition, type VideoEditComposition, type VideoEditDocument, type VideoEditSequence } from '@/core/videoEdit/document'
import { spatialCameraSchema } from '@/core/videoEdit/spatialSchema'
import type { SpatialCamera, SpatialFact, SpatialLayoutIntent, SpatialOutput, SpatialTarget } from '@/core/videoEdit/spatialTypes'
import { arrangeVideoEditDepthCapability, transitionVideoEditSpaceCapability, verifyVideoEditSpaceCapability, videoEditSpatialCameraInputSchema, type VideoEditSpatialCameraInput } from '@/core/application-control/domains/videoEdit/videoEditSpatialCapabilities'
import type { CapabilityExecutionContext } from '@/features/application-control'
import { editVideoProject, openVideoEditDocument, saveVideoEdit } from './videoEditService'
import { isVideoEditContentCurrent, verifyVideoEditContentSaved } from './videoEditDocumentAlgorithm'
import { planVideoEditSpatialLayoutOffThread } from './videoEditMotionWorkerClient'
import { splitVideoEditRef } from './videoEditRefs'
import { videoEditObservationVersion } from './videoEditObservationVersion'
export { propagateVideoEditSpatialFields } from './videoEditSpatialPropagation'

const logger = createLogger('features.videoEdit.spatial')
export class VideoEditSpatialFailure extends Error {
  constructor(message: string, readonly facts: ReturnType<typeof publicFacts>) { super(message); this.name = 'VideoEditSpatialFailure' }
}
function child(documentId: string, ref: ApplicationRef): string {
  const parsed = splitVideoEditRef(ref)
  if (parsed.projectId !== documentId || !parsed.childId) throw new Error('空间目标必须使用 documentRef 所属剪辑中的完整实体引用。')
  return parsed.childId
}
function clipRef(documentId: string, id: string): { kind: 'video_edit.clip'; id: string } { return { kind: 'video_edit.clip', id: `${documentId}:${id}` } }
export function videoEditSpatialOutput(sequence: Pick<VideoEditSequence, 'width' | 'height' | 'pixelAspectRatio'> & Partial<Pick<VideoEditComposition, 'sequences' | 'id'>>): SpatialOutput { const source = sequence.sequences?.find(value => value.id === sequence.id) ?? sequence; return { width: source.width, height: source.height, displayWidth: source.width * source.pixelAspectRatio.numerator / source.pixelAspectRatio.denominator, displayHeight: source.height } }
function cameraOf(sequence: VideoEditSequence | VideoEditComposition): SpatialCamera | undefined { return (sequence as typeof sequence & { spatialCamera?: SpatialCamera }).spatialCamera }
function videoEditPublicSpatialCamera(documentId: string, camera: SpatialCamera | undefined): VideoEditSpatialCameraInput | null {
  if (!camera) return null
  const target = (value: SpatialTarget): z.infer<typeof videoEditSpatialCameraInputSchema>['aim'] => value.kind === 'clip' ? { kind: 'clip', targetRef: clipRef(documentId, value.clipId) } : value.kind === 'point' ? { kind: 'point', point: [...value.point] } : { kind: 'bounds', bounds: { min: [...value.bounds.min], max: [...value.bounds.max] } }
  return { ...camera, ...(camera.framing ? { framing: { ...camera.framing, target: target(camera.framing.target)! } } : {}), ...(camera.aim ? { aim: target(camera.aim) } : {}), ...(camera.focus ? { focus: camera.focus.kind === 'distance' ? camera.focus : target(camera.focus)! } : {}), ...(camera.bindings ? { bindings: {
    ...(camera.bindings.framing ? { framing: camera.bindings.framing.map(point => ({ ...point, value: point.value ? target(point.value)! : null })) } : {}),
    ...(camera.bindings.aim ? { aim: camera.bindings.aim.map(point => ({ ...point, value: point.value ? target(point.value)! : null })) } : {}),
    ...(camera.bindings.focus ? { focus: camera.bindings.focus.map(point => ({ ...point, value: point.value ? point.value.kind === 'distance' ? point.value : target(point.value)! : null })) } : {}),
  } } : {}) } as VideoEditSpatialCameraInput
}
export async function videoEditStoredSpatialCamera(document: VideoEditDocument, sequenceId: string, raw: unknown, _frame = 0): Promise<SpatialCamera | undefined> {
  if (raw === null) return undefined
  const input = videoEditSpatialCameraInputSchema.parse(raw), sequence = document.sequences.find(sequence => sequence.id === sequenceId)
  if (!sequence) throw new Error('目标序列不存在。')
  const target = (value: NonNullable<VideoEditSpatialCameraInput['aim']>): SpatialTarget => {
    if (value.kind !== 'clip') return value
    const id = child(document.id, value.targetRef)
    if (!sequence.clips.some(clip => clip.id === id)) throw new Error('相机目标必须属于同一序列，请重新读取片段引用。')
    return { kind: 'clip', clipId: id }
  }
  const { framing, aim, focus, bindings, ...rest } = input
  const perspective = framing?.perspective ?? rest.perspective
  if (framing?.perspective !== undefined && rest.perspective !== undefined && framing.perspective !== rest.perspective) throw new Error('framing.perspective 与 perspective 须一致。')
  const camera: SpatialCamera = { ...rest, ...(perspective === undefined ? {} : { perspective }), ...(framing ? { framing: { target: target(framing.target), heightFraction: framing.heightFraction } } : {}), ...(aim ? { aim: target(aim) } : {}), ...(focus ? { focus: focus.kind === 'distance' ? focus : target(focus) } : {}), ...(bindings ? { bindings: {
    ...(bindings.framing ? { framing: bindings.framing.map(point => ({ ...point, value: point.value ? target(point.value) : null })) } : {}),
    ...(bindings.aim ? { aim: bindings.aim.map(point => ({ ...point, value: point.value ? target(point.value) : null })) } : {}),
    ...(bindings.focus ? { focus: bindings.focus.map(point => ({ ...point, value: point.value ? point.value.kind === 'distance' ? point.value : target(point.value) : null })) } : {}),
  } } : {}) }
  return spatialCameraSchema.parse(camera)
}
function withComposition(document: VideoEditDocument, composition: VideoEditComposition): VideoEditDocument {
  return { ...document, sequences: (composition.sequences ?? document.sequences).map(sequence => sequence.id === composition.id ? { ...sequence, clips: composition.clips, ...(cameraOf(composition) ? { spatialCamera: cameraOf(composition) } : { spatialCamera: undefined }) } : sequence) }
}
function publicFacts(documentId: string, facts: readonly SpatialFact[]): z.infer<typeof arrangeVideoEditDepthCapability.outputSchema>['facts'] { return facts.map(({ clipIds, ...fact }) => ({ ...fact, values: { ...fact.values }, clipRefs: clipIds.map(id => clipRef(documentId, id)) })) }

export async function executeVideoEditSpatialLayout(raw: unknown, kind: 'arrange' | 'transition', context: CapabilityExecutionContext): Promise<z.infer<typeof arrangeVideoEditDepthCapability.outputSchema>> {
  const input = kind === 'arrange' ? arrangeVideoEditDepthCapability.inputSchema.parse(raw) : transitionVideoEditSpaceCapability.inputSchema.parse(raw)
  const id = input.documentRef.id, owner = await openVideoEditDocument({ id }, { focus: false }), version = owner.contentVersion, before = owner.document
  const sequenceId = child(id, input.sequenceRef), base = videoEditComposition(before, sequenceId), snapshot = { composition: base, sequenceId, revision: before.revision }
  const clipIds = input.clipRefs.map(ref => child(id, ref)), focusClipId = child(id, input.focusRef)
  const intent: SpatialLayoutIntent = 'referenceFrame' in input ? { kind: 'arrange', clipIds, focusClipId, referenceFrame: input.referenceFrame, parallaxRatio: input.parallaxRatio, range: input.range } : input.mode === 'expand' ? { kind: 'expand', clipIds, focusClipId, range: input.range, parallaxRatio: input.parallaxRatio!, perspective: input.perspective! } : { kind: 'flatten', clipIds, focusClipId, range: input.range }
  logger.info('空间布局开始', { event: 'video_edit.spatial.layout.start', context: { documentId: id, sequenceId, kind: intent.kind, clips: clipIds.length } })
  let committed = false
  try {
    const patch = await planVideoEditSpatialLayoutOffThread(snapshot, intent, videoEditSpatialOutput(base), context.signal)
    const { applySpatialPatch } = await import('@/core/videoEdit/spatialPropagation')
    const proposed = applySpatialPatch(snapshot, patch)
    context.signal.throwIfAborted()
    if (!isVideoEditContentCurrent(owner, version) || owner.document.revision !== patch.expectedRevision) throw new Error('空间计算期间剪辑已修改，请重新读取后再试。')
    const next = withComposition(before, proposed)
    await editVideoProject(id, () => { if (!isVideoEditContentCurrent(owner, version)) throw new Error('剪辑已有后续修改。'); return next }, { signal: context.signal, operation: 'fields' })
    committed = true
    const expected = owner.document, appliedVersion = owner.contentVersion
    try { await saveVideoEdit(id) } catch (error) { throw new ApplicationPersistenceFailure('空间布局已应用但未保存，请重试保存，不要重复布局。', { memoryState: 'modified', persistenceState: 'unconfirmed', stage: 'document', recovery: { capabilityId: 'save_video_edit', target: input.documentRef, replayMutation: false } }, error) }
    const verified = await verifyVideoEditContentSaved(owner, expected, appliedVersion)
    const changedRefs = [...patch.clips.map(edit => clipRef(id, edit.clipId)), ...(patch.camera ? [input.sequenceRef] : [])]
    logger.info('空间布局完成', { event: 'video_edit.spatial.layout.completed', context: { documentId: id, sequenceId, maxProjectionErrorPx: patch.maxProjectionErrorPx, verified } })
    return { documentRef: input.documentRef, sequenceRef: input.sequenceRef, changedRefs, achievedParallaxRatio: patch.achievedParallaxRatio, maxProjectionErrorPx: patch.maxProjectionErrorPx, facts: publicFacts(id, patch.facts), saved: verified, undoRef: input.documentRef, verification: { verified, condition: '已由正式文档保存回读核对片段、相机与取景意图；可用 undo_video_edit 撤销。' }, message: '空间布局已应用，可一步撤销。' }
  } catch (error) {
    if (!committed && error instanceof Error && 'facts' in error && Array.isArray(error.facts)) { const failure = error as Error & { facts: SpatialFact[] }; logger.warn('空间布局不可行', { event: 'video_edit.spatial.layout.failed', context: { documentId: id, sequenceId }, error }); throw new VideoEditSpatialFailure(failure.message, publicFacts(id, failure.facts)) }
    logger.warn('空间布局失败', { event: 'video_edit.spatial.layout.failed', context: { documentId: id, sequenceId }, error }); throw error }
}

/** 逐记录分页，不执行代码、不改播放头；游标绑定实例与内容身份。 */
export async function verifyVideoEditSpace(raw: unknown, signal: AbortSignal): Promise<z.infer<typeof verifyVideoEditSpaceCapability.outputSchema>> {
  const input = verifyVideoEditSpaceCapability.inputSchema.parse(raw), id = input.documentRef.id
  const owner = await openVideoEditDocument({ id }, { focus: false }), contentVersion = owner.contentVersion, document = owner.document
  const sequenceId = child(id, input.sequenceRef), base = videoEditComposition(document, sequenceId), output = videoEditSpatialOutput(base)
  const selected = input.clipRefs ? new Set(input.clipRefs.map(ref => child(id, ref))) : undefined
  if (selected && [...selected].some(id => !base.clips.some(clip => clip.id === id))) throw new Error('clipRefs 必须属于目标序列。')
  const version = videoEditObservationVersion(owner, document.revision), query = JSON.stringify([sequenceId, input.frames, [...selected ?? []]])
  const cursorSchema = z.object({ version: z.string(), query: z.string(), offset: z.number().int().nonnegative() }).strict()
  const cursor = input.cursor ? cursorSchema.parse(JSON.parse(input.cursor)) : { version, query, offset: 0 }
  if (cursor.version !== version || cursor.query !== query) throw new Error('空间验证游标已失效，请按同一输入从第一页重新读取。')
  const { evaluateSpatialFrame } = await import('@/core/videoEdit/spatialEvaluation')
  const { inspectSpatialFrame, spatialCoverage, spatialOcclusionGeometry } = await import('@/core/videoEdit/spatialLayout')
  const { spatialMultiply, spatialTransform } = await import('@/core/videoEdit/spatialMatrices')
  type Record = z.infer<typeof verifyVideoEditSpaceCapability.outputSchema>['records'][number]
  async function* records(): AsyncGenerator<Record> {
    for (const at of input.frames) {
      signal.throwIfAborted()
      const frame = evaluateSpatialFrame(base, at, output, 'final'), inspection = inspectSpatialFrame({ composition: base, sequenceId, revision: base.revision }, frame), camera = frame.camera
      const geometry = spatialOcclusionGeometry({ composition: base, sequenceId, revision: base.revision }, inspection.frame)
      yield { kind: 'camera', frame: at, intent: videoEditPublicSpatialCamera(id, cameraOf(base)), position: camera.position, target: camera.target, up: camera.up, sensorWidthMm: camera.sensorWidthMm, fovYRadians: camera.fovYRadians, fStop: camera.fStop, defocus: camera.defocus, resolvedAim: camera.resolvedAim, resolvedFocus: camera.resolvedFocus, targetActive: camera.targetActive, focalLengthMm: camera.focalLengthMm, focusDistance: camera.focusDistance, near: camera.near, far: camera.far, canonicalIdentity: camera.canonicalIdentity, flatIdentity: frame.flatIdentity, zeroBasis: 'effective-values-and-bindings', facts: publicFacts(id, frame.facts) }
      await new Promise<void>(resolve => setTimeout(resolve, 0))
      for (const item of inspection.cards) {
        if (selected && !selected.has(item.clipId)) continue
        const card = inspection.frame.cards.find(card => card.clipId === item.clipId)!, matrix = spatialMultiply(camera.projectionWebGpu, camera.view)
        const original = card.originalQuad.map(point => { const p = spatialTransform(matrix, point); return [(p[0] + 1) / 2, (1 - p[1]) / 2] as [number, number] })
        const area = (points: readonly (readonly [number, number])[]): number => Math.abs(points.reduce((sum, p, index) => { const next = points[(index + 1) % points.length]; return sum + p[0] * next[1] - next[0] * p[1] }, 0)) / 2
        const originalArea = area(original), visibleArea = area(card.screenPolygon)
        const blockers = geometry.filter(card => item.occludedBy.includes(card.clipId))
        const coverage = spatialCoverage(card, blockers)
        yield { kind: 'card', frame: at, clipRef: clipRef(id, card.clipId), originalQuad: [...card.originalQuad], visiblePolygon: [...card.visiblePolygon], screenPolygon: [...card.screenPolygon], screenBounds: card.screenBounds, logicalBounds: card.logicalBounds, anchorWorld: card.anchorWorld, centerWorld: card.centerWorld, centerViewDepth: card.centerViewDepth, viewDepthRange: card.viewDepthRange, cocRadiusPx: card.cocRadiusPx, cocRangePx: card.cocRangePx, behindCamera: card.behindCamera, clipped: card.clipped, ambiguousDepth: card.ambiguousDepth, ...(card.compoundGroup ? { compoundGroup: card.compoundGroup } : {}), drawOrder: item.drawOrder, inFrameFraction: originalArea > 0 ? Math.min(1, visibleArea / originalArea) : 0, visibleFraction: item.visibleFraction, occludedBy: item.occludedBy.map(clip => clipRef(id, clip)), coverage, visibility: item.visibility, approximation: item.approximation, sceneBoundsSource: item.sceneBoundsSource, focusOnCard: item.visibility === 'unknown' ? null : camera.focusDistance >= card.viewDepthRange[0] && camera.focusDistance <= card.viewDepthRange[1], clipFromUv: [...card.clipFromUv] }
      }
    }
  }
  logger.info('空间验证开始', { event: 'video_edit.spatial.verify.start', context: { documentId: id, sequenceId, frames: input.frames.length, offset: cursor.offset } })
  try {
    const page: Record[] = []; let index = 0, bytes = 0, nextCursor: string | null = null
    for await (const record of records()) {
      if (index++ < cursor.offset) continue
      const length = JSON.stringify(record).length
      if (page.length && (page.length >= 64 || bytes + length > 24_000)) { nextCursor = JSON.stringify({ version, query, offset: index - 1 }); break }
      page.push(record); bytes += length
    }
    signal.throwIfAborted()
    if (!isVideoEditContentCurrent(owner, contentVersion) || videoEditObservationVersion(owner, document.revision) !== version) throw new Error('验证期间内容已变化，请重新读取。')
    logger.info('空间验证完成', { event: 'video_edit.spatial.verify.completed', context: { documentId: id, sequenceId, records: page.length, nextPage: nextCursor !== null } })
    return { documentRef: input.documentRef, sequenceRef: input.sequenceRef, documentVersion: version, records: page, nextCursor, verificationKind: 'structural', message: '已完成结构验证；透明内容和未知场景仍需看同帧画面。' }
  } catch (error) { logger.warn('空间验证失败', { event: 'video_edit.spatial.verify.failed', context: { documentId: id, sequenceId }, error }); throw error }
}

export function videoEditSpatialJsonCamera(documentId: string, camera: SpatialCamera | undefined): JsonValue { return JSON.parse(JSON.stringify(videoEditPublicSpatialCamera(documentId, camera))) as JsonValue }
