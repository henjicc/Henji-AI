import { createImageEditorV3RequestId, pinImageEditorV3RepairResources, releaseImageEditorV3RepairResources, selectImageEditorV3RasterRegion } from '@/commands/imageEditorV3'
import { appendImageEditSelectionV3, type ImageEditSelectionSessionV3 } from '@/core/imageEdit/v3/selection/session'
import { imageEditSubjectRegionSchemaV3, type ImageEditSubjectRegionV3 } from '@/core/imageEdit/v3/subjectSelection'
import type { ImageEditorV3SubjectCandidate } from '@/platform/contracts/imageEditorV3'
import type { ImageEditRepairBitmapV3 } from '@/core/imageEdit/v3/repair'
import { collectImageEditJsonResourceIdsV3 } from '@/core/imageEdit/v3/resourceReferences'
import { createLogger } from '@/core/logging'
import { ImageEditRepairPixelsClientV3 } from '../execution/repairPixelsClientV3'
import { createImageEditorRasterBrushTileLoaderV3 } from '../editor/rasterBrushTilesV3'
import { multiplyAnnotationMatricesV3, invertAnnotationMatrixV3, resolveAnnotationLayerToOutputMatrixV3, resolveAnnotationOutputGeometryV3, mapAnnotationPointV3 } from '../editor/annotationGeometryV3'
import { findImageEditV3LiveLayer } from './imageEditDocumentRefs'
import type { ImageEditCommandBusV3 } from './imageEditCommandBus'

const logger = createLogger('features.image_edit_v3.subject')
export interface ImageEditSubjectCandidateV3 { id: string; bounds: ImageEditorV3SubjectCandidate['bounds']; area: number; score: number }
interface Pending { layerId: string; revision: number; selectionRevision: number; candidates: ImageEditorV3SubjectCandidate[] }
const pending = new WeakMap<ImageEditCommandBusV3, Pending>(), active = new WeakSet<ImageEditCommandBusV3>()
/** 候选只属于本次识别；取消或切换目标后不得通过旧候选继续提交。 */
export function discardImageEditSubjectCandidatesV3(bus: ImageEditCommandBusV3): void { pending.delete(bus) }
export interface ImageEditSubjectSelectionOptionsV3 {
  region?: ImageEditSubjectRegionV3
  candidateId?: string
  combine?: 'replace' | 'add' | 'subtract' | 'intersect'
  signal?: AbortSignal
  /** 区域移除内部消费，不把中间选区当成单独撤销步骤。 */
  commit?: boolean
  progress?: (done: number, total: number) => void
}
export interface ImageEditSubjectSelectionResultV3 {
  status: 'selected' | 'candidates'
  candidates: ImageEditSubjectCandidateV3[]
  selection: ImageEditSelectionSessionV3 | null
  durationMs: number
}
const summaries = (candidates: ImageEditorV3SubjectCandidate[]): ImageEditSubjectCandidateV3[] => candidates.map(({ mask: _mask, ...value }) => value)

