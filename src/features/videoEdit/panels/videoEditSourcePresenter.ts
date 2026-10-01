import type { VideoEditMedia } from '@/core/videoEdit/document'
import type { VideoEditSourceObservation, VideoEditSourcePresenter } from '../application/videoEditSource'
import { resolveImageDisplayUrl } from '@/services/imageSource'
import { VideoEditSourceFrames } from '../engine/videoEditSourceFrames'
import { createVideoEditAudioMeter, type VideoEditAudioLevel } from '../engine/videoEditAudioMeter'

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

/** Native forward playback and cached reverse frames share one source owner. */
export function createVideoEditSourcePresenter(host: HTMLElement, resolveMedia: (itemId: string) => VideoEditMedia,
  observe: (itemId: string, observation: VideoEditSourceObservation) => void, observeLevel?: (levels: VideoEditAudioLevel[]) => void): { present: VideoEditSourcePresenter; release: () => Promise<void>; dispose: () => Promise<void> } {
  let element: HTMLVideoElement | HTMLAudioElement | HTMLImageElement | undefined
  let currentItem = ''
  let currentPath = ''
  let currentRevision: string | undefined
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
  const stopReverse = (): void => { clearTimeout(reverseTimer); reverseTimer = undefined; reversePlaying = false; reverse?.abort(new Error('反向源播放已停止。')); reverse = undefined; frames?.invalidate() }
  const releaseFrames = (): void => {
    const previous = frames; frames = undefined; frameCanvas?.remove(); frameCanvas = undefined
    if (element instanceof HTMLVideoElement) element.className = 'h-full w-full object-contain'
    if (previous) sourceFramesReleased = Promise.allSettled([sourceFramesReleased, previous.dispose()]).then(() => undefined)
  }
  const release = (): void => {
    stopReverse()
    releaseFrames()
    generation++
    const media = element
    clearInterval(meterTimer); meterTimer = undefined; audioSource?.disconnect(); audioSource = undefined; meter?.dispose(); meter = undefined
    if (audio) { const retired = audio; audio = undefined; sourceFramesReleased = Promise.allSettled([sourceFramesReleased, retired.close()]).then(() => undefined) }
    observeLevel?.([])
    element = undefined; currentItem = ''; currentPath = ''; currentRevision = undefined; presentedTimeUs = 0; nativePresentedTimeUs = undefined; nativePresentedSeconds = undefined
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
          const queryTimeUs = byTimestamp ? Math.max(0, presentedTimeUs - 1) : Math.round((next + .5) / fps * 1e6)
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
      const media = resolveMedia(request.itemId)
      currentFps = media.frameRate ? media.frameRate.numerator / media.frameRate.denominator : 30
      constantFrameRate = media.frameRateMode === 'sampled-constant'
      if (currentItem !== request.itemId || currentPath !== media.path || currentRevision !== media.sourceRevision || !element) {
        release(); currentItem = request.itemId; currentPath = media.path; currentRevision = media.sourceRevision
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
          element.src = resolveImageDisplayUrl(media.path); host.replaceChildren(element)
          await loaded
        } else {
          const loaded = waitEvent(element, 'load', operation.signal)
          element.src = resolveImageDisplayUrl(media.path); element.alt = media.name; host.replaceChildren(element)
          await loaded
        }
      }
      operation.signal.throwIfAborted()
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
        const owner = new VideoEditSourceFrames(media, canvas); frames = owner; frameCanvas = canvas
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
