import { createLogger } from '@/core/logging'
import { requireVideoEditInstance, listVideoEditInstances, subscribeVideoEdit, subscribeVideoEditView, publishVideoEdit, setVideoEditView, videoEditProgramCommandIdentity, restoreVideoEditProgramCommandIdentity, type VideoEditInstance } from './videoEditService'
import { verifyVideoEditMediaContent, videoEditMediaContentKey } from '../videoEditMediaContent'

const logger = createLogger('features.videoEdit.source')
export interface VideoEditSourceState {
  itemId: string
  timeUs: number
  presentedTimeUs: number
  playing: boolean
  volume: number
  inUs: number | null
  outUs: number | null
  playbackDirection: 1 | -1
  status: 'closed' | 'loading' | 'ready' | 'error'
  error: string
}
export interface VideoEditSourceRequest { itemId: string; timeUs: number; playing: boolean; volume: number; inUs?: number | null; outUs?: number | null; playbackDirection?: 1 | -1 }
export interface VideoEditSourceObservation { timeUs: number; presentedTimeUs: number; playing: boolean; volume: number; playbackDirection?: 1 | -1; error?: string }
export type VideoEditSourcePresenter = (request: VideoEditSourceRequest, signal: AbortSignal) => Promise<VideoEditSourceObservation>
interface PendingProgramPause { owner: VideoEditInstance; sequenceId: string; before: { frame: number; playing: boolean; playbackDirection: 1 | -1 }; beforeCommand: object; afterCommand: object }
interface SourceSession { state: VideoEditSourceState; presenter?: VideoEditSourcePresenter; retire?: () => Promise<void>; released?: Promise<void>; wake?: () => void; pending?: AbortController; requestedPlaying?: boolean; pendingProgramPause?: PendingProgramPause; epoch: number; command: object; mediaIdentity?: string; verifiedContent?: string }
export interface VideoEditSourceCommandIdentity { readonly owner: object; readonly command: object }
const sessions = new Map<string, SourceSession>()
const listeners = new Set<() => void>()
let revision = 0
function publish(): void { revision++; for (const listener of listeners) listener() }
export function subscribeVideoEditSource(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } }
export function videoEditSourceRevision(): number { return revision }
function session(projectId: string): SourceSession {
  requireVideoEditInstance(projectId)
  let current = sessions.get(projectId)
  if (!current) { current = { state: { itemId: '', timeUs: 0, presentedTimeUs: 0, playing: false, volume: 1, inUs: null, outUs: null, playbackDirection: 1, status: 'closed', error: '' }, epoch: 0, command: {} }; sessions.set(projectId, current) }
  return current
}
function mediaIdentity(projectId: string, itemId: string): string | undefined {
  const document = requireVideoEditInstance(projectId).document
  const item = document.items.find(item => item.id === itemId)
  const media = document.media.find(media => media.id === item?.mediaId)
  return media ? JSON.stringify([media.id, media.path, media.sourceRevision ?? null, media.width, media.height, media.frameRate ?? null]) : undefined
}
export function readVideoEditSource(projectId: string): VideoEditSourceState { return { ...session(projectId).state } }
export function registerVideoEditSourcePresenter(projectId: string, presenter: VideoEditSourcePresenter, retire?: () => Promise<void>): () => void {
  const current = session(projectId)
  if (current.presenter && current.presenter !== presenter) throw new Error('此工程已有源预览宿主。')
  current.presenter = presenter; current.retire = retire; current.wake?.()
  return () => { if (sessions.get(projectId) !== current || current.presenter !== presenter) return; closeVideoEditSource(projectId); current.presenter = undefined; current.retire = undefined }
}
function validateRequest(projectId: string, request: VideoEditSourceRequest): void {
  if (!Number.isSafeInteger(request.timeUs) || request.timeUs < 0) throw new Error('源定位必须使用非负整数微秒。')
  if (!Number.isFinite(request.volume) || request.volume < 0 || request.volume > 1) throw new Error('源预览音量必须在 0 到 1 之间。')
  if (request.playbackDirection !== undefined && request.playbackDirection !== 1 && request.playbackDirection !== -1) throw new Error('源预览播放方向无效。')
  if (!request.itemId) { if (request.playing || request.timeUs || request.inUs != null || request.outUs != null) throw new Error('请先打开一个源素材。'); return }
  const document = requireVideoEditInstance(projectId).document
  const item = document.items.find(item => item.id === request.itemId)
  const media = document.media.find(media => media.id === item?.mediaId)
  if (!item || !media) throw new Error('请打开一个有效的视频、图片或音频项目项。')
  if (media.kind === 'image' && (request.timeUs || request.playing)) throw new Error('静态图片不支持源播放或定位。')
  if (media.kind !== 'image' && request.timeUs > Math.round(media.durationSeconds * 1e6)) throw new Error('定位超出源素材时长。')
  for (const time of [request.inUs, request.outUs]) if (time !== null && time !== undefined && (!Number.isSafeInteger(time) || time < 0 || time > Math.round(media.durationSeconds * 1e6))) throw new Error('源入出点超出素材范围。')
  if (request.inUs != null && request.outUs != null && request.outUs <= request.inUs) throw new Error('源出点必须晚于入点。')
}
/** Commands finish only after the real preview acknowledges them; ticks never alter edit history. */
export async function updateVideoEditSource(projectId: string, values: Partial<VideoEditSourceRequest>, externalSignal?: AbortSignal): Promise<VideoEditSourceState> {
  externalSignal?.throwIfAborted()
  const current = session(projectId)
  const request = { itemId: current.state.itemId, timeUs: current.state.timeUs, playing: current.state.playing, volume: current.state.volume, inUs: current.state.inUs, outUs: current.state.outUs, playbackDirection: current.state.playbackDirection, ...values }
  if (values.itemId !== undefined && values.itemId !== current.state.itemId) { request.timeUs = values.timeUs ?? 0; request.playing = values.playing ?? false; request.inUs = values.inUs ?? null; request.outUs = values.outUs ?? null; request.playbackDirection = values.playbackDirection ?? 1 }
  validateRequest(projectId, request)
  const owner = requireVideoEditInstance(projectId)
  const inheritedPause = current.pendingProgramPause
  let programPause = inheritedPause?.owner === owner && inheritedPause.sequenceId === owner.activeSequenceId && inheritedPause.afterCommand === videoEditProgramCommandIdentity(projectId) ? inheritedPause : undefined
  if (request.playing && owner.playing) {
    const before = { frame: owner.frame, playing: owner.playing, playbackDirection: owner.playbackDirection }
    const beforeCommand = videoEditProgramCommandIdentity(projectId)
    const afterCommand = setVideoEditView(projectId, { playing: false })
    programPause = { owner, sequenceId: owner.activeSequenceId, before, beforeCommand, afterCommand }
  }
  if (!request.itemId && !current.presenter) { current.state.volume = request.volume; closeVideoEditSource(projectId); publishVideoEdit(true); return readVideoEditSource(projectId) }
  current.pending?.abort(new Error('源预览请求已被更新。'))
  const controller = new AbortController(); current.pending = controller
  current.requestedPlaying = request.playing
  current.pendingProgramPause = programPause
  const cancel = (): void => controller.abort(externalSignal?.reason ?? new Error('源预览请求已取消。'))
  externalSignal?.addEventListener('abort', cancel, { once: true })
  const unsubscribeProgram = request.playing ? subscribeVideoEditView(() => { if (!listVideoEditInstances().includes(owner) || owner.playing) controller.abort(new Error('节目已有后续播放操作，源请求已取消。')) }) : () => {}
  const epoch = ++current.epoch
  current.command = {}
  const timeout = setTimeout(() => controller.abort(new Error('源预览未能及时响应，请打开源面板后重试。')), 10000)
  current.state = { ...current.state, itemId: request.itemId, ...(request.itemId !== current.state.itemId ? { timeUs: request.timeUs, presentedTimeUs: 0 } : {}), playing: false, status: request.itemId ? 'loading' : 'closed', error: '' }
  current.mediaIdentity = mediaIdentity(projectId, request.itemId)
  publish()
  logger.debug('源预览请求开始', { event: 'video_edit.source.request.start', context: { projectId, itemId: request.itemId } })
  try {
    const item = owner.document.items.find(item => item.id === request.itemId)
    const media = owner.document.media.find(media => media.id === item?.mediaId)
    const contentKey = media ? videoEditMediaContentKey(media) : undefined
    if (current.verifiedContent !== contentKey) current.verifiedContent = undefined
    if (media?.assetContent?.contentIdentity && current.verifiedContent !== contentKey) {
      await verifyVideoEditMediaContent(media, controller.signal)
      controller.signal.throwIfAborted()
      if (epoch !== current.epoch || requireVideoEditInstance(projectId) !== owner) throw new Error('源预览请求已被更新。')
      current.verifiedContent = contentKey
    }
    if (!current.presenter) await new Promise<void>((resolve, reject) => {
      const onAbort = (): void => { current.wake = undefined; reject(controller.signal.reason) }
      current.wake = () => { current.wake = undefined; controller.signal.removeEventListener('abort', onAbort); resolve() }
      controller.signal.addEventListener('abort', onAbort, { once: true })
    })
    controller.signal.throwIfAborted()
    const observation = await Promise.race([
      current.presenter!(request, controller.signal),
      new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true })),
    ])
    controller.signal.throwIfAborted()
    if (epoch !== current.epoch) throw new Error('源预览请求已被更新。')
    validateRequest(projectId, { ...request, timeUs: observation.timeUs, playing: observation.playing, volume: observation.volume })
    if ((!request.playing && Math.abs(request.timeUs - observation.timeUs) > 1000) || request.playing !== observation.playing) throw new Error('源预览未能确认所请求的播放或定位状态。')
    if ((observation.playbackDirection ?? 1) !== request.playbackDirection && request.playing) throw new Error('源预览未能确认所请求的播放方向。')
    if (!Number.isSafeInteger(observation.presentedTimeUs) || observation.presentedTimeUs < 0) throw new Error('源预览未返回有效画面位置。')
    if (Math.abs(request.volume - observation.volume) > 1e-6) throw new Error('源预览未能确认所请求的音量。')
    current.state = { itemId: request.itemId, ...observation, inUs: request.inUs, outUs: request.outUs, playbackDirection: request.playbackDirection, status: request.itemId ? 'ready' : 'closed', error: '' }
    publish(); publishVideoEdit(true)
    controller.signal.throwIfAborted()
    logger.debug('源预览请求完成', { event: 'video_edit.source.request.completed', context: { projectId, itemId: request.itemId } })
    return readVideoEditSource(projectId)
  } catch (error) {
    const canceled = controller.signal.aborted
    if (epoch === current.epoch && sessions.get(projectId) === current) {
      controller.abort(error)
      current.verifiedContent = undefined
      const released = current.retire?.()
      current.released = released ?? current.released
      current.state = { ...current.state, playing: false, status: 'error', error: error instanceof Error ? error.message : String(error) }; publish()
      await released
    }
    if (programPause && sessions.get(projectId) === current && epoch === current.epoch && listVideoEditInstances().includes(owner) && owner.activeSequenceId === programPause.sequenceId && videoEditProgramCommandIdentity(projectId) === programPause.afterCommand) {
      const restored = setVideoEditView(projectId, programPause.before)
      restoreVideoEditProgramCommandIdentity(projectId, restored, programPause.beforeCommand)
    }
    if (canceled) logger.debug('源预览请求已取消并释放', { event: 'video_edit.source.request.cancelled', context: { projectId } })
    else logger.warn('源预览请求未完成并释放', { event: 'video_edit.source.request.failed', error, context: { projectId } })
    throw error
  } finally { clearTimeout(timeout); unsubscribeProgram(); externalSignal?.removeEventListener('abort', cancel); if (current.pending === controller) { current.pending = undefined; current.requestedPlaying = undefined; current.pendingProgramPause = undefined } }
}
/** Foreground program playback waits until the source has paused and retired its reverse cache. */
export async function yieldVideoEditSource(projectId: string): Promise<void> {
  await pauseVideoEditSourceForProgram(projectId)
}
export interface VideoEditSourcePause {
  readonly before: VideoEditSourceRequest
  readonly after: VideoEditSourceRequest
  readonly beforeCommand: VideoEditSourceCommandIdentity
  readonly afterCommand: VideoEditSourceCommandIdentity
}
/** Domain callers record the same pause acknowledged by the physical source presenter. */
export async function pauseVideoEditSourceForProgram(projectId: string, signal?: AbortSignal): Promise<VideoEditSourcePause | undefined> {
  const current = session(projectId)
  await current.released
  if (sessions.get(projectId) !== current) throw new Error('原源预览会话已关闭，请重新选择节目操作。')
  if (current.pending && !current.requestedPlaying) throw new Error('源预览仍在确认定位或暂停，请稍后重试节目播放。')
  if (!current.state.playing && !current.requestedPlaying) return undefined
  const { itemId, timeUs, playing, volume, inUs, outUs, playbackDirection } = current.state
  const before = { itemId, timeUs, playing, volume, inUs, outUs, playbackDirection }
  const beforeCommand = videoEditSourceCommandIdentity(projectId)
  const pending = updateVideoEditSource(projectId, { playing: false }, signal)
  const afterCommand = videoEditSourceCommandIdentity(projectId)
  await pending
  if (!matchesVideoEditSourceCommand(projectId, afterCommand)) throw new Error('源预览已有后续操作，节目尚未开始。')
  const after = readVideoEditSource(projectId)
  return { before, after, beforeCommand, afterCommand }
}
export async function restoreVideoEditSourcePause(projectId: string, pause: VideoEditSourcePause, signal?: AbortSignal): Promise<void> {
  if (!matchesVideoEditSourceCommand(projectId, pause.afterCommand)) throw new Error('源预览已有后续操作，无法恢复旧节目操作。')
  const pending = updateVideoEditSource(projectId, pause.before, signal)
  const restoring = videoEditSourceCommandIdentity(projectId)
  await pending
  signal?.throwIfAborted()
  restoreVideoEditSourceCommandIdentity(projectId, restoring, pause.beforeCommand)
}
/** A rejected inverse restores the confirmed paused source only while it still owns the request. */
export async function revertVideoEditSourcePause(projectId: string, pause: VideoEditSourcePause, expected: VideoEditSourceCommandIdentity): Promise<void> {
  if (!matchesVideoEditSourceCommand(projectId, expected)) throw new Error('源预览已有后续操作，未覆盖新源状态。')
  const { itemId, timeUs, playing, volume, inUs, outUs, playbackDirection } = pause.after
  const pending = updateVideoEditSource(projectId, { itemId, timeUs, playing, volume, inUs, outUs, playbackDirection })
  const restoring = videoEditSourceCommandIdentity(projectId)
  await pending
  restoreVideoEditSourceCommandIdentity(projectId, restoring, pause.afterCommand)
}
export function observeVideoEditSource(projectId: string, itemId: string, observation: VideoEditSourceObservation): void {
  const current = sessions.get(projectId)
  if (!current || current.pending || current.state.itemId !== itemId || current.state.status !== 'ready') return
  if (![observation.timeUs, observation.presentedTimeUs].every(value => Number.isSafeInteger(value) && value >= 0)) return
  if (!Number.isFinite(observation.volume) || observation.volume < 0 || observation.volume > 1) return
  current.state = { ...current.state, ...observation, ...(observation.error ? { status: 'error', error: observation.error } : {}) }; publish()
}
export function closeVideoEditSource(projectId: string): void {
  const current = sessions.get(projectId)
  if (!current) return
  const pause = current.pendingProgramPause
  current.verifiedContent = undefined
  current.epoch++; current.command = {}; current.pending?.abort(new Error('源预览已关闭。')); current.pending = undefined; current.requestedPlaying = undefined; current.pendingProgramPause = undefined
  current.released = current.retire?.() ?? current.released
  current.state = { itemId: '', timeUs: 0, presentedTimeUs: 0, playing: false, volume: current.state.volume, inUs: null, outUs: null, playbackDirection: 1, status: 'closed', error: '' }
  if (pause && listVideoEditInstances().includes(pause.owner) && pause.owner.activeSequenceId === pause.sequenceId && videoEditProgramCommandIdentity(projectId) === pause.afterCommand) {
    const restored = setVideoEditView(projectId, pause.before)
    restoreVideoEditProgramCommandIdentity(projectId, restored, pause.beforeCommand)
  }
  publish()
}
export function videoEditSourceCommandIdentity(projectId: string): VideoEditSourceCommandIdentity {
  const current = session(projectId)
  return { owner: current, command: current.command }
}
export function matchesVideoEditSourceCommand(projectId: string, identity: VideoEditSourceCommandIdentity): boolean {
  const current = sessions.get(projectId)
  return current === identity.owner && current.command === identity.command
}
/** Rejoin the logical command chain after a verified inverse; playback observations do not change it. */
export function restoreVideoEditSourceCommandIdentity(projectId: string, expected: VideoEditSourceCommandIdentity, previous: VideoEditSourceCommandIdentity): void {
  if (!matchesVideoEditSourceCommand(projectId, expected) || expected.owner !== previous.owner) throw new Error('源预览已有后续操作，无法恢复旧操作记录。')
  sessions.get(projectId)!.command = previous.command
}
subscribeVideoEdit(() => {
  const opened = listVideoEditInstances()
  for (const [id, current] of sessions) {
    const instance = opened.find(instance => instance.document.id === id)
    if (!instance) { closeVideoEditSource(id); sessions.delete(id) }
    else if (current.state.itemId && mediaIdentity(id, current.state.itemId) !== current.mediaIdentity) closeVideoEditSource(id)
  }
})
