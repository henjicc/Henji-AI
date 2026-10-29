import type { CodeFramePerformance } from '@/core/videoEdit/codeMaterial/performance'
import { prepareVideoEditAnnotationObservation, paintVideoEditAnnotationObservation, type VideoEditAnnotationObservationOptions } from './videoEditAnnotationImage'
import { VIDEO_EDIT_MAX_SEQUENCE_SECONDS } from '@/core/videoEdit/time'
import { createLogger } from '@/core/logging'
import { videoEditComposition, type VideoEditComposition, type VideoEditDocument } from '@/core/videoEdit/document'
import { videoEditFps } from '@/core/videoEdit/time'
import { clampVideoEditSequenceSize } from '@/core/videoEdit/sequenceSize'
import type { AssetRecord } from '@/platform/contracts/assetLibrary'
import { getPlatform } from '@/platform/runtime'
import { addMediaReferenceToLibrary, OBSERVATION_ASSET_TAG } from '@/features/assets'
import { assetApplicationService } from '@/features/assets/application/assetApplicationService'
import { trialVideoEditCodeFrames } from './videoEditCodeTrial'
import { requireVideoEditInstance } from './videoEditService'
import { videoEditObservationVersion } from './videoEditObservationVersion'
import { installVideoEditCodeElements, resolveVideoEditElementAnnotation, videoEditCodeElementFrames, videoEditCodeElementRegion } from './videoEditCodeElements'
import { codeElementLabel } from '@/core/videoEdit/codeElementSelection'
import { renderVideoEditContactSheet, type VideoEditContactSheetRange } from './videoEditContactSheet'
import { videoEditObservationPixelCrop, videoEditObservationRegionSchema, type VideoEditObservationRegion } from '@/core/videoEdit/frameObservation'
import { isVideoEditContentCurrent } from './videoEditDocumentAlgorithm'
import { verifyVideoEditReviewObservationSources } from './videoEditReview'

const logger = createLogger('features.videoEdit.frameObservation')
export type VideoEditFrameObservationTarget =
  | { kind: 'program'; sequenceId?: string; frame: number }
  | { kind: 'source'; itemId: string; timeUs: number }
  | ({ kind: 'contact_sheet'; sequenceId?: string } & VideoEditContactSheetRange)
  | { kind: 'frames'; sequenceId?: string; frames: number[] }
  | { kind: 'near_cut'; sequenceId?: string; cutFrame: number; before: number; after: number }
export interface VideoEditFrameObservationOptions extends VideoEditAnnotationObservationOptions {
  saveToAssets?: boolean
  documentVersion?: string
  cropRegion?: VideoEditObservationRegion
  reference?: { itemId: string; offsetUs: number }
}
export interface VideoEditFrameObservation {
  performance?: CodeFramePerformance[]
  asset?: AssetRecord
  image: { filePath: string; displayUrl: string; displayName: string }
  resultRef: { kind: 'asset' | 'observation.image'; id: string }
  reused: boolean
  width: number
  height: number
  byteLength: number
  sourceWidth: number
  sourceHeight: number
  documentRevision: number
  documentVersion: string
  sequenceId?: string
  frame?: number
  timeUs?: number
  contactSheet?: { frames: number[]; columns: number; rows: number }
  comparison?: { referenceItemId: string; referenceTimesUs: number[] }
}
export const VIDEO_EDIT_OBSERVATION_DEFAULT_WIDTH = 1920

/** A one-clip composition shows the original source pixels at an exact source time, through the production renderer. */
export function videoEditSourceComposition(document: VideoEditDocument, itemId: string, timeUs: number): VideoEditComposition {
  const item = document.items.find(value => value.id === itemId)
  const media = document.media.find(value => value.id === item?.mediaId)
  if (!item || !media) throw new Error('请指定剪辑中带源文件的视频或图片素材项。')
  if (media.kind === 'audio') throw new Error('声音素材没有画面，请改为读取波形或片段属性。')
  if (!Number.isSafeInteger(timeUs) || timeUs < 0 || media.kind === 'video' && timeUs >= Math.round(media.durationSeconds * 1e6)) throw new Error('源时间必须是素材时长内的非负整数微秒。')
  const frameRate = media.frameRate ?? { numerator: 60, denominator: 1 }
  const { width, height } = clampVideoEditSequenceSize(media)
  return {
    id: `observe-source-${item.id}`, name: item.name, width, height, frameRate, pixelAspectRatio: { numerator: 1, denominator: 1 }, sampleRate: 48000, channels: 2,
    tracks: [{ id: 'observe-picture', name: '画面', index: 1, kind: 'video', locked: false, enabled: true, muted: true, solo: false }],
    clips: [{ id: 'observe-clip', itemId: item.id, name: item.name, kind: media.kind, track: 1, start: 0, duration: 1, sourceInUs: media.kind === 'video' ? timeUs : 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 0, text: '' }],
    annotations: [], media: [media], items: [item], revision: document.revision, fps: videoEditFps(frameRate),
  }
}

