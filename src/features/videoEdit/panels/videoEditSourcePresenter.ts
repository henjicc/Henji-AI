import { getVideoEditProxySources } from '../application/videoEditProxy'
import type { VideoEditMedia } from '@/core/videoEdit/document'
import type { VideoEditAudioMapping } from '@/core/videoEdit/audioChannels'
import type { VideoEditSourceObservation, VideoEditSourcePresenter } from '../application/videoEditSource'
import { resolveImageDisplayUrl } from '@/services/imageSource'
import { VideoEditSourceFrames, videoEditSourceBackend } from '../engine/videoEditSourceFrames'
import { createVideoEditAudioMeter, type VideoEditAudioLevel } from '../engine/videoEditAudioMeter'
import { VideoEditSourceSoundPlayer } from '../engine/videoEditSourceSound'
import { VIDEO_EDIT_CONTAINER_TIMESTAMP_TOLERANCE_SECONDS } from '@/core/videoEdit/time'

/** Reverse steps aim below the shown picture by more than the tolerance the renderer adds to every picture lookup. */
const TIMESTAMP_TOLERANCE_US = Math.ceil(VIDEO_EDIT_CONTAINER_TIMESTAMP_TOLERANCE_SECONDS * 1e6)

// A Dock hide/show may create a different presenter/host before the old worker
// has closed. New reverse owners wait for every retiring source worker.
let sourceFramesReleased: Promise<void> = Promise.resolve()

function cancelled(signal: AbortSignal): unknown { return signal.reason ?? new DOMException('源预览已取消。', 'AbortError') }
function waitEvent(element: HTMLElement, event: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const clear = (): void => { element.removeEventListener(event, done); element.removeEventListener('error', failed); signal.removeEventListener('abort', aborted) }
    const done = (): void => { clear(); resolve() }
    const failed = (): void => { clear(); reject(new Error('源文件无法播放，请重新定位或选择设备支持的文件。')) }
    const aborted = (): void => { clear(); reject(cancelled(signal)) }
    element.addEventListener(event, done, { once: true }); element.addEventListener('error', failed, { once: true })
    signal.addEventListener('abort', aborted, { once: true })
    if (signal.aborted) aborted()
  })
}
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = (): void => reject(cancelled(signal))
    signal.addEventListener('abort', abort, { once: true })
    promise.then(value => { signal.removeEventListener('abort', abort); if (signal.aborted) reject(cancelled(signal)); else resolve(value) }, error => { signal.removeEventListener('abort', abort); reject(error) })
    if (signal.aborted) abort()
  })
}

/**
 * An item only the native decoder plays (tasks 2.2, 2.3): no media element. A video item shows every picture through
 * the original-source render session (`owner`); forward playback runs through its scheduled path and reverse
 * playback steps by real timestamps. Its sound (and the sound of an audio item, which has no `owner`) plays forward
 * through a dedicated sound session on an audio clock aligned with the picture clock; reverse playback is silent.
 */
interface NativeSourceView { owner?: VideoEditSourceFrames; node: HTMLElement; canvas?: HTMLCanvasElement; sound?: VideoEditSourceSoundPlayer; media: VideoEditMedia; clockUs: number; presentedTimeUs: number; playing: boolean; direction: 1 | -1; run?: AbortController; confirmed?: boolean }
/** A sound-only native item publishes its clock this often while playing. */
const NATIVE_SOUND_CLOCK_MS = 50

