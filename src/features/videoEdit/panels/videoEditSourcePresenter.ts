import type { VideoEditMedia } from '@/core/videoEdit/document'
import type { VideoEditSourceObservation, VideoEditSourcePresenter } from '../application/videoEditSource'
import { resolveImageDisplayUrl } from '@/services/imageSource'

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

/** A source view binds the existing native media decoder; it never creates an edit composition. */
export function createVideoEditSourcePresenter(host: HTMLElement, resolveMedia: (itemId: string) => VideoEditMedia,
  observe: (itemId: string, observation: VideoEditSourceObservation) => void): { present: VideoEditSourcePresenter; release: () => void; dispose: () => void } {
  let element: HTMLVideoElement | HTMLAudioElement | HTMLImageElement | undefined
  let currentItem = ''
  let currentPath = ''
  let presentedTimeUs = 0
  let hasPresented = false
  let videoFrame: number | undefined
  let generation = 0
  let pending: AbortController | undefined
  let disposed = false
  const release = (): void => {
    generation++
    const media = element
    element = undefined; currentItem = ''; currentPath = ''; hasPresented = false; presentedTimeUs = 0
    if (media instanceof HTMLMediaElement) {
      media.pause()
      if (media instanceof HTMLVideoElement && videoFrame !== undefined) media.cancelVideoFrameCallback(videoFrame)
      media.removeAttribute('src'); media.load()
    } else media?.removeAttribute('src')
    videoFrame = undefined; media?.remove()
  }
  const publish = (): void => {
    if (!(element instanceof HTMLMediaElement)) return
    observe(currentItem, { timeUs: Math.round(element.currentTime * 1e6), presentedTimeUs, playing: !element.paused && !element.ended, volume: element.volume })
  }
  const watchVideo = (video: HTMLVideoElement, expected: number): void => {
    if (disposed || element !== video || generation !== expected || video.paused) return
    videoFrame = video.requestVideoFrameCallback((_now, metadata) => {
      if (element !== video || generation !== expected) return
      videoFrame = undefined
      presentedTimeUs = Math.round(metadata.mediaTime * 1e6); hasPresented = true; publish(); watchVideo(video, expected)
    })
  }
  const present: VideoEditSourcePresenter = async (request, signal) => {
    signal.throwIfAborted()
    if (disposed) throw new Error('源预览面板已关闭。')
    pending?.abort(new Error('源预览请求已被更新。'))
    const operation = new AbortController(); pending = operation
    const abort = (): void => { operation.abort(cancelled(signal)); if (pending === operation) release() }
    signal.addEventListener('abort', abort, { once: true })
    try {
      if (!request.itemId) { release(); return { timeUs: 0, presentedTimeUs: 0, playing: false, volume: request.volume } }
      const media = resolveMedia(request.itemId)
      if (currentItem !== request.itemId || currentPath !== media.path || !element) {
        release(); currentItem = request.itemId; currentPath = media.path
        element = document.createElement(media.kind === 'image' ? 'img' : media.kind === 'audio' ? 'audio' : 'video')
        element.setAttribute('aria-label', '源素材画面'); element.setAttribute('data-video-edit-source-media', media.kind)
        element.className = media.kind === 'audio' ? 'hidden' : 'h-full w-full object-contain'
        if (element instanceof HTMLMediaElement) {
          element.preload = 'metadata'
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
      target.pause()
      if (target instanceof HTMLVideoElement && videoFrame !== undefined) target.cancelVideoFrameCallback(videoFrame)
      videoFrame = undefined
      const seconds = request.timeUs / 1e6
      const needsSeek = Math.abs(target.currentTime - seconds) > 1e-6
      if (target instanceof HTMLVideoElement && (needsSeek || !hasPresented)) {
        if (!target.requestVideoFrameCallback) throw new Error('当前设备未提供源视频画面确认，请更新桌面运行环境。')
        const expected = generation
        const frame = new Promise<void>((resolve, reject) => {
          const aborted = (): void => { if (videoFrame !== undefined) target.cancelVideoFrameCallback(videoFrame); videoFrame = undefined; reject(cancelled(operation.signal)) }
          operation.signal.addEventListener('abort', aborted, { once: true })
          videoFrame = target.requestVideoFrameCallback((_now, metadata) => {
            operation.signal.removeEventListener('abort', aborted)
            if (element !== target || generation !== expected || operation.signal.aborted) { reject(cancelled(operation.signal)); return }
            videoFrame = undefined
            presentedTimeUs = Math.round(metadata.mediaTime * 1e6); hasPresented = true; resolve()
          })
        })
        // Installing the callback before the seek observes the actual newly presented source frame.
        target.currentTime = seconds
        await frame
      } else if (needsSeek) {
        const seeked = waitEvent(target, 'seeked', operation.signal); target.currentTime = seconds; await seeked
        presentedTimeUs = Math.round(target.currentTime * 1e6)
      }
      if (request.playing) await abortable(target.play(), operation.signal)
      operation.signal.throwIfAborted()
      if (target instanceof HTMLVideoElement && request.playing) watchVideo(target, generation)
      return { timeUs: Math.round(target.currentTime * 1e6), presentedTimeUs, playing: !target.paused && !target.ended, volume: target.volume }
    } catch (error) { if (pending === operation) release(); throw error }
    finally { signal.removeEventListener('abort', abort); if (pending === operation) pending = undefined }
  }
  return { present, release: () => { pending?.abort(new Error('源预览已关闭。')); release() }, dispose: () => { disposed = true; pending?.abort(new Error('源预览面板已关闭。')); pending = undefined; release() } }
}
