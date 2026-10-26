import { createLogger } from '@/core/logging'
import { renderPresetPreviewFrame } from '../application/videoEditPresetPreview'
import type { VideoEditSourceObservation, VideoEditSourcePresenter } from '../application/videoEditSource'
import { videoEditSourcePreview, type VideoEditSourcePreview } from '../application/videoEditSourcePreview'

const logger = createLogger('features.videoEdit.sourcePreview')

/**
 * 源监视器里没有源文件的素材项（代码画面、图形、文字）：用剪辑渲染器逐帧画出只放这一项的临时序列。
 * 与源文件播放同一份请求与回报约定（定位、播放、反向、音量照原样回报；预览没有声音）。播到头停在最后一帧，和源文件一样。
 */
export function createVideoEditSourcePreviewPresenter(host: HTMLElement, projectId: string, observe: (itemId: string, observation: VideoEditSourceObservation) => void): { present: VideoEditSourcePresenter; release: () => Promise<void>; dispose: () => Promise<void> } {
  let canvas: HTMLCanvasElement | undefined
  let current: { itemId: string; preview: VideoEditSourcePreview } | undefined
  let playback: AbortController | undefined
  let disposed = false

  const ensureCanvas = (): HTMLCanvasElement => {
    if (canvas) return canvas
    canvas = host.ownerDocument.createElement('canvas')
    canvas.setAttribute('aria-label', '源素材画面'); canvas.setAttribute('data-video-edit-source-media', 'preview')
    canvas.className = 'h-full w-full object-contain'
    host.appendChild(canvas)
    return canvas
  }
  const draw = async (preview: VideoEditSourcePreview, frame: number, signal: AbortSignal): Promise<void> => {
    const bitmap = await renderPresetPreviewFrame(preview.composition, frame, signal)
    if (!bitmap) return
    if (signal.aborted) { bitmap.close(); signal.throwIfAborted() }
    const target = ensureCanvas()
    target.width = bitmap.width; target.height = bitmap.height
    const context = target.getContext('bitmaprenderer')
    if (context) context.transferFromImageBitmap(bitmap)
    else { target.getContext('2d')?.drawImage(bitmap, 0, 0); bitmap.close() }
  }
  const frameOf = (preview: VideoEditSourcePreview, timeUs: number): number => Math.max(0, Math.min(preview.frames - 1, Math.floor(timeUs * preview.fps / 1e6 + 1e-6)))
  const timeOf = (preview: VideoEditSourcePreview, frame: number): number => Math.round(frame / preview.fps * 1e6)
  const stopPlayback = (): void => { playback?.abort(new DOMException('源预览已停止。', 'AbortError')); playback = undefined }

  // 按墙钟推进：渲染跟不上时跳帧，不拖慢时间；到头（或反向到开头）停住并回报暂停
  const play = (itemId: string, preview: VideoEditSourcePreview, from: number, direction: 1 | -1, volume: number): void => {
    stopPlayback()
    const controller = new AbortController(); playback = controller
    const started = performance.now()
    void (async () => {
      let shown = from
      try {
        while (!controller.signal.aborted) {
          const elapsed = Math.floor((performance.now() - started) * preview.fps / 1000)
          const target = Math.max(0, Math.min(preview.frames - 1, from + direction * elapsed))
          const end = direction === 1 ? target >= preview.frames - 1 : target <= 0
          if (target !== shown || end) {
            if (target !== shown) await draw(preview, target, controller.signal)
            shown = target
            observe(itemId, { timeUs: timeOf(preview, target), presentedTimeUs: timeOf(preview, target), playing: !end, volume, playbackDirection: direction })
            if (end) { if (playback === controller) playback = undefined; return }
          } else await new Promise(resolve => setTimeout(resolve, Math.max(4, 1000 / preview.fps / 2)))
        }
      } catch (error) {
        if (controller.signal.aborted) return
        logger.warn('素材预览播放失败', { event: 'video_edit.source_preview.play_failed', context: { projectId, itemId }, error: String(error) })
        observe(itemId, { timeUs: timeOf(preview, shown), presentedTimeUs: timeOf(preview, shown), playing: false, volume, error: error instanceof Error ? error.message : String(error) })
      }
    })()
  }

  const release = async (): Promise<void> => {
    stopPlayback(); current = undefined
    canvas?.remove(); canvas = undefined
  }
  const present: VideoEditSourcePresenter = async (request, signal) => {
    signal.throwIfAborted()
    if (disposed) throw new Error('源预览面板已关闭。')
    stopPlayback()
    if (!request.itemId) { await release(); return { timeUs: 0, presentedTimeUs: 0, playing: false, volume: request.volume } }
    const preview = await videoEditSourcePreview(projectId, request.itemId)
    signal.throwIfAborted()
    if (current?.itemId !== request.itemId) { canvas?.remove(); canvas = undefined }
    current = { itemId: request.itemId, preview }
    const direction = request.playbackDirection ?? 1
    // 停在末尾（反向时在开头）再按播放：从头（反向从尾）开始
    const requested = frameOf(preview, request.timeUs)
    const frame = request.playing && (direction === 1 ? requested >= preview.frames - 1 : requested <= 0) ? (direction === 1 ? 0 : preview.frames - 1) : requested
    await draw(preview, frame, signal)
    const presentedTimeUs = timeOf(preview, frame)
    if (request.playing) play(request.itemId, preview, frame, direction, request.volume)
    return { timeUs: request.timeUs, presentedTimeUs, playing: request.playing, volume: request.volume, playbackDirection: direction }
  }
  return { present, release, dispose: async () => { disposed = true; await release() } }
}
