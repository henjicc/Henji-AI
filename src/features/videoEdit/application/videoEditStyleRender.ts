import { BufferTarget, CanvasSource, Mp4OutputFormat, Output } from 'mediabunny'
import { createLogger } from '@/core/logging'
import { notExecutedFailure } from '@/core/application-control/execution/writeExecution'
import { styleGuideMissingSections } from '@/core/videoEdit/styles/styleGuide'
import { nextVideoEditStyleVersion, videoEditStyleContentHash, type VideoEditStyle } from '@/core/videoEdit/styles/styleSchemas'
import { renderPresetPreviewFrame, styleSampleTimeline } from './videoEditPresetPreview'
import { videoEditStyleLibrary, type VideoEditLibraryStyle, type VideoEditStyleMediaBytes } from './videoEditStyleLibrary'

const logger = createLogger('features.videoEdit.styleRender')
// 样片按自身尺寸（最大 4K60）渲染；存下的预览与锚点帧长边不超过 1920，码率随尺寸与帧率走，
// 再按时长封顶：预览最多约 7.5 MB（12 秒 5 Mbps），30 秒的样片连同 10 张锚点帧也放得进风格包（16 MB）。
const PREVIEW_LONG_EDGE = 1920
const THUMBNAIL_WIDTH = 320
const PREVIEW_BITS_PER_PIXEL = 0.08
const PREVIEW_BITRATE_RANGE = [1_500_000, 5_000_000] as const
const PREVIEW_MAX_BYTES = 7.5 * 1000 * 1000
function previewBitrate(width: number, height: number, fps: number, durationSeconds: number): number {
  const budget = PREVIEW_MAX_BYTES * 8 / Math.max(1, durationSeconds)
  return Math.round(Math.min(PREVIEW_BITRATE_RANGE[1], budget, Math.max(PREVIEW_BITRATE_RANGE[0], width * height * fps * PREVIEW_BITS_PER_PIXEL)))
}

function fit(width: number, height: number, longEdge: number): { width: number; height: number } {
  const scale = Math.min(1, longEdge / Math.max(width, height)); const even = (value: number): number => Math.max(2, Math.round(value * scale / 2) * 2)
  return { width: even(width), height: even(height) }
}
async function jpeg(bitmap: ImageBitmap, width: number, height: number): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(width, height); canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height)
  return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg', quality: .86 })).arrayBuffer())
}

export interface VideoEditStyleRenderResult { entry: VideoEditLibraryStyle; version: number; changed: boolean; warnings: string[]; frames: number }
/**
 * 渲染样片（Frameflow render）：用剪辑的正式合成器逐帧渲染样片代码，生成预览视频（H.264，长边不超过 1920）、
 * 缩略图（宽 320）与锚点帧；说明书或样片内容变了（或从未渲染过）版本号加 1。只用本机渲染，不调用付费模型。
 */
export async function renderVideoEditStyle(styleId: string, signal: AbortSignal, onProgress?: (done: number, total: number) => void): Promise<VideoEditStyleRenderResult> {
  await videoEditStyleLibrary.ready()
  const entry = videoEditStyleLibrary.requireStyle(styleId)
  if (entry.builtin) throw new Error('内置风格只读，已带预览；要修改请先复制成个人风格再渲染。')
  const style: VideoEditStyle = entry.style
  logger.info('style.render.start', '渲染风格样片', { context: { styleId, width: style.sample.width, height: style.sample.height, fps: style.sample.fps } })
  // 只有最后保存进风格库才写入；在那之前失败（样片代码编译不过、某帧没有画面、取消）什么都没改，可以修正后直接重试。
  let saving = false
  try {
    const timeline = await styleSampleTimeline(style.sample, signal, style.foreign ? [style.foreign] : [])
    const size = fit(style.sample.width, style.sample.height, PREVIEW_LONG_EDGE)
    const thumbnailSize = { width: THUMBNAIL_WIDTH, height: Math.max(2, Math.round(THUMBNAIL_WIDTH * style.sample.height / style.sample.width / 2) * 2) }
    const canvas = new OffscreenCanvas(size.width, size.height); const context = canvas.getContext('2d')!
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() })
    const video = new CanvasSource(canvas, { codec: 'avc', bitrate: previewBitrate(size.width, size.height, timeline.fps, style.sample.durationSeconds), bitrateMode: 'constant', keyFrameInterval: 2 })
    output.addVideoTrack(video, { frameRate: timeline.fps })
    const media: VideoEditStyleMediaBytes = { anchors: [] }
    const anchorFrames = style.sample.anchors.map(seconds => Math.min(timeline.frames - 1, Math.round(seconds * timeline.fps)))
    const anchors = new Map<number, Uint8Array>()
    await output.start()
    try {
      for (let frame = 0; frame < timeline.frames; frame++) {
        signal.throwIfAborted()
        const bitmap = await renderPresetPreviewFrame(timeline.composition, frame, signal)
        if (!bitmap) throw new Error(`样片第 ${frame} 帧没有画面，请检查样片代码。`)
        try {
          context.drawImage(bitmap, 0, 0, size.width, size.height)
          if (anchorFrames.includes(frame)) anchors.set(frame, await jpeg(bitmap, Math.min(bitmap.width, size.width), Math.min(bitmap.height, size.height)))
          if (frame === timeline.poster) media.thumbnail = await jpeg(bitmap, thumbnailSize.width, thumbnailSize.height)
        } finally { bitmap.close() }
        await video.add(frame / timeline.fps, 1 / timeline.fps)
        onProgress?.(frame + 1, timeline.frames)
      }
      await output.finalize()
    } catch (error) { await output.cancel().catch(() => undefined); throw error }
    media.preview = new Uint8Array((output.target as BufferTarget).buffer!)
    media.anchors = anchorFrames.map(frame => anchors.get(frame)!)
    const contentHash = await videoEditStyleContentHash(style)
    const revision = nextVideoEditStyleVersion(style, contentHash)
    signal.throwIfAborted()
    saving = true
    const saved = await videoEditStyleLibrary.saveStyle({ ...style, contentHash, version: revision.version }, media)
    const missing = styleGuideMissingSections(style.guide)
    const warnings = missing.length ? [`说明书还缺这些栏目：${missing.join('、')}。`] : []
    logger.info('style.render.completed', '风格样片已渲染', { context: { styleId, version: revision.version, changed: revision.changed, frames: timeline.frames, previewBytes: media.preview.byteLength } })
    return { entry: saved, version: revision.version, changed: revision.changed, warnings, frames: timeline.frames }
  } catch (error) {
    logger.error('style.render.failed', '风格样片渲染失败', { error, context: { styleId, saving } })
    throw saving ? error : notExecutedFailure(error)
  }
}
