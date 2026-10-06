import { createLogger } from '@/core/logging'
import { videoEditComposition, type VideoEditComposition, type VideoEditDocument } from '@/core/videoEdit/document'
import { videoEditFps } from '@/core/videoEdit/time'
import type { AssetRecord } from '@/platform/contracts/assetLibrary'
import { getPlatform } from '@/platform/runtime'
import { addMediaReferenceToLibrary } from '@/features/assets/services/assetCollectionService'
import { assetApplicationService } from '@/features/assets/application/assetApplicationService'
import { trialVideoEditCodeFrames } from './videoEditCodeTrial'
import { requireVideoEditInstance } from './videoEditService'

const logger = createLogger('features.videoEdit.frameObservation')
export type VideoEditFrameObservationTarget =
  | { kind: 'program'; sequenceId?: string; frame: number }
  | { kind: 'source'; itemId: string; timeUs: number }
export interface VideoEditFrameObservation {
  asset: AssetRecord
  width: number
  height: number
  sourceWidth: number
  sourceHeight: number
  documentRevision: number
  sequenceId?: string
  frame?: number
  timeUs?: number
}
export const VIDEO_EDIT_OBSERVATION_DEFAULT_WIDTH = 1920

/** A one-clip composition shows the original source pixels at an exact source time, through the production renderer. */
function sourceComposition(document: VideoEditDocument, itemId: string, timeUs: number): VideoEditComposition {
  const item = document.items.find(value => value.id === itemId)
  const media = document.media.find(value => value.id === item?.mediaId)
  if (!item || !media) throw new Error('请指定剪辑中带源文件的视频或图片素材项。')
  if (media.kind === 'audio') throw new Error('声音素材没有画面，请改为读取波形或片段属性。')
  if (!Number.isSafeInteger(timeUs) || timeUs < 0 || media.kind === 'video' && timeUs >= Math.round(media.durationSeconds * 1e6)) throw new Error('源时间必须是素材时长内的非负整数微秒。')
  const frameRate = media.frameRate ?? { numerator: 60, denominator: 1 }
  const width = Math.max(16, Math.min(4096, media.width)); const height = Math.max(16, Math.min(4096, media.height))
  return {
    id: `observe-source-${item.id}`, name: item.name, width, height, frameRate, pixelAspectRatio: { numerator: 1, denominator: 1 }, sampleRate: 48000, channels: 2,
    tracks: [{ id: 'observe-picture', name: '画面', index: 1, kind: 'video', locked: false, enabled: true, muted: true, solo: false }],
    clips: [{ id: 'observe-clip', itemId: item.id, name: item.name, kind: media.kind, track: 1, start: 0, duration: 1, sourceInUs: media.kind === 'video' ? timeUs : 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 0, brightness: 1, text: '' }],
    annotations: [], media: [media], items: [item], revision: document.revision, fps: videoEditFps(frameRate),
  }
}

/**
 * Renders one fixed-revision Program frame or Source time offscreen and publishes it as a library image.
 * The user's playhead, selection and Program surface are untouched; the bounded production trial queue is reused.
 */
export async function observeVideoEditFrame(projectId: string, target: VideoEditFrameObservationTarget, maxWidth = VIDEO_EDIT_OBSERVATION_DEFAULT_WIDTH, signal: AbortSignal = new AbortController().signal): Promise<VideoEditFrameObservation> {
  if (!Number.isSafeInteger(maxWidth) || maxWidth < 256 || maxWidth > 3840) throw new Error('观察宽度须为256到3840之间的整数像素。')
  const owner = requireVideoEditInstance(projectId); const document = owner.document
  const started = performance.now()
  let composition: VideoEditComposition; let frame = 0
  if (target.kind === 'program') {
    const sequenceId = target.sequenceId ?? owner.activeSequenceId
    if (!document.sequences.some(sequence => sequence.id === sequenceId)) throw new Error('目标序列不存在。')
    composition = videoEditComposition(document, sequenceId)
    if (!Number.isSafeInteger(target.frame) || target.frame < 0 || target.frame >= Math.floor(composition.fps * 1800)) throw new Error('请指定序列范围内的整数帧。')
    frame = target.frame
  } else composition = sourceComposition(document, target.itemId, target.timeUs)
  logger.info('剪辑指定画面观察开始', { event: 'video_edit.frame_observation.start', context: { projectId, kind: target.kind, revision: document.revision } })
  const bitmap = await trialVideoEditCodeFrames([{ document: composition, frame }], signal, true)
  if (!bitmap) throw new Error('指定画面没有渲染结果，请重试。')
  let bytes: Uint8Array; let width: number; let height: number; const sourceWidth = bitmap.width; const sourceHeight = bitmap.height
  try {
    width = Math.min(maxWidth, bitmap.width); height = Math.max(1, Math.round(bitmap.height * width / bitmap.width))
    const canvas = new OffscreenCanvas(width, height); const context = canvas.getContext('2d')
    if (!context) throw new Error('无法生成观察图片。')
    context.imageSmoothingQuality = 'high'; context.drawImage(bitmap, 0, 0, width, height)
    bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer())
  } finally { bitmap.close() }
  signal.throwIfAborted()
  const platform = getPlatform()
  const path = await platform.image.persistImageBinary(bytes, 'png')
  await platform.media.allowRoot(await platform.system.paths.dirname(path))
  const label = target.kind === 'program' ? `帧 ${frame}` : `源 ${(target.timeUs / 1e6).toFixed(3)} 秒`
  const created = await addMediaReferenceToLibrary({ filePath: path, mediaType: 'image', source: 'video-edit', displayName: `${document.name} · ${composition.name} · ${label} 观察` })
  const asset = await assetApplicationService.inspect(created.id)
  if (asset.inspectionStatus !== 'ready' || asset.width !== width || asset.height !== height) throw new Error('观察图片没有通过资产检查，请重试。')
  logger.info('剪辑指定画面观察完成', { event: 'video_edit.frame_observation.completed', context: { projectId, kind: target.kind, assetId: asset.id, width, height, durationMs: Math.round(performance.now() - started) } })
  return { asset, width, height, sourceWidth, sourceHeight, documentRevision: document.revision, ...(target.kind === 'program' ? { sequenceId: composition.id, frame } : { timeUs: target.timeUs }) }
}
