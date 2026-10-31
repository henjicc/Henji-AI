import { useVideoEditEffectLibraryStore } from './videoEditEffectPresets'
import { renderFingerprintHash, type VideoEditCodeFingerprints, type VideoEditFrameFingerprint } from '@/core/videoEdit/renderFingerprint'
import { videoEditPictureTransitionWindows, videoEditPictureFilter, type VideoEditComposition } from '@/core/videoEdit/document'
import { codeMaterialVersion } from '@/core/videoEdit/codeMaterialDocument'
import { codeVersionContentKey } from '@/core/videoEdit/codeMaterial/sources'
import { VideoEditRenderSession } from '../engine/videoEditRenderSession'
import { videoEditCodeInputs, type VideoEditCodeDeclarationReader, type VideoEditCodeInputs } from '@/core/videoEdit/codeInputParameters'
import { isCodeImageReference } from '@/core/videoEdit/codeMaterial/contract'
import { videoEditSceneRecordMediaIds } from '@/core/videoEdit/scene/sceneMedia'
import { videoEditRenderPictureClip, videoEditRenderWindowRanges } from '@/core/videoEdit/renderCache'
import { listVideoEditInstances, type VideoEditInstance } from './videoEditService'
import { createLogger } from '@/core/logging'

const logger = createLogger('features.videoEdit.renderCache')
interface ClipCache { usedAt: number; signature: string; startFrame: number; endFrame: number; frames: Map<number, VideoEditFrameFingerprint> }
interface Snapshot { result: VideoEditCodeFingerprints; contentVersion: number; running: boolean; retryAt: number; current: () => boolean }
const owners = new WeakMap<VideoEditInstance, Map<string, ClipCache>>()
const snapshots = new WeakMap<VideoEditComposition, Map<string, Snapshot>>()
const clipKeys = new WeakMap<VideoEditComposition, Map<string, { environment: string; inputs: VideoEditCodeInputs | undefined; key: string }>>()
// 各序列按批次争用一个计算槽；当前序列总能在下一批获得执行机会。
const turns: Array<{ priority: () => number; run: () => Promise<void> }> = []
let calculating = false
function calculationTurn<T>(priority: () => number, run: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    turns.push({ priority, run: async () => { try { resolve(await run()) } catch (error) { reject(error) } } })
    if (!calculating) { calculating = true; queueMicrotask(() => { void drainTurns() }) }
  })
}
async function drainTurns(): Promise<void> {
  try { while (turns.length) { turns.sort((a, b) => a.priority() - b.priority()); await turns.shift()!.run() } }
  finally { calculating = false }
}
const environments = new WeakMap<VideoEditInstance, Map<string, string>>()
const CACHE_BYTES = 32 * 1024 * 1024
// 仅限制可重建缓存的驻留量；超出后淘汰最久未用帧表，作品规模不受限制。
function trim(cache: Map<string, ClipCache>, keep: ReadonlySet<ClipCache>): void {
  let bytes = [...cache.values()].reduce((sum, entry) => sum + entry.frames.size * 160, 0)
  for (const [key, entry] of [...cache].sort((a, b) => a[1].usedAt - b[1].usedAt)) {
    if (bytes <= CACHE_BYTES && cache.size <= 128) break
    if (keep.has(entry)) continue
    bytes -= entry.frames.size * 160; cache.delete(key)
  }
}