/**
 * 观察图默认留在临时缓存；明确要作为创作素材使用时才登记到素材库。
 */
export function observeVideoEditFrame(projectId: string, target: VideoEditFrameObservationTarget, maxWidth: number | null | undefined, signal: AbortSignal | undefined, snapshot: VideoEditComposition | undefined, annotations: VideoEditFrameObservationOptions & { saveToAssets: true }): Promise<VideoEditFrameObservation & { asset: AssetRecord }>
export function observeVideoEditFrame(projectId: string, target: VideoEditFrameObservationTarget, maxWidth?: number | null, signal?: AbortSignal, snapshot?: VideoEditComposition, annotations?: VideoEditFrameObservationOptions): Promise<VideoEditFrameObservation>
export async function observeVideoEditFrame(projectId: string, target: VideoEditFrameObservationTarget, maxWidth: number | null = VIDEO_EDIT_OBSERVATION_DEFAULT_WIDTH, signal: AbortSignal = new AbortController().signal, snapshot?: VideoEditComposition, annotations: VideoEditFrameObservationOptions = {}): Promise<VideoEditFrameObservation> {
  // null 仅供工作区流转保存完整画幅；助手观察仍由公开 schema 限制尺寸预算。
  if (maxWidth !== null && (!Number.isSafeInteger(maxWidth) || maxWidth < 256 || maxWidth > 3840)) throw new Error('观察宽度须为256到3840之间的整数像素。')
  const owner = requireVideoEditInstance(projectId); const document = owner.document
  const contentVersion = owner.contentVersion
  const baseVersion = videoEditObservationVersion(owner, document.revision), documentVersion = annotations.documentVersion ?? baseVersion
  if (documentVersion !== baseVersion && !documentVersion.startsWith(`${baseVersion}|review:`)) throw new Error('检查计划对应的剪辑或跟踪结果已改变，请重新查询检查点后取帧。')
  if (documentVersion !== baseVersion && target.kind === 'source') throw new Error('视频检查计划用于序列画面，请按返回序列与检查帧观察。')
  const assertCurrent = (): void => { signal.throwIfAborted(); if (!isVideoEditContentCurrent(owner, contentVersion) || videoEditObservationVersion(owner, document.revision) !== baseVersion) throw new Error('观察期间剪辑已改变、关闭或跟踪结果更新，请重新取帧。') }
  assertCurrent()
  if (annotations.cropRegion) videoEditObservationRegionSchema.parse(annotations.cropRegion)
  if (annotations.cropRegion && annotations.cropAnnotationId) throw new Error('cropRegion 与 cropAnnotationId 只能选择一种裁切方式。')
  const measurements: CodeFramePerformance[] = []
  const started = performance.now()
  let composition: VideoEditComposition; let frame = 0
  if (target.kind !== 'source') {
    const sequenceId = target.sequenceId ?? owner.activeSequenceId
    if (!document.sequences.some(sequence => sequence.id === sequenceId)) throw new Error('目标序列不存在。')
    composition = snapshot ?? videoEditComposition(document, sequenceId)
    if (composition.id !== sequenceId || composition.revision !== document.revision) throw new Error('原片段版本已改变，请重新发送。')
    if (target.kind === 'program') {
      if (!Number.isSafeInteger(target.frame) || target.frame < 0 || target.frame >= Math.floor(composition.fps * VIDEO_EDIT_MAX_SEQUENCE_SECONDS)) throw new Error('请指定序列范围内的整数帧。')
      frame = target.frame
    }
  } else composition = videoEditSourceComposition(document, target.itemId, target.timeUs)
  const reviewSources = annotations.documentVersion && target.kind !== 'source' ? await verifyVideoEditReviewObservationSources(owner, annotations.documentVersion, composition.id, signal, assertCurrent) : []
  if (reviewSources.length) {
    const sources = new Map(reviewSources.map(media => [media.id, media]))
    composition = { ...composition, media: composition.media.map(media => {
      const pinned = sources.get(media.id)
      return pinned ? { ...media, assetContent: pinned.assetContent, sourceRevision: `${media.sourceRevision ?? ''}:review:${pinned.assetContent!.contentIdentity}` } : media
    }) }
  }
  const verifyReviewSources = async (): Promise<void> => {
    if (reviewSources.length) await verifyVideoEditReviewObservationSources(owner, documentVersion, composition.id, signal, assertCurrent)
    assertCurrent()
  }
  logger.info('剪辑指定画面观察开始', { event: 'video_edit.frame_observation.start', context: { projectId, kind: target.kind, revision: document.revision } })
  if (target.kind !== 'program' && (annotations.overlayAnnotations || annotations.annotationIds?.length || annotations.cropAnnotationId || annotations.highlightElement)) throw new Error('标注叠加、元素高亮与放大只用于序列合成帧。')
  if (target.kind === 'source' && annotations.reference) throw new Error('reference 用于成片与参考比较，请选择序列合成帧或联系表。')
  if (target.kind === 'contact_sheet' || target.kind === 'frames' || target.kind === 'near_cut' || annotations.reference) {
    if (annotations.overlayAnnotations || annotations.annotationIds?.length || annotations.cropAnnotationId || annotations.highlightElement) throw new Error('联系表与参考比较请使用 cropRegion 临时放大；标注与元素高亮用于单张合成帧。')
    const reference = annotations.reference
    const referenceMedia = reference ? document.media.find(media => media.id === document.items.find(item => item.id === reference.itemId)?.mediaId) : undefined
    if (reference && (!referenceMedia || referenceMedia.kind === 'audio')) throw new Error('reference.itemRef 须为本剪辑中的图片或视频素材。')
    const referenceTimesUs: number[] = []
    const identity = referenceMedia ? await getPlatform().assetLibrary.inspectFileContent(referenceMedia.path, referenceMedia.kind) : undefined
    assertCurrent()
    if (identity && referenceMedia?.assetContent && (referenceMedia.assetContent.contentIdentity && identity.contentIdentity !== referenceMedia.assetContent.contentIdentity || identity.sizeBytes !== referenceMedia.assetContent.sizeBytes || identity.fileModifiedAt !== referenceMedia.assetContent.fileModifiedAt)) throw new Error('参考素材已改变，请重新定位后观察。')
    const verifyReference = async (): Promise<void> => {
      assertCurrent()
      if (referenceMedia && identity) {
        const now = await getPlatform().assetLibrary.inspectFileContent(referenceMedia.path, referenceMedia.kind)
        if (now.contentIdentity !== identity.contentIdentity || now.sizeBytes !== identity.sizeBytes || now.fileModifiedAt !== identity.fileModifiedAt) throw new Error('观察期间参考素材已改变，请重新取帧。')
      }
      assertCurrent()
    }
    const selection = target.kind === 'program' ? { frames: [target.frame] } : target.kind === 'source' ? { frames: [0] } : target
    const sheet = await renderVideoEditContactSheet(composition, selection, maxWidth ?? VIDEO_EDIT_OBSERVATION_DEFAULT_WIDTH, signal, measurements, {
      cropRegion: annotations.cropRegion,
      ...(reference ? { reference: (frame: number) => {
        const timeUs = referenceMedia?.kind === 'image' ? 0 : Math.round(frame * 1e6 / composition.fps) + reference.offsetUs
        const source = videoEditSourceComposition(document, reference.itemId, timeUs); referenceTimesUs.push(timeUs)
        if (identity) source.media = source.media.map(media => ({ ...media, sourceRevision: `observe:${identity.contentIdentity ?? `${identity.sizeBytes}:${identity.fileModifiedAt}`}` }))
        return { document: source, frame: 0, label: `参考 ${(timeUs / 1e6).toFixed(3)} s` }
      } } : {}),
    })
    await verifyReference(); await verifyReviewSources()
    const published = await publishObservationImage(sheet.bytes, sheet.width, sheet.height, `${document.name} · ${composition.name} · ${reference ? '参考比较' : '联系表'}`, signal, assertCurrent, annotations.saveToAssets)
    await verifyReference(); await verifyReviewSources()
    logger.info('剪辑联系表观察完成', { event: 'video_edit.frame_observation.completed', context: { projectId, kind: target.kind, imageRef: published.resultRef, reused: published.reused, width: sheet.width, height: sheet.height, durationMs: Math.round(performance.now() - started) } })
    return { ...(measurements.length ? { performance: measurements } : {}), ...published, width: sheet.width, height: sheet.height, byteLength: sheet.bytes.byteLength, sourceWidth: composition.width, sourceHeight: composition.height,
      documentRevision: document.revision, documentVersion, sequenceId: composition.id, contactSheet: { frames: sheet.frames, columns: sheet.columns, rows: sheet.rows },
      ...(reference ? { comparison: { referenceItemId: reference.itemId, referenceTimesUs } } : {}) }
  }
  // Membership and frame validity do not depend on rendering. Only an element's
  // current crop bounds must wait for the worker's observation.
  const dynamicCrop = composition.annotations.find(mark => mark.id === annotations.cropAnnotationId)?.target.kind === 'element'
  prepareVideoEditAnnotationObservation(composition.annotations, frame, dynamicCrop
    ? { ...annotations, cropAnnotationId: undefined, annotationIds: [...(annotations.annotationIds ?? []), annotations.cropAnnotationId!] }
    : annotations)
  const bitmap = await trialVideoEditCodeFrames([{ document: composition, frame }], signal, true, undefined, measurements, target.kind === 'program' ? value => { assertCurrent(); installVideoEditCodeElements(owner, value) } : undefined)
  if (!bitmap) throw new Error('指定画面没有渲染结果，请重试。')
  let bytes: Uint8Array; let width: number; let height: number; const sourceWidth = bitmap.width; const sourceHeight = bitmap.height
  try {
  const marks = target.kind === 'program' ? composition.annotations.map(mark => resolveVideoEditElementAnnotation(owner, mark, composition.id, frame).mark) : composition.annotations
  const observation = prepareVideoEditAnnotationObservation(marks, frame, annotations)
  const highlight = annotations.highlightElement
  const entry = highlight ? videoEditCodeElementFrames(owner, composition.id, frame).get(highlight.clipId) : undefined
  const element = entry?.index.byId.get(highlight?.elementId ?? '')
  const elementRegion = entry && element ? videoEditCodeElementRegion(entry, element, composition) : undefined
  if (highlight && (!element || !elementRegion || element.opacity < .01)) throw new Error('要高亮的代码元素在指定帧不可见或已不存在，请检查片段和源码位置。')
    const crop = annotations.cropRegion ?? observation.crop
    const { x: sourceX, y: sourceY, width: cropWidth, height: cropHeight } = videoEditObservationPixelCrop(bitmap.width, bitmap.height, crop)
    width = maxWidth === null ? cropWidth : crop ? Math.max(1, Math.round(cropWidth * Math.min(maxWidth, Math.max(bitmap.width, bitmap.height)) / Math.max(cropWidth, cropHeight))) : Math.min(maxWidth, bitmap.width); height = Math.max(1, Math.round(cropHeight * width / cropWidth))
    const canvas = new OffscreenCanvas(width, height); const context = canvas.getContext('2d')
    if (!context) throw new Error('无法生成观察图片。')
    context.imageSmoothingQuality = 'high'
    if (crop) context.drawImage(bitmap, sourceX, sourceY, cropWidth, cropHeight, 0, 0, width, height)
    else context.drawImage(bitmap, 0, 0, width, height)
    if (observation.overlays.length) paintVideoEditAnnotationObservation(context, width, height, observation.overlays, crop)
    if (elementRegion && element) {
      const css = getComputedStyle(globalThis.document.documentElement)
      context.strokeStyle = `rgb(${css.getPropertyValue('--accent-rgb').trim()})`; context.fillStyle = context.strokeStyle
      context.lineWidth = 2
      const x = (elementRegion.x - (crop?.x ?? 0)) / (crop?.width ?? 1) * width; const y = (elementRegion.y - (crop?.y ?? 0)) / (crop?.height ?? 1) * height
      context.strokeRect(x, y, elementRegion.width / (crop?.width ?? 1) * width, elementRegion.height / (crop?.height ?? 1) * height)
      context.font = '14px sans-serif'; context.fillText(codeElementLabel(element), x + 4, Math.max(16, y - 4))
    }
    bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer())
  } finally { bitmap.close() }
  const label = target.kind === 'program' ? `帧 ${frame}` : `源 ${(target.timeUs / 1e6).toFixed(3)} 秒`
  assertCurrent()
  await verifyReviewSources()
  const published = await publishObservationImage(bytes, width, height, `${document.name} · ${composition.name} · ${label} 观察`, signal, assertCurrent, annotations.saveToAssets)
  await verifyReviewSources()
  logger.info('剪辑指定画面观察完成', { event: 'video_edit.frame_observation.completed', context: { projectId, kind: target.kind, imageRef: published.resultRef, reused: published.reused, width, height, durationMs: Math.round(performance.now() - started) } })
  return { ...(measurements.length ? { performance: measurements } : {}), ...published, width, height, byteLength: bytes.byteLength, sourceWidth, sourceHeight, documentRevision: document.revision, documentVersion, ...(target.kind === 'program' ? { sequenceId: composition.id, frame } : { timeUs: target.timeUs }) }
}

