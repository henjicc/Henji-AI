import { createLogger } from '@/core/logging'
import type { VideoEditComposition } from '@/core/videoEdit/document'
import { getPlatform } from '@/platform/runtime'
import { editVideoProject, getActiveVideoEditSequence, listVideoEditInstances, requireVideoEditInstance, videoEditProgramCommandIdentity, type VideoEditInstance } from './videoEditService'
import { saveVideoEditPosterCover } from './videoEditProjectCover'
import { publishVideoEditOutput, verifyVideoEditOutput, type VideoEditOutputReceipt } from './videoEditOutputs'

const logger = createLogger('features.videoEdit.programCapture')
export interface VideoEditProgramCaptureRequest { document: VideoEditComposition; frame: number; assertCurrent(): void }
type Capture = (request: VideoEditProgramCaptureRequest, signal?: AbortSignal) => Promise<Blob>
const providers = new WeakMap<VideoEditInstance, { sequenceId: string; capture: Capture }>()
const pending = new WeakSet<VideoEditInstance>()
const published = new WeakMap<VideoEditInstance, { document: VideoEditInstance['document']; sequenceId: string; frame: number; output: VideoEditOutputReceipt }>()

export function registerVideoEditProgramCapture(owner: VideoEditInstance, sequenceId: string, capture: Capture): () => void {
  if (providers.has(owner)) throw new Error('此剪辑已有节目选帧宿主。')
  const provider = { sequenceId, capture }; providers.set(owner, provider)
  return () => { if (providers.get(owner) === provider) providers.delete(owner) }
}

/** The current real Program frame is captured; cached publication is retryable. */
export async function captureVideoEditProgramFrame(projectId: string, frame?: number, requestedPath?: string | (() => Promise<string>), signal?: AbortSignal): Promise<VideoEditOutputReceipt | null> {
  const owner = requireVideoEditInstance(projectId)
  if (pending.has(owner)) throw new Error('此剪辑正在保存节目选帧，请等待完成。')
  pending.add(owner)
  logger.info('开始保存节目选帧', { event: 'video_edit.program_frame.start', context: { projectId } })
  try {
    signal?.throwIfAborted()
    const target = frame ?? owner.frame
    if (!Number.isSafeInteger(target) || target < 0 || target !== owner.frame) throw new Error('请先将节目定位到要收录的整数帧。')
    if (owner.playing) throw new Error('请先暂停节目播放，再保存当前节目帧。')
    const baseline = owner.document; const document = getActiveVideoEditSequence(owner); const command = videoEditProgramCommandIdentity(projectId)
    const assertCurrent = (): void => {
      signal?.throwIfAborted()
      if (!listVideoEditInstances().includes(owner) || owner.document !== baseline || owner.activeSequenceId !== document.id || owner.frame !== target || owner.playing || videoEditProgramCommandIdentity(projectId) !== command) throw new Error('原节目帧已改变或剪辑已关闭，请重新选帧。')
    }
    const cached = published.get(owner)
    if (typeof requestedPath !== 'string' && cached?.document === baseline && cached.sequenceId === document.id && cached.frame === target) {
      try { await verifyVideoEditOutput(cached.output); assertCurrent(); return cached.output } catch (error) { assertCurrent(); published.delete(owner); logger.debug('已发布节目选帧不可复用', { event: 'video_edit.program_frame.cache_discarded', error }) }
    }
    const provider = providers.get(owner)
    if (!provider || provider.sequenceId !== document.id) throw new Error('请打开当前序列的节目面板后再选帧。')
    const platform = getPlatform()
    const path = typeof requestedPath === 'function' ? await requestedPath() : requestedPath ?? await platform.system.dialog.save({ defaultPath: `${baseline.name}-${target}.png`, filters: [{ name: 'PNG 图片', extensions: ['png'] }] })
    if (!path) return null
    assertCurrent()
    if (await platform.system.fs.exists(path)) throw new Error('请选择新的文件名保存选帧，避免覆盖已有文件。')
    const blob = await provider.capture({ document, frame: target, assertCurrent }, signal)
    assertCurrent()
    if (blob.type !== 'image/png' || !blob.size || blob.size > 128 * 1024 * 1024) throw new Error('节目选帧没有返回有效的PNG图片。')
    const bytes = new Uint8Array(await blob.arrayBuffer()); assertCurrent()
    await platform.system.fs.writeFile(path, bytes, { exclusive: true })
    // From this point the complete image is published. Collection failure or a
    // late cancellation must never remove it or cause a second frame capture.
    const output = await publishVideoEditOutput({ owner, sequenceId: document.id, revision: document.revision, path, name: `${baseline.name} · 帧 ${target}`, kind: 'image', frame: target })
    published.set(owner, { document: baseline, sequenceId: document.id, frame: target, output })
    assertCurrent()
    logger.info('节目选帧已保存', { event: 'video_edit.program_frame.completed', context: { projectId, outputId: output.id, frame: target } })
    return output
  } catch (error) {
    logger.warn('节目选帧未完成', { event: 'video_edit.program_frame.failed', error, context: { projectId } }); throw error
  } finally { pending.delete(owner) }
}

/**
 * “设为项目封面”（PR 的海报帧）：把节目当前实际画面存成这份剪辑的列表封面，并在剪辑里记下封面帧（可撤销），
 * 之后保存时不再自动换封面。
 */
export async function setVideoEditPosterFrame(projectId: string, signal?: AbortSignal): Promise<void> {
  const owner = requireVideoEditInstance(projectId)
  if (owner.playing) throw new Error('请先暂停节目播放，再设为封面。')
  const target = owner.frame
  const baseline = owner.document; const document = getActiveVideoEditSequence(owner)
  const provider = providers.get(owner)
  if (!provider || provider.sequenceId !== document.id) throw new Error('请打开当前序列的节目面板后再设为封面。')
  const assertCurrent = (): void => {
    signal?.throwIfAborted()
    if (!listVideoEditInstances().includes(owner) || owner.document !== baseline || owner.activeSequenceId !== document.id || owner.frame !== target || owner.playing) throw new Error('节目画面已变化，请重新设为封面。')
  }
  const blob = await provider.capture({ document, frame: target, assertCurrent }, signal)
  assertCurrent()
  if (!blob.size || blob.size > 128 * 1024 * 1024) throw new Error('节目画面没有返回有效的图片。')
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error ?? new Error('读取节目画面失败。'))
    reader.readAsDataURL(blob)
  })
  await saveVideoEditPosterCover(projectId, dataUrl)
  editVideoProject(projectId, value => ({ ...value, posterFrame: { sequenceId: document.id, frame: target } }))
  logger.info('已设为项目封面', { event: 'video_edit.poster_frame.set', context: { projectId, frame: target } })
}

/** 取消固定封面：去掉封面帧，下次保存按内容自动更新封面。 */
export function clearVideoEditPosterFrame(projectId: string): void {
  editVideoProject(projectId, ({ posterFrame: _posterFrame, ...value }) => value)
}