/** Native forward playback and cached reverse frames share one source owner. */
export function createVideoEditSourcePresenter(host: HTMLElement, resolveMedia: (itemId: string) => VideoEditMedia,
  observe: (itemId: string, observation: VideoEditSourceObservation) => void, observeLevel?: (levels: VideoEditAudioLevel[]) => void,
  resolveAudioLayout?: (itemId: string) => VideoEditAudioMapping[] | undefined, proxyProjectId?: string): { present: VideoEditSourcePresenter; release: () => Promise<void>; dispose: () => Promise<void> } {
  let element: HTMLVideoElement | HTMLAudioElement | HTMLImageElement | undefined
  let currentItem = ''
  let currentPath = ''
  let currentRevision: string | undefined
  let currentLayout = 'null'
  let presentedTimeUs = 0
  let nativePresentedTimeUs: number | undefined
  let nativePresentedSeconds: number | undefined
  let currentFps = 30
  let constantFrameRate = false
  let videoFrame: number | undefined
  let generation = 0
  let pending: AbortController | undefined
  let reverse: AbortController | undefined
  let reverseTimer: ReturnType<typeof setTimeout> | undefined
  let reversePlaying = false
  let disposed = false
  let frames: VideoEditSourceFrames | undefined
  let frameCanvas: HTMLCanvasElement | undefined
  let frameClockUs = 0
  let audio: AudioContext | undefined
  let audioSource: MediaElementAudioSourceNode | undefined
  let meter: ReturnType<typeof createVideoEditAudioMeter> | undefined
  let meterTimer: ReturnType<typeof setInterval> | undefined
  let nativeView: NativeSourceView | undefined
  let backendChoice: Promise<Awaited<ReturnType<typeof videoEditSourceBackend>> | undefined> | undefined
  const stopNative = (view: NativeSourceView | undefined): void => { if (!view) return; view.run?.abort(new Error('源播放已停止。')); view.run = undefined; view.playing = false; view.sound?.stop() }
  const releaseNative = (): void => {
    const view = nativeView; nativeView = undefined
    if (!view) return
    stopNative(view); view.node.remove()
    sourceFramesReleased = Promise.allSettled([sourceFramesReleased, view.owner?.dispose(), view.sound?.dispose()]).then(() => undefined)
  }
  const recordNative = (view: NativeSourceView, result: { presentedTimeUs: number; decodeMs: number; gpuMs: number; cacheHits: number; cacheBytes: number }): void => {
    view.presentedTimeUs = result.presentedTimeUs
    if (view.canvas) Object.assign(view.canvas.dataset, { presentedTimeUs: String(result.presentedTimeUs), decodeMs: String(result.decodeMs), gpuMs: String(result.gpuMs), cacheHits: String(result.cacheHits), cacheBytes: String(result.cacheBytes) })
    else view.node.dataset.presentedTimeUs = String(result.presentedTimeUs)
  }
  const nativeObservation = (view: NativeSourceView, volume: number, error?: string): VideoEditSourceObservation => ({ timeUs: view.clockUs, presentedTimeUs: view.presentedTimeUs, playing: view.playing, volume, ...(view.playing && view.direction === -1 ? { playbackDirection: -1 as const } : {}), ...(error ? { error } : {}) })
  /**
   * Paced playback in either direction; publishes every confirmed picture (or, for a sound-only item, its clock) and
   * stops at either end. Forward playback first starts the audio clock (items with sound) and presents frame
   * `startFrame + 1` unpaced (switching to the scheduled path opens a decoder: a paced first frame would start late and
   * the picture would lag the sound until it caught up), then anchors the picture schedule and the sound at that moment,
   * like the program monitor starts its clock after its first picture.
   */
  const runNative = (view: NativeSourceView, direction: 1 | -1, volume: number): void => {
    const run = new AbortController(); view.run = run; view.playing = true; view.direction = direction
    const { owner, media, sound } = view
    const fps = media.frameRate ? media.frameRate.numerator / media.frameRate.denominator : 30
    const durationUs = Math.round(media.durationSeconds * 1e6)
    const startClockUs = view.clockUs
    const current = (): boolean => !run.signal.aborted && nativeView === view
    const finish = (): void => { view.playing = false; view.run = undefined; view.sound?.stop(); observeLevel?.([]); observe(currentItem, nativeObservation(view, volume)) }
    const fail = (error: unknown): void => {
      if (!current()) return
      run.abort(error); view.playing = false; view.run = undefined; view.sound?.stop(); observeLevel?.([])
      observe(currentItem, nativeObservation(view, volume, error instanceof Error ? error.message : String(error)))
    }
    void (async () => {
      let levelTimer: ReturnType<typeof setInterval> | undefined
      try {
        const audible = direction === 1 && sound ? sound : undefined
        if (audible) { await audible.prepare(volume); if (!current()) return }
        const startFrame = owner ? Math.min(owner.frameCount - 1, Math.floor(startClockUs * fps / 1e6 + 1e-6)) : 0
        let firstFrame = startFrame + 1
        if (owner && direction === 1 && firstFrame < owner.frameCount) {
          const result = await owner.playFrame(firstFrame)
          if (!current()) return
          view.clockUs = result.timeUs; recordNative(view, result); observe(currentItem, nativeObservation(view, volume))
          firstFrame++
        }
        // Frame `startFrame + 1` shows at `started` (already shown when warmed up above).
        const started = owner && direction === 1 && firstFrame > startFrame + 1 ? performance.now() : performance.now() + 1000 / fps
        // The source second due at `started`: the next picture of a video item, the clock of a sound-only item.
        const startSeconds = owner ? (startFrame + 1) / fps : startClockUs / 1e6
        const elapsedSeconds = (): number => (performance.now() - started) / 1000
        if (audible) {
          audible.start(startSeconds, started)
          if (observeLevel) levelTimer = setInterval(() => { if (current()) observeLevel(audible.levels()) }, 50)
        }
        const pump = (): void => audible?.pump(startSeconds + elapsedSeconds(), current, fail)
        if (!owner) {
          for (;;) {
            pump()
            await new Promise(resolve => setTimeout(resolve, NATIVE_SOUND_CLOCK_MS))
            if (!current()) return
            const clockUs = Math.round(startClockUs + direction * Math.max(0, elapsedSeconds()) * 1e6)
            view.clockUs = view.presentedTimeUs = Math.min(durationUs, Math.max(0, clockUs)); view.node.dataset.presentedTimeUs = String(view.presentedTimeUs)
            if (direction === 1 ? clockUs >= durationUs : clockUs <= 0) { finish(); return }
            observe(currentItem, nativeObservation(view, volume))
          }
        }
        for (let frame = owner && direction === 1 ? firstFrame : startFrame + 1; ; frame++) {
          if (!current()) return
          pump()
          if (direction === 1) {
            if (frame >= owner.frameCount) { view.clockUs = durationUs; finish(); return }
            const result = await owner.playFrame(frame, performance.timeOrigin + started + (frame - startFrame - 1) * 1000 / fps)
            if (!current()) return
            view.clockUs = result.timeUs; recordNative(view, result)
          } else {
            // Step back by real timestamps (variable frame rate included), aiming just before the shown picture.
            if (view.presentedTimeUs <= 0) { view.clockUs = 0; finish(); return }
            // Just before the shown picture, minus the container timestamp tolerance the renderer adds to every lookup.
            const result = await owner.present(Math.max(0, view.presentedTimeUs - 1 - TIMESTAMP_TOLERANCE_US), performance.timeOrigin + started + (startClockUs - view.presentedTimeUs) / 1000)
            if (!current()) return
            recordNative(view, result); view.clockUs = Math.min(durationUs - 1, result.presentedTimeUs + 1)
          }
          observe(currentItem, nativeObservation(view, volume))
        }
      } catch (error) {
        fail(error)
      } finally { clearInterval(levelTimer) }
    })()
  }
  const stopReverse = (): void => { clearTimeout(reverseTimer); reverseTimer = undefined; reversePlaying = false; reverse?.abort(new Error('反向源播放已停止。')); reverse = undefined; frames?.invalidate() }
  const releaseFrames = (): void => {
    const previous = frames; frames = undefined; frameCanvas?.remove(); frameCanvas = undefined
    if (element instanceof HTMLVideoElement) element.className = 'h-full w-full object-contain'
    if (previous) sourceFramesReleased = Promise.allSettled([sourceFramesReleased, previous.dispose()]).then(() => undefined)
  }
  const release = (): void => {
    stopReverse()
    releaseFrames()
    releaseNative(); backendChoice = undefined
    generation++
    const media = element
    clearInterval(meterTimer); meterTimer = undefined; audioSource?.disconnect(); audioSource = undefined; meter?.dispose(); meter = undefined
    if (audio) { const retired = audio; audio = undefined; sourceFramesReleased = Promise.allSettled([sourceFramesReleased, retired.close()]).then(() => undefined) }
    observeLevel?.([])
    element = undefined; currentItem = ''; currentPath = ''; currentRevision = undefined; currentLayout = 'null'; presentedTimeUs = 0; nativePresentedTimeUs = undefined; nativePresentedSeconds = undefined
    if (media instanceof HTMLMediaElement) {
      media.pause()
      if (media instanceof HTMLVideoElement && videoFrame !== undefined) media.cancelVideoFrameCallback(videoFrame)
      media.removeAttribute('src'); media.load()
    } else media?.removeAttribute('src')
    videoFrame = undefined; media?.remove()
  }
  const publish = (): void => {
    if (!(element instanceof HTMLMediaElement)) return
    // Native time/volume events cannot replace a GPU-confirmed reverse frame.
    if (frames) return
    observe(currentItem, { timeUs: Math.round(element.currentTime * 1e6), presentedTimeUs, playing: reversePlaying || !element.paused && !element.ended, volume: element.volume, ...(reversePlaying ? { playbackDirection: -1 as const } : {}) })
  }
  const watchVideo = (video: HTMLVideoElement, expected: number): void => {
    if (disposed || element !== video || generation !== expected || video.paused) return
    const callbackId = video.requestVideoFrameCallback((_now, metadata) => {
      if (element !== video || generation !== expected || videoFrame !== callbackId || frames) return
      videoFrame = undefined
      nativePresentedSeconds = metadata.mediaTime; nativePresentedTimeUs = Math.round(metadata.mediaTime * 1e6); presentedTimeUs = nativePresentedTimeUs; publish(); watchVideo(video, expected)
    })
    videoFrame = callbackId
  }
  const seek = async (target: HTMLMediaElement, seconds: number, incoming: AbortSignal): Promise<void> => {
    const guard = new AbortController(); const signal = guard.signal
    const abort = (): void => guard.abort(cancelled(incoming))
    incoming.addEventListener('abort', abort, { once: true }); if (incoming.aborted) abort()
    const timeout = setTimeout(() => guard.abort(new Error('源素材定位未能及时返回画面，请重新定位。')), 10000)
    try {
    signal.throwIfAborted()
    const needsSeek = Math.abs(target.currentTime - seconds) > 1e-6
    const samePicture = target instanceof HTMLVideoElement && constantFrameRate && nativePresentedSeconds !== undefined && seconds >= nativePresentedSeconds && seconds < nativePresentedSeconds + 1 / currentFps
    if (target instanceof HTMLVideoElement && (needsSeek || nativePresentedTimeUs === undefined) && !samePicture) {
      if (!target.requestVideoFrameCallback) throw new Error('当前设备未提供源视频画面确认，请更新桌面运行环境。')
      const expected = generation
      const frame = new Promise<void>((resolve, reject) => {
        const aborted = (): void => { target.cancelVideoFrameCallback(callbackId); if (videoFrame === callbackId) videoFrame = undefined; reject(cancelled(signal)) }
        const callbackId = target.requestVideoFrameCallback((_now, metadata) => {
          signal.removeEventListener('abort', aborted)
          if (element !== target || generation !== expected || signal.aborted) { reject(cancelled(signal)); return }
          if (videoFrame === callbackId) videoFrame = undefined
          nativePresentedSeconds = metadata.mediaTime; nativePresentedTimeUs = Math.round(metadata.mediaTime * 1e6); presentedTimeUs = nativePresentedTimeUs; resolve()
        })
        videoFrame = callbackId; signal.addEventListener('abort', aborted, { once: true })
      })
      target.currentTime = seconds; await frame
    } else if (needsSeek) {
      const seeked = waitEvent(target, 'seeked', signal); target.currentTime = seconds; await seeked
      if (!(target instanceof HTMLVideoElement)) presentedTimeUs = Math.round(target.currentTime * 1e6)
    }
    if (target instanceof HTMLVideoElement && nativePresentedTimeUs !== undefined) presentedTimeUs = nativePresentedTimeUs
    signal.throwIfAborted()
    } finally { clearTimeout(timeout); incoming.removeEventListener('abort', abort) }
  }
  const startReverse = (target: HTMLMediaElement, media: VideoEditMedia): void => {
    const controller = new AbortController(); reverse = controller; reversePlaying = true
    const fps = media.frameRate ? media.frameRate.numerator / media.frameRate.denominator : 30
    const start = Math.round((target instanceof HTMLVideoElement ? presentedTimeUs / 1e6 : target.currentTime) * fps); const started = performance.now()
    const byTimestamp = target instanceof HTMLVideoElement && media.frameRateMode !== 'sampled-constant'
    const startTimeUs = presentedTimeUs
    let next = start - 1
    const tick = async (): Promise<void> => {
      if (controller.signal.aborted || reverse !== controller || element !== target) return
      try {
        if (byTimestamp ? presentedTimeUs <= 0 : next < 0) {
          stopReverse()
          if (frames) observe(currentItem, { timeUs: frameClockUs, presentedTimeUs, playing: false, volume: target.volume, playbackDirection: -1 })
          else publish()
          return
        }
        // Native paused-video seeks at a rounded frame boundary can select the
        // preceding picture. Aim inside the frame and keep its actual RVFC time.
        if (target instanceof HTMLVideoElement && frames) {
          const owner = frames; const canvas = frameCanvas
          const queryTimeUs = byTimestamp ? Math.max(0, presentedTimeUs - 1 - TIMESTAMP_TOLERANCE_US) : Math.round((next + .5) / fps * 1e6)
          const frameDelayMs = byTimestamp ? (startTimeUs - presentedTimeUs) / 1000 : (start - next) / fps * 1000
          const result = await owner.present(queryTimeUs, performance.timeOrigin + started + frameDelayMs)
          if (controller.signal.aborted || reverse !== controller || frames !== owner || frameCanvas !== canvas) return
          presentedTimeUs = result.presentedTimeUs; frameClockUs = byTimestamp ? Math.min(Math.round(media.durationSeconds * 1e6) - 1, presentedTimeUs + 1) : result.timeUs
          if (canvas) {
            canvas.dataset.decodeMs = String(result.decodeMs); canvas.dataset.gpuMs = String(result.gpuMs); canvas.dataset.cacheHits = String(result.cacheHits); canvas.dataset.cacheBytes = String(result.cacheBytes)
            canvas.dataset.presentedTimeUs = String(result.presentedTimeUs)
          }
          observe(currentItem, { timeUs: frameClockUs, presentedTimeUs, playing: true, volume: target.volume, playbackDirection: -1 })
        } else await seek(target, (next + .5) / fps, controller.signal)
        if (reverse !== controller) return
        publish(); next--
        const delayMs = byTimestamp ? (startTimeUs - presentedTimeUs) / 1000 : (start - next) / fps * 1000
        reverseTimer = setTimeout(() => { void tick() }, Math.max(0, started + delayMs - performance.now()))
      } catch (error) {
        if (!controller.signal.aborted && reverse === controller) {
          stopReverse()
          observe(currentItem, { timeUs: frames ? frameClockUs : Math.round(target.currentTime * 1e6), presentedTimeUs, playing: false, volume: target.volume, error: error instanceof Error ? error.message : String(error) })
        }
      }
    }
    reverseTimer = setTimeout(() => { void tick() }, 1000 / fps)
  }
  const present: VideoEditSourcePresenter = async (request, signal) => {
    signal.throwIfAborted()
    if (disposed) throw new Error('源预览面板已关闭。')
    stopReverse()
    pending?.abort(new Error('源预览请求已被更新。'))
    const operation = new AbortController(); pending = operation
    const abort = (): void => { operation.abort(cancelled(signal)); if (pending === operation) release() }
    signal.addEventListener('abort', abort, { once: true })
    try {
      if (!request.itemId) { release(); return { timeUs: 0, presentedTimeUs: 0, playing: false, volume: request.volume } }
      const originalMedia = resolveMedia(request.itemId)
      const proxy = proxyProjectId ? getVideoEditProxySources(proxyProjectId)[originalMedia.id] : undefined
      const media = proxy ? { ...originalMedia, sourceRevision: `${originalMedia.sourceRevision ?? ''}:proxy:${proxy.key}` } : originalMedia
      currentFps = media.frameRate ? media.frameRate.numerator / media.frameRate.denominator : 30
      constantFrameRate = media.frameRateMode === 'sampled-constant'
      // The item's audio layout (task 2.6) decides which sound streams the source monitor plays.
      const layout = resolveAudioLayout?.(request.itemId); const layoutKey = JSON.stringify(layout ?? null)
      if (currentItem !== request.itemId || currentPath !== media.path || currentRevision !== media.sourceRevision || currentLayout !== layoutKey || !(element || nativeView)) {
        release(); currentItem = request.itemId; currentPath = media.path; currentRevision = media.sourceRevision; currentLayout = layoutKey
        // Decided while the media element loads (cached per file), so browser-decoded items open as fast as before.
        backendChoice = media.kind !== 'image' ? (proxy ? Promise.resolve('native' as const) : videoEditSourceBackend(media)).catch(() => undefined) : undefined
      }
      if (!element && !nativeView) {
        element = document.createElement(media.kind === 'image' ? 'img' : media.kind === 'audio' ? 'audio' : 'video')
        element.setAttribute('aria-label', '源素材画面'); element.setAttribute('data-video-edit-source-media', media.kind)
        element.className = media.kind === 'audio' ? 'hidden' : 'h-full w-full object-contain'
        if (element instanceof HTMLMediaElement) {
          element.preload = 'metadata'
          if (observeLevel) element.crossOrigin = 'anonymous'
          if (element instanceof HTMLVideoElement) element.playsInline = true
          const expected = generation
          element.addEventListener('timeupdate', () => { if (generation === expected) { if (element instanceof HTMLAudioElement) presentedTimeUs = Math.round(element.currentTime * 1e6); publish() } })
          element.addEventListener('ended', () => { if (generation === expected) publish() })
          element.addEventListener('volumechange', () => { if (generation === expected) publish() })
          const loaded = waitEvent(element, 'loadedmetadata', operation.signal)
          element.src = resolveImageDisplayUrl(proxy?.path ?? media.path); host.replaceChildren(element)
          const deciding = backendChoice; backendChoice = undefined
          const [choice, failure] = deciding ? await Promise.all([abortable(deciding, operation.signal), loaded.then(() => undefined, (error: unknown) => error)]) : [undefined, await loaded]
          if (choice === 'native') {
            // A media element cannot play this file: drop it and play the source through render sessions.
            const unused = element; element = undefined; unused.removeAttribute('src'); unused.load(); unused.remove()
            await abortable(sourceFramesReleased, operation.signal)
            const sound = media.kind === 'audio' || media.hasAudio !== false ? new VideoEditSourceSoundPlayer(media, undefined, layout) : undefined
            if (media.kind === 'video') {
              const canvas = document.createElement('canvas'); canvas.className = 'h-full w-full object-contain'
              canvas.setAttribute('aria-label', '源素材画面'); canvas.setAttribute('data-video-edit-source-media', 'video'); canvas.setAttribute('data-video-edit-source-canvas', '')
              nativeView = { owner: new VideoEditSourceFrames(originalMedia, canvas, proxyProjectId), node: canvas, canvas, ...(sound ? { sound } : {}), media, clockUs: 0, presentedTimeUs: 0, playing: false, direction: 1 }
              host.replaceChildren(canvas)
            } else {
              // Sound only: like the hidden audio element, nothing visible; the node carries the confirmed clock.
              const node = document.createElement('span'); node.className = 'hidden'
              node.setAttribute('aria-label', '源素材声音'); node.setAttribute('data-video-edit-source-media', 'audio'); node.setAttribute('data-video-edit-source-sound', '')
              nativeView = { node, ...(sound ? { sound } : {}), media, clockUs: 0, presentedTimeUs: 0, playing: false, direction: 1 }
              host.replaceChildren(node)
            }
          } else if (failure !== undefined) throw failure
        } else {
          const loaded = waitEvent(element, 'load', operation.signal)
          element.src = resolveImageDisplayUrl(media.path); element.alt = media.name; host.replaceChildren(element)
          await loaded
        }
      }
      operation.signal.throwIfAborted()
      if (nativeView) {
        const view = nativeView
        const wasPlaying = view.playing
        stopNative(view); observeLevel?.([])
        if (view.owner) {
          // A paused view already showing this clock (in/out, volume changes) keeps its confirmed picture, like a media
          // element that needs no seek; re-presenting would widen the window in which a later request supersedes this one.
          if (!(view.confirmed && !wasPlaying && view.clockUs === request.timeUs)) {
            view.confirmed = false
            const result = await abortable(view.owner.present(request.timeUs), operation.signal)
            if (nativeView !== view) throw new Error('源预览请求已被更新。')
            view.clockUs = request.timeUs; recordNative(view, result); view.confirmed = true
          }
        } else {
          const timeUs = Math.min(Math.round(view.media.durationSeconds * 1e6), Math.max(0, request.timeUs))
          view.clockUs = timeUs; recordNative(view, { presentedTimeUs: timeUs, decodeMs: 0, gpuMs: 0, cacheHits: 0, cacheBytes: 0 })
        }
        if (request.playing) runNative(view, request.playbackDirection === -1 ? -1 : 1, request.volume)
        return nativeObservation(view, request.volume)
      }
      const target = element!
      if (target instanceof HTMLImageElement) return { timeUs: 0, presentedTimeUs: 0, playing: false, volume: request.volume }
      target.volume = request.volume
      target.muted = request.playbackDirection === -1
      target.pause()
      if (!request.playing || request.playbackDirection === -1) { clearInterval(meterTimer); meterTimer = undefined; observeLevel?.([]) }
      if (target instanceof HTMLVideoElement && videoFrame !== undefined) target.cancelVideoFrameCallback(videoFrame)
      videoFrame = undefined
      const previousGpuFrame = frames ? presentedTimeUs : undefined
      const sameGpuClock = frames && Math.abs(request.timeUs - frameClockUs) <= 1
      await seek(target, request.timeUs / 1e6, operation.signal)
      if (sameGpuClock && previousGpuFrame !== undefined && Math.abs(presentedTimeUs - previousGpuFrame) > 1) throw new Error('源画面交接未能确认同一帧，请重新定位。')
      releaseFrames()
      await abortable(sourceFramesReleased, operation.signal)
      if (request.playing && request.playbackDirection === -1 && target instanceof HTMLVideoElement) {
        const expected = generation; const anchorTimeUs = presentedTimeUs
        const started = performance.now()
        await abortable(sourceFramesReleased, operation.signal)
        operation.signal.throwIfAborted()
        if (element !== target || generation !== expected) throw new Error('源预览请求已被更新。')
        const canvas = document.createElement('canvas'); canvas.width = media.width; canvas.height = media.height; canvas.className = 'h-full w-full object-contain'
        canvas.setAttribute('aria-label', '源素材反向画面'); canvas.setAttribute('data-video-edit-source-canvas', '')
        const owner = new VideoEditSourceFrames(originalMedia, canvas, proxyProjectId); frames = owner; frameCanvas = canvas
        const inside = (timeUs: number): number => Math.min(Math.max(0, Math.round(media.durationSeconds * 1e6) - 1), Math.max(0, timeUs))
        if (anchorTimeUs > 0) await abortable(owner.present(inside(Math.round(anchorTimeUs - 500_000 / currentFps))), operation.signal)
        // Preserve the exact confirmed PTS, including VFR frames. A nominal
        // frame centre could select a later real picture with the same index.
        const result = await abortable(owner.present(inside(anchorTimeUs + 1)), operation.signal)
        operation.signal.throwIfAborted()
        if (frames !== owner || element !== target || generation !== expected) throw new Error('源预览请求已被更新。')
        if (Math.abs(result.presentedTimeUs - anchorTimeUs) > 1) throw new Error('反向源画面未能确认原帧，请重新定位。')
        frameClockUs = request.timeUs; presentedTimeUs = result.presentedTimeUs
        canvas.dataset.preparationMs = String(performance.now() - started); canvas.dataset.cacheBytes = String(result.cacheBytes); canvas.dataset.presentedTimeUs = String(result.presentedTimeUs)
        target.className = 'hidden'; host.append(canvas)
      }
      if (request.playing && request.playbackDirection !== -1) {
        if (observeLevel && (media.kind === 'audio' || media.hasAudio === true)) {
          audio ??= new AudioContext()
          if (!meter) { meter = createVideoEditAudioMeter(audio, 2); audioSource = audio.createMediaElementSource(target); audioSource.connect(meter.input) }
          await abortable(audio.resume(), operation.signal)
          meterTimer ??= setInterval(() => observeLevel(!target.paused && !target.muted && !target.ended ? meter!.read() : [{ peak: 0, rms: 0 }, { peak: 0, rms: 0 }]), 50)
        }
        await abortable(target.play(), operation.signal)
      }
      operation.signal.throwIfAborted()
      if (request.playing && request.playbackDirection === -1) startReverse(target, media)
      else if (target instanceof HTMLVideoElement && request.playing) watchVideo(target, generation)
      return { timeUs: frames ? frameClockUs : Math.round(target.currentTime * 1e6), presentedTimeUs, playing: reversePlaying || !target.paused && !target.ended, volume: target.volume, ...(reversePlaying ? { playbackDirection: -1 as const } : {}) }
    } catch (error) { if (pending === operation) release(); throw error }
    finally { signal.removeEventListener('abort', abort); if (pending === operation) pending = undefined }
  }
  return { present, release: () => { pending?.abort(new Error('源预览已关闭。')); release(); return sourceFramesReleased }, dispose: () => { disposed = true; pending?.abort(new Error('源预览面板已关闭。')); pending = undefined; release(); return sourceFramesReleased } }
}