/** 唯一主体算法入口。候选绑定原图层与选区版本；选中后进入已有选区实体/同一撤销栈。 */
export async function selectImageEditRegionV3(bus: ImageEditCommandBusV3, layerId: string, options: ImageEditSubjectSelectionOptionsV3 = {}): Promise<ImageEditSubjectSelectionResultV3> {
  const begun = performance.now(), start = bus.getSnapshot(), location = findImageEditV3LiveLayer(start.document, layerId)
  if (!location || location.layer.type !== 'raster' || !location.layer.visible || location.ancestors.some(layer => !layer.visible)) throw new Error('请选择一个可见的像素图层')
  const region = imageEditSubjectRegionSchemaV3.parse(options.region ?? { kind: 'subject' })
  const check = (): void => {
    bus.getLifecycleSignal().throwIfAborted()
    options.signal?.throwIfAborted()
    const now = bus.getSnapshot()
    if (now.document.revision !== start.document.revision || now.selectionRevision !== start.selectionRevision) throw new Error('图片或选区已变化，请重新选择主体')
  }
  const choose = (candidate: ImageEditorV3SubjectCandidate): ImageEditSubjectSelectionResultV3 => {
    check()
    const selection = appendImageEditSelectionV3(start.selection, candidate.mask, options.combine ?? 'replace')
    if (options.commit !== false) bus.setSelection(selection)
    pending.delete(bus)
    return { status: 'selected', candidates: [], selection, durationMs: performance.now() - begun }
  }
  check()
  if (options.candidateId) {
    const value = pending.get(bus)
    if (!value || value.layerId !== layerId || value.revision !== start.document.revision || value.selectionRevision !== start.selectionRevision) throw new Error('主体候选已过期，请重新识别')
    const candidate = value.candidates.find(entry => entry.id === options.candidateId)
    if (!candidate) throw new Error('没有这个主体候选，请使用上次识别返回的候选')
    return choose(candidate)
  }
  if (active.has(bus)) throw new Error('正在选择主体，请完成或取消当前任务')
  if (start.document.color.workingSpace !== 'srgb' || start.document.color.hdrMetadata || !['srgb', 'linear'].includes(start.document.color.transferFunction)) throw new Error('主体选择目前支持标准色域图片')
  pending.delete(bus); active.add(bus)
  logger.info('主体选择开始', { event: 'image_edit.subject.start', context: { documentId: start.document.id, layerId, regionKind: region.kind } })
  const abort = new AbortController(), cancel = (): void => abort.abort()
  options.signal?.addEventListener('abort', cancel, { once: true })
  bus.getLifecycleSignal().addEventListener('abort', cancel, { once: true })
  if (options.signal?.aborted) abort.abort()
  const monitor = bus.subscribe(() => { const now = bus.getSnapshot(); if (now.document.revision !== start.document.revision || now.selectionRevision !== start.selectionRevision) abort.abort() })
  const pixels = new ImageEditRepairPixelsClientV3(), leaseId = createImageEditorV3RequestId('subject-lease')
  try {
    await pinImageEditorV3RepairResources(leaseId, collectImageEditJsonResourceIdsV3(start.document)); abort.signal.throwIfAborted()
    const loader = createImageEditorRasterBrushTileLoaderV3({ document: start.document, layer: location.layer, resourceByteSizes: new Map(Object.entries(bus.getResourceByteSizes())) })
    const size = await loader.resolveStorageSize(abort.signal), scale = Math.max(1, size.width / 512, size.height / 512)
    const width = Math.ceil(size.width / scale), height = Math.ceil(size.height / scale)
    let bitmap: ImageEditRepairBitmapV3 = { region: { x: 0, y: 0, width, height }, sampleScale: scale, rgba: new Uint8Array(width * height * 4), mask: new Uint8Array(width * height) }
    const total = Math.ceil(size.width / 512) * Math.ceil(size.height / 512); let done = 0
    for (let y = 0; y < size.height; y += 512) for (let x = 0; x < size.width; x += 512) {
      check(); abort.signal.throwIfAborted()
      const loaded = await loader({ mip: 0, x: x / 512, y: y / 512 }, abort.signal)
      if (loaded.tile.storage !== 'rgba-float32') throw new Error('主体选择像素格式不匹配')
      const result = await pixels.run({ type: 'source', tile: loaded.tile, origin: { x, y }, bitmap }, abort.signal)
      if (!result.bitmap) throw new Error('主体选择工作图缺失')
      bitmap = result.bitmap; options.progress?.(++done, total)
    }
    // mask比例 -> 存储 -> 文档原画面比例，旋转裁剪均不改变公开坐标含义。
    const doc = start.document
    const storageToDocument = multiplyAnnotationMatricesV3(invertAnnotationMatrixV3(resolveAnnotationOutputGeometryV3(doc).sourceToOutput), resolveAnnotationLayerToOutputMatrixV3(doc, [location.layer.transform, ...location.ancestors.slice().reverse().map(parent => parent.transform)]))
    const matrix = multiplyAnnotationMatricesV3([1 / doc.geometry.width, 0, 0, 1 / doc.geometry.height, 0, 0], multiplyAnnotationMatricesV3(storageToDocument, [width * scale, 0, 0, height * scale, 0, 0]))
    const inverse = invertAnnotationMatrixV3(matrix)
    const local = (x: number, y: number): { x: number; y: number } => { const p = mapAnnotationPointV3(inverse, [x, y]); if (p.some(v => v < 0 || v > 1)) throw new Error('指向位置超出当前图层，请在图层内点选'); return { x: p[0], y: p[1] } }
    let prompt = region
    if (region.kind === 'point') prompt = { ...region, points: region.points.map(p => ({ ...local(p.x, p.y), foreground: p.foreground })) }
    if (region.kind === 'box') {
      const corners = [[region.x, region.y], [region.x + region.width, region.y], [region.x, region.y + region.height], [region.x + region.width, region.y + region.height]].map(([x, y]) => local(x, y))
      const xs = corners.map(p => p.x), ys = corners.map(p => p.y), x = Math.min(...xs), y = Math.min(...ys)
      prompt = { kind: 'box', x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
    }
    const result = await selectImageEditorV3RasterRegion({ requestId: createImageEditorV3RequestId('select-region'), width, height, rgba: bitmap.rgba.buffer as ArrayBuffer, region: prompt }, abort.signal)
    check(); abort.signal.throwIfAborted()
    const batch = createImageEditorV3RequestId('subject-candidates')
    const candidates: ImageEditorV3SubjectCandidate[] = result.candidates.map(candidate => ({ ...candidate, id: `${batch}:${candidate.id}`, mask: { ...candidate.mask, matrix: [...matrix] }, bounds: documentBounds(candidate.bounds, matrix) }))
    logger.info('主体选择完成', { event: 'image_edit.subject.completed', context: { documentId: doc.id, layerId, model: result.model, providers: result.providers, inferenceMs: result.inferenceMs, durationMs: performance.now() - begun } })
    if (!candidates.length) throw new Error('没有找到清晰主体，请点选或框选目标后重试')
    monitor()
    if (candidates.length === 1) return choose(candidates[0])
    pending.set(bus, { layerId, revision: doc.revision, selectionRevision: start.selectionRevision, candidates })
    return { status: 'candidates', candidates: summaries(candidates), selection: null, durationMs: performance.now() - begun }
  } catch (error) { logger.warn('主体选择未提交', { event: 'image_edit.subject.failed', error, context: { documentId: start.document.id } }); throw error }
  finally { monitor(); pixels.dispose(); active.delete(bus); options.signal?.removeEventListener('abort', cancel); bus.getLifecycleSignal().removeEventListener('abort', cancel); try { await releaseImageEditorV3RepairResources(leaseId) } catch (error) { logger.warn('主体选择资源租约释放失败', { event: 'image_edit.subject.cleanup.failed', error }) } }
}
function documentBounds(bounds: ImageEditorV3SubjectCandidate['bounds'], matrix: readonly [number, number, number, number, number, number]): ImageEditorV3SubjectCandidate['bounds'] {
  const points = [[bounds.x, bounds.y], [bounds.x + bounds.width, bounds.y], [bounds.x, bounds.y + bounds.height], [bounds.x + bounds.width, bounds.y + bounds.height]].map(p => mapAnnotationPointV3(matrix, p as [number, number]))
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]), x = Math.min(...xs), y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}