const listeners = new Set<() => void>()
export function subscribeVideoEditRenderFingerprints(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } }
let publication: ReturnType<typeof setTimeout> | undefined
let publicationPending = false
const publish = (): void => {
  if (publication !== undefined) { publicationPending = true; return }
  publication = setTimeout(() => { publication = undefined; if (publicationPending) { publicationPending = false; publish() } }, 50)
  for (const listener of listeners) listener()
}
useVideoEditEffectLibraryStore.subscribe((state, previous) => { if (state.presets !== previous.presets) publish() })
const rest = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/** 同步消费者始终拿到当前帧表；缺帧由窗口标为未就绪，完成窗口的通知按短间隔合并。 */
export function videoEditRenderFingerprints(owner: VideoEditInstance, composition: VideoEditComposition, environment: string,
  webContent: Record<string, string>, declarations?: VideoEditCodeDeclarationReader, environmentCurrent: () => boolean = () => true): VideoEditCodeFingerprints | undefined {
  const picture = videoEditPictureFilter(composition)
  const dependencies = composition.clips.filter(clip => picture.has(clip))
  const included = new Set(dependencies.map(clip => clip.id))
  for (const clip of dependencies) if (clip.follow && !included.has(clip.follow.clipId)) {
    const source = composition.clips.find(value => value.id === clip.follow!.clipId)
    if (source) { included.add(source.id); dependencies.push(source) }
  }
  const clips = dependencies.filter(clip => clip.kind === 'code' && clip.code)
  if (!clips.length) return undefined
  let byEnvironment = snapshots.get(composition)
  if (!byEnvironment) { byEnvironment = new Map(); snapshots.set(composition, byEnvironment) }
  const authorEffects = composition.authorEffects ?? { presets: useVideoEditEffectLibraryStore.getState().presets }
  const effectsEnvironment = composition.codeMaterials?.some(definition => definition.versions.some(version => version.apiVersion >= 7)) ? JSON.stringify([authorEffects.presets, composition.colorLuts]) : ''
  const snapshotEnvironment = JSON.stringify([environment, webContent, effectsEnvironment])
  const existing = byEnvironment.get(snapshotEnvironment)
  for (const key of byEnvironment.keys()) if (key !== snapshotEnvironment) byEnvironment.delete(key)
  let currentEnvironments = environments.get(owner)
  if (!currentEnvironments) { currentEnvironments = new Map(); environments.set(owner, currentEnvironments) }
  currentEnvironments.set(composition.id, snapshotEnvironment)
  let cache = owners.get(owner)
  if (!cache) { cache = new Map(); owners.set(owner, cache) }
  let keys = clipKeys.get(composition)
  if (!keys) { keys = new Map(); clipKeys.set(composition, keys) }
  const windows = videoEditPictureTransitionWindows(composition)
  const entries = clips.map(clip => {
    const handles = windows.filter(window => window.left.id === clip.id || window.right.id === clip.id)
    const from = Math.max(0, Math.min(clip.start, ...handles.map(window => window.start)))
    const until = Math.max(clip.start + clip.duration, ...handles.map(window => window.end))
    const inputs = videoEditCodeInputs(composition, clip.code, declarations)
    let memo = keys.get(clip.id)
    // 合成快照不可变；声明补齐会替换 inputs，其他读取直接复用依赖键，避免反复遍历整份场景。
    if (!memo || memo.environment !== snapshotEnvironment || memo.inputs !== inputs) {
      let version: unknown
      try { version = codeVersionContentKey(codeMaterialVersion(composition, clip.code!)) } catch { version = clip.code }
      const parameters = inputs?.parameters ?? clip.code!.parameters
      const mediaIds = new Set(Object.values(parameters).flatMap(value => isCodeImageReference(value) && (value.kind === 'image' || value.kind === 'video') ? [value.mediaId] : []))
      const scenes = composition.scenes?.filter(scene => Object.values(parameters).some(value => typeof value === 'object' && value !== null && 'sceneId' in value && value.sceneId === scene.id)) ?? []
      for (const id of videoEditSceneRecordMediaIds(composition, scenes.flatMap(scene => scene.records))) mediaIds.add(id)
      const web = Object.values(parameters).flatMap(value => isCodeImageReference(value) && value.kind === 'web' ? [[value.path, webContent[value.path]]] : [])
      const follow = clip.follow && composition.clips.find(value => value.id === clip.follow!.clipId)
      const key = renderFingerprintHash(JSON.stringify([composition.width, composition.height, composition.frameRate, composition.motionBlur,
        composition.foreign, environment, effectsEnvironment, web, composition.media.filter(media => mediaIds.has(media.id)), scenes,
        videoEditRenderPictureClip(clip), version, handles.map(handle => [handle.start, handle.end, handle.transition]), follow && videoEditRenderPictureClip(follow)]))
      memo = { environment: snapshotEnvironment, inputs, key }; keys.set(clip.id, memo)
    }
    const key = memo.key
    let entry = cache!.get(key)
    if (!entry) { entry = { usedAt: performance.now(), signature: '', startFrame: from, endFrame: until, frames: new Map() }; cache!.set(key, entry) }
    entry.usedAt = performance.now()
    return { clip, entry, from, until }
  })
  if (existing?.current() && existing.contentVersion === owner.contentVersion
    && entries.every(({ clip, entry }) => existing.result.get(clip.id) === entry)
    && (existing.running || performance.now() < existing.retryAt)) return existing.result
  const result = new Map(entries.map(({ clip, entry }) => [clip.id, entry]))
  if (entries.every(({ entry, from, until }) => entry.frames.size >= until - from)) {
    byEnvironment.set(snapshotEnvironment, { result, running: false, contentVersion: owner.contentVersion, retryAt: 0, current: environmentCurrent }); return result
  }
  const snapshot: Snapshot = { result, running: true, contentVersion: owner.contentVersion, retryAt: 0, current: environmentCurrent }
  byEnvironment.set(snapshotEnvironment, snapshot)
  const contentVersion = owner.contentVersion
  void (async () => {
    let session: VideoEditRenderSession | undefined
    let activeMs = 0, frames = 0, pausedAt: number | undefined
    const started = performance.now(), ranges = videoEditRenderWindowRanges(composition)
    const completed = new Set<number>(), reported = new Set<string>()
    const alive = (): boolean => listVideoEditInstances().includes(owner) && owner.contentVersion === contentVersion && currentEnvironments.get(composition.id) === snapshotEnvironment && environmentCurrent() && byEnvironment.get(snapshotEnvironment) === snapshot
    const priority = (range: { startFrame: number; endFrame: number }): number => {
      const direction = owner.playbackDirection === -1 ? -1 : 1
      if (owner.frame >= range.startFrame && owner.frame < range.endFrame) return -1
      const ahead = direction === 1 ? range.startFrame >= owner.frame : range.endFrame <= owner.frame
      return Math.min(Math.abs(range.startFrame - owner.frame), Math.abs(range.endFrame - owner.frame)) * 2 + (ahead ? 0 : composition.fps * 10)
    }
    logger.info('开始计算代码帧指纹', { event: 'video_edit.render_cache.start', context: { sequenceId: composition.id, phase: 'fingerprint', clips: entries.length } })
    try {
      while (completed.size < ranges.length) {
        if (!alive()) throw new DOMException('剪辑已关闭或改变', 'AbortError')
        // 拖动暂停本工程；导出与播放使用独立 CPU Worker 小批推进，不销毁已经准备好的模块。
        if (owner.scrubbing) {
          if (pausedAt === undefined) {
            pausedAt = performance.now()
            logger.info('节目操作让出帧指纹计算', { event: 'video_edit.render_cache.preempted', context: { sequenceId: composition.id, phase: 'fingerprint', frames } })
          }
          await rest(20); continue
        }
        if (pausedAt !== undefined) {
          logger.info('节目空闲，继续帧指纹计算', { event: 'video_edit.render_cache.resumed', context: { sequenceId: composition.id, phase: 'fingerprint', frames, pausedMs: performance.now() - pausedAt } })
          pausedAt = undefined
        }
        const range = ranges.map((range, index) => ({ ...range, index })).filter(range => !completed.has(range.index)).sort((a, b) => priority(a) - priority(b))[0]
        let progressed = false
        for (const { clip, entry, from, until } of entries) {
          const end = Math.min(until, range.endFrame)
          let frame = Math.max(from, range.startFrame)
          while (frame < end && entry.frames.has(frame)) frame++
          if (frame >= end) continue
          let missingEnd = frame + 1
          while (missingEnd < end && !entry.frames.has(missingEnd)) missingEnd++
          let yielding = false
          session ??= new VideoEditRenderSession(composition)
          const frameStarted = performance.now()
          const values = await calculationTurn(() => owner.activeSequenceId === composition.id ? 0 : 1, async () => {
            if (!alive()) throw new DOMException('剪辑已关闭或改变', 'AbortError')
            if (owner.scrubbing) return []
            yielding = owner.busy || owner.playing
            return session!.fingerprintCodeFrames(clip.id, frame, owner.busy ? Math.min(frame + 1, missingEnd) : missingEnd, webContent, owner.busy ? 1 : owner.playing ? 2 : 8)
          })
          // 迟到结果不污染跨快照共享的帧表。
          if (!alive()) throw new DOMException('剪辑已关闭或改变', 'AbortError')
          for (const [frame, value] of values) { entry.frames.set(frame, value); frames++ }
          entry.signature = renderFingerprintHash(JSON.stringify([entry.signature, values]))
          const elapsed = performance.now() - frameStarted
          activeMs += elapsed; progressed = true
          // 导出时每批最多一帧并至少让出 50ms；播放时约十分之一墙钟预算，空闲也交回消息循环。
          await rest(owner.busy ? Math.max(50, elapsed * 19) : yielding ? Math.max(16, elapsed * 9) : 0)
          break
        }
        if (progressed) continue
        completed.add(range.index); publish()
        for (const { clip, entry, from, until } of entries) {
          if (reported.has(clip.id) || entry.frames.size < until - from) continue
          reported.add(clip.id)
          const methods = { frameKey: 0, recording: 0, version: 0 }, reasons = new Map<string, number>()
          for (const value of entry.frames.values()) {
            if (value.fallback) { methods.version++; reasons.set(value.fallback, (reasons.get(value.fallback) ?? 0) + 1) }
            else if (value.method === 'frameKey') methods.frameKey++
            else methods.recording++
          }
          logger.info(reasons.size ? '部分代码帧使用版本摘要' : '片段代码帧指纹计算完成', { event: 'video_edit.render_cache.completed', context: { sequenceId: composition.id, clipId: clip.id, phase: 'fingerprint', methods, fallbacks: Object.fromEntries(reasons) } })
        }
      }
      logger.info('代码帧指纹计算完成', { event: 'video_edit.render_cache.completed', context: { sequenceId: composition.id, phase: 'fingerprint', frames, activeMs, elapsedMs: performance.now() - started } })
    } catch (error) {
      // 基础设施失败不写成作者回退；保留成功帧，短暂退避后重试缺帧。
      if (alive()) {
        snapshot.retryAt = performance.now() + 1000
        setTimeout(publish, 1000)
      }
      publish()
      logger.warn('代码帧指纹计算未完成', { event: 'video_edit.render_cache.failed', error, context: { sequenceId: composition.id, phase: 'fingerprint', frames } })
    } finally {
      snapshot.running = false
      trim(cache, new Set(entries.map(({ entry }) => entry)))
      await session?.dispose(true)
    }
  })()
  return result
}