const imageWrites = new Map<string, Promise<boolean>>()
async function publishObservationImage(bytes: Uint8Array, width: number, height: number, displayName: string, signal: AbortSignal, assertCurrent: () => void, saveToAssets = false): Promise<Pick<VideoEditFrameObservation, 'asset' | 'image' | 'resultRef' | 'reused'>> {
  signal.throwIfAborted()
  const platform = getPlatform()
  if (!saveToAssets) {
    const { fs, paths } = platform.system
    const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))
    const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')
    const directory = await paths.join(await paths.tempDir(), 'henji-observations')
    const filePath = await paths.join(directory, `${hash}.png`)
    const pending = imageWrites.get(filePath)
    let reused = true
    if (pending) await pending
    else {
      // 同内容的并发观察共享一次写入，读取引用时不会碰到只写了一半的图片。
      const write = (async () => {
        if (await fs.exists(filePath)) {
          const cached = await fs.readFile(filePath)
          if (cached.byteLength === bytes.byteLength && cached.every((value, index) => value === bytes[index])) return true
        }
        // 中断写入可能留下不完整缓存；只复用完整内容，损坏的派生图可直接重建。
        await fs.mkdir(directory, { recursive: true }); await fs.writeFile(filePath, bytes); return false
      })()
      imageWrites.set(filePath, write)
      try { reused = await write } finally { if (imageWrites.get(filePath) === write) imageWrites.delete(filePath) }
    }
    assertCurrent()
    return { image: { filePath, displayUrl: platform.media.toDisplaySrc(filePath), displayName }, resultRef: { kind: 'observation.image', id: filePath }, reused }
  }
  const path = await platform.image.persistImageBinary(bytes, 'png')
  assertCurrent()
  await platform.media.allowRoot(await platform.system.paths.dirname(path))
  assertCurrent()
  const created = await addMediaReferenceToLibrary({ filePath: path, mediaType: 'image', source: 'video-edit', displayName: `${displayName} · 截帧` })
  // 显式保存代表用户要留下它；复用历史观察图时也退出自动清理。
  if (created.tags.includes(OBSERVATION_ASSET_TAG)) await assetApplicationService.replaceTags(created.id, created.tags.filter(tag => tag !== OBSERVATION_ASSET_TAG))
  const asset = await assetApplicationService.inspect(created.id)
  assertCurrent()
  if (asset.inspectionStatus !== 'ready' || asset.width !== width || asset.height !== height) throw new Error('观察图片没有通过资产检查，请重试。')
  return { asset, image: asset, resultRef: { kind: 'asset', id: asset.id }, reused: created.wasExisting === true }
}
