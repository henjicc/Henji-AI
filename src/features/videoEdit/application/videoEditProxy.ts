import { z } from 'zod'
import type { VideoEditMedia } from '@/core/videoEdit/document'
import type { VideoEditProxyPreference, VideoEditProxyState, VideoProxyPreset, VideoProxyResult } from '@/core/videoEdit/proxy'
import { getPlatform } from '@/platform/runtime'
import { createLogger } from '@/core/logging'
import { listVideoEditInstances, publishVideoEdit, requireVideoEditInstance, subscribeVideoEditDomain, type VideoEditInstance } from './videoEditService'

const logger = createLogger('features.videoEdit.proxy')
const preferences = new Map<string, VideoEditProxyPreference>()
const preferenceSchema = z.object({ enabled: z.boolean(), autoCreate: z.boolean() }).strict()
interface Entry { media: VideoEditMedia; result?: VideoProxyResult; controller?: AbortController; state: VideoEditProxyState }
const entries = new WeakMap<VideoEditInstance, Map<string, Entry>>()
const tasks = new Set<{ owner: VideoEditInstance; controller: AbortController }>()
subscribeVideoEditDomain(() => {
  for (const task of tasks) if (!listVideoEditInstances().includes(task.owner)) task.controller.abort(new Error('原剪辑已关闭，代理创建已取消。'))
})
export function getVideoEditProxyPreference(projectId: string): VideoEditProxyPreference {
  let value = preferences.get(projectId)
  if (!value) {
    try { value = preferenceSchema.parse(JSON.parse(localStorage.getItem(`videoEdit.proxy.${projectId}`) ?? 'null')) } catch { value = { enabled: false, autoCreate: false } }
    preferences.set(projectId, value)
  }
  return { ...value }
}
/** Tests that replace local storage must also discard its in-memory projection. */
export function resetVideoEditProxyPreferenceCache(): void { preferences.clear() }
export function setVideoEditProxyPreference(projectId: string, patch: Partial<VideoEditProxyPreference>): void {
  requireVideoEditInstance(projectId)
  const value = preferenceSchema.parse({ ...getVideoEditProxyPreference(projectId), ...patch })
  preferences.set(projectId, value)
  try { localStorage.setItem(`videoEdit.proxy.${projectId}`, JSON.stringify(value)) } catch (error) { logger.warn('代理偏好未保存', { event: 'video_edit.proxy.preference_failed', error }) }
  publishVideoEdit()
}
function entry(projectId: string, mediaId: string): Entry | undefined {
  const owner = requireVideoEditInstance(projectId); const media = owner.document.media.find(value => value.id === mediaId)
  const current = entries.get(owner)?.get(mediaId)
  if (current && media && current.media.path === media.path && current.media.sourceRevision === media.sourceRevision) return current
  current?.controller?.abort(new Error('原素材已改变，代理创建已取消。'))
  entries.get(owner)?.delete(mediaId)
  return undefined
}
export function readVideoEditProxyState(projectId: string, mediaId: string): VideoEditProxyState {
  return { ...(entry(projectId, mediaId)?.state ?? { status: 'none', progress: 0, error: '' }) }
}
export function getVideoEditProxySources(projectId: string): Record<string, VideoProxyResult> {
  if (!getVideoEditProxyPreference(projectId).enabled) return {}
  const owner = requireVideoEditInstance(projectId)
  return Object.fromEntries(owner.document.media.flatMap(media => { const result = entry(projectId, media.id)?.result; return result ? [[media.id, result]] : [] }))
}
/** Before a decoder opens, recheck content identity and evicted cache files through the trusted host. */
export async function verifiedVideoEditProxySources(projectId: string): Promise<Record<string, VideoProxyResult>> {
  const owner = requireVideoEditInstance(projectId)
  if (!getVideoEditProxyPreference(projectId).enabled) return {}
  // A monitor can open without the project panel being mounted; restore its cache through the same state reader.
  for (const media of owner.document.media) if (media.kind === 'video') await ensureVideoEditProxyState(projectId, media.id)
  if (!listVideoEditInstances().includes(owner)) throw new Error('原剪辑已关闭。')
  const sources = getVideoEditProxySources(projectId)
  const verified: Record<string, VideoProxyResult> = {}
  for (const [id, result] of Object.entries(sources)) {
    const current = entry(projectId, id)
    if (!current) continue
    const cached = await getPlatform().videoProxy.lookup({ source: current.media.path, preset: result.preset })
    if (!listVideoEditInstances().includes(owner)) throw new Error('原剪辑已关闭。')
    if (entry(projectId, id) !== current || current.result !== result) continue
    if (cached?.key === result.key) verified[id] = cached
    else { current.result = undefined; if (!current.controller) current.state = { status: 'none', progress: 0, error: '' }; publishVideoEdit() }
  }
  return getVideoEditProxyPreference(projectId).enabled ? verified : {}
}
export function videoEditProxySignature(projectId: string): string {
  return JSON.stringify(Object.entries(getVideoEditProxySources(projectId)).map(([id, result]) => [id, result.key]))
}
function mediaOf(projectId: string, mediaId: string): VideoEditMedia {
  const media = requireVideoEditInstance(projectId).document.media.find(value => value.id === mediaId)
  if (!media || media.kind !== 'video') throw new Error('创建代理需要视频素材。')
  return media
}
/** Restore only checked cache entries. Does not create a proxy or modify the document. */
export async function refreshVideoEditProxies(projectId: string, signal?: AbortSignal): Promise<void> {
  const owner = requireVideoEditInstance(projectId)
  for (const media of owner.document.media.filter(value => value.kind === 'video')) {
    signal?.throwIfAborted()
    if (entry(projectId, media.id)?.controller) continue
    let result: VideoProxyResult | null = null
    for (const preset of ['720p', '540p'] as const) { result = await getPlatform().videoProxy.lookup({ source: media.path, preset }); if (result) break }
    signal?.throwIfAborted()
    if (!listVideoEditInstances().includes(owner)) return
    const current = owner.document.media.find(value => value.id === media.id)
    if (current?.path !== media.path || current.sourceRevision !== media.sourceRevision || entry(projectId, media.id)?.controller) continue
    let values = entries.get(owner); if (!values) { values = new Map(); entries.set(owner, values) }
    values.set(media.id, { media, ...(result ? { result } : {}), state: { status: result ? 'ready' : 'none', progress: result ? 1 : 0, error: '' } })
  }
  publishVideoEdit()
}
export async function ensureVideoEditProxyState(projectId: string, mediaId: string): Promise<void> {
  if (entry(projectId, mediaId)) return
  const owner = requireVideoEditInstance(projectId); const media = owner.document.media.find(value => value.id === mediaId)
  if (!media || media.kind !== 'video') return
  let result: VideoProxyResult | null = null
  for (const preset of ['720p', '540p'] as const) { result = await getPlatform().videoProxy.lookup({ source: media.path, preset }); if (result) break }
  const current = owner.document.media.find(value => value.id === mediaId)
  if (!listVideoEditInstances().includes(owner) || current?.path !== media.path || current.sourceRevision !== media.sourceRevision || entry(projectId, mediaId)) return
  let values = entries.get(owner); if (!values) { values = new Map(); entries.set(owner, values) }
  values.set(media.id, { media, ...(result ? { result } : {}), state: { status: result ? 'ready' : 'none', progress: result ? 1 : 0, error: '' } })
  publishVideoEdit()
}
export async function createVideoEditProxy(projectId: string, mediaId: string, preset: VideoProxyPreset, signal?: AbortSignal): Promise<VideoProxyResult> {
  const owner = requireVideoEditInstance(projectId); const media = mediaOf(projectId, mediaId)
  if (entry(projectId, mediaId)?.controller) throw new Error('此素材正在创建代理。')
  signal?.throwIfAborted()
  const controller = new AbortController(); const requestId = crypto.randomUUID()
  let values = entries.get(owner); if (!values) { values = new Map(); entries.set(owner, values) }
  const previous = entry(projectId, mediaId)
  const current: Entry = { media, ...(previous?.result ? { result: previous.result } : {}), controller, state: { status: 'generating', progress: 0, error: '' } }
  values.set(mediaId, current)
  const task = { owner, controller }; tasks.add(task)
  const cancel = (): void => { void getPlatform().videoProxy.cancel(requestId).catch(error => logger.warn('代理取消未确认', { event: 'video_edit.proxy.cancel_failed', error })) }
  const abort = (): void => controller.abort(signal?.reason ?? new Error('代理创建已取消。'))
  const unsubscribe = getPlatform().videoProxy.onProgress(event => { if (event.requestId === requestId && !controller.signal.aborted) { current.state.progress = event.progress; publishVideoEdit() } })
  controller.signal.addEventListener('abort', cancel, { once: true }); signal?.addEventListener('abort', abort, { once: true })
  publishVideoEdit()
  logger.info('创建素材代理', { event: 'video_edit.proxy.start', context: { projectId, mediaId, preset } })
  try {
    if (signal?.aborted) abort()
    controller.signal.throwIfAborted()
    const result = await getPlatform().videoProxy.create({ requestId, source: media.path, preset })
    controller.signal.throwIfAborted()
    if (!listVideoEditInstances().includes(owner) || entry(projectId, mediaId) !== current) throw new Error('原素材已改变，未使用旧代理。')
    current.result = result; current.state = { status: 'ready', progress: 1, error: '' }
    logger.info('素材代理已创建', { event: 'video_edit.proxy.completed', context: { projectId, mediaId } })
    return result
  } catch (error) {
    current.state = { status: current.result ? 'ready' : 'none', progress: current.result ? 1 : 0, error: controller.signal.aborted ? '' : error instanceof Error ? error.message : String(error) }
    logger.warn('素材代理创建未完成', { event: controller.signal.aborted ? 'video_edit.proxy.cancelled' : 'video_edit.proxy.failed', error, context: { projectId, mediaId } })
    throw error
  } finally { current.controller = undefined; tasks.delete(task); unsubscribe(); signal?.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', cancel); publishVideoEdit() }
}
export function cancelVideoEditProxy(projectId: string, mediaId: string): void { entry(projectId, mediaId)?.controller?.abort(new Error('代理创建已取消。')) }
/** Import is already committed; proxy failures are visible state, never roll back imported originals. Serial queue avoids CPU oversubscription. */
export async function autoCreateVideoEditProxies(projectId: string, mediaIds: readonly string[]): Promise<void> {
  if (!getVideoEditProxyPreference(projectId).autoCreate) return
  const owner = requireVideoEditInstance(projectId)
  for (const mediaId of new Set(mediaIds)) {
    if (!listVideoEditInstances().includes(owner)) return
    const media = owner.document.media.find(value => value.id === mediaId)
    if (!media || media.kind !== 'video' || media.height <= 1080 && media.width <= 1920) continue
    try { await createVideoEditProxy(projectId, mediaId, '720p') } catch (error) { if (error instanceof Error && /已取消|已关闭/.test(error.message)) return /* Other errors remain visible in the common proxy state. */ }
  }
}
