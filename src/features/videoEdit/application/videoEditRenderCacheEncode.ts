import { Mp4OutputFormat, Output, StreamTarget } from 'mediabunny'
import type { VideoEditRenderPrecision } from '../engine/videoEditRenderer'
import { videoEditRenderEncoding, type VideoEditRenderEncoding } from '@/core/videoEdit/renderBitrate'
import type { VideoRenderCacheStoredEntry } from '@/core/videoEdit/renderCacheStore'
import type { VideoEditComposition } from '@/core/videoEdit/document'
import { getMediaCacheSettings } from '@/services/mediaCache/mediaCacheSettings'
import { resolveRenderCacheCodec } from '@/services/mediaCache/hardwareCapabilities'
import { getPlatform } from '@/platform/runtime'
import { VideoEditRenderSession } from '../engine/videoEditRenderSession'
import { videoEditExportVideoStream } from '../engine/videoEditExportEncoder'
import { VideoEditEncodedVideo, runVideoEditEncodePipeline } from '../engine/videoEditEncodedVideo'
import { videoEditTrackResults } from './videoEditTracking'
import type { waitVideoEditSmartRegions } from './videoEditSmartRegions'

/**
 * 预渲染里决定预览文件字节的部分：编码档案、交给渲染会话的输入，以及一个窗口怎样编码、封装、登记。
 * 这个文件整个计入预渲染引擎版本（scripts/vite/renderEngineVersion.mjs），一改就让全部预览文件失效；
 * 何时渲、渲哪些窗口、让出与续上、吃力判断与日志留在 videoEditRenderCache.ts，改它们不让已有文件失效。
 * 拿不准是否影响画面或编码的逻辑放这里。
 */

/** 序列的编码档案：编码格式（自动时按本机硬件）、画质与按分辨率帧率计算的码率。 */
export function videoEditRenderProfile(composition: Pick<VideoEditComposition, 'width' | 'height' | 'fps'>): VideoEditRenderEncoding {
  const settings = getMediaCacheSettings()
  return videoEditRenderEncoding(composition, resolveRenderCacheCodec(settings.renderFormat), settings.renderQuality)
}

/** 渲染会话的画面输入：序列、智能区域与跟踪结果。窗口指纹里的分析结果必须描述的就是这里交出去的这一份。 */
export function openVideoEditRenderSession(composition: VideoEditComposition, smartRegions: Awaited<ReturnType<typeof waitVideoEditSmartRegions>>): VideoEditRenderSession {
  const session = new VideoEditRenderSession({ ...composition })
  session.setSmartRegions(smartRegions); session.setTracks(videoEditTrackResults(composition))
  return session
}

export interface VideoEditRenderWindowEncode {
  projectId: string
  composition: VideoEditComposition
  window: { key: string; startFrame: number; endFrame: number }
  encoding: VideoEditRenderEncoding
  precision: VideoEditRenderPrecision
  renderer: VideoEditRenderSession
  /** 调度只决定节奏，不改变每帧的内容与时间：同时在途几帧、每帧前后的让出与歇息、登记前的归属核对。 */
  inFlight: number
  signal: AbortSignal
  beforeFrame: (index: number) => void
  afterFrame: () => Promise<void>
  beforeCommit: () => void
}

/** 一个窗口完整编码后才登记；中途让出、取消或失败都丢弃临时文件，缓存里不会有半成品。 */
export async function encodeVideoEditRenderWindow(input: VideoEditRenderWindowEncode): Promise<VideoRenderCacheStoredEntry> {
  const { projectId, composition, window, encoding, precision, renderer, signal } = input
  const platform = getPlatform()
  // 每帧都是关键帧，节目可以从窗口内任一帧起播。
  const video = new VideoEditEncodedVideo(videoEditExportVideoStream({ codec: encoding.codec, width: composition.width, height: composition.height, fps: composition.fps, videoBitrateMbps: encoding.bitrateMbps, bitrateMode: encoding.bitrateMode, encoderPreference: encoding.encoderPreference, keyframeInterval: encoding.keyframeInterval }), 'renderCache', true)
  const path = await platform.mediaCache.renderBegin({ projectId, windowKey: window.key, profile: encoding.profile })
  const output = new Output({ format: new Mp4OutputFormat(), target: new StreamTarget(new WritableStream({ write: async chunk => { await platform.system.fs.writeFile(path, chunk.data, { position: chunk.position }) } }), { chunked: true, chunkSize: 4 * 1024 * 1024 }) })
  try {
    output.addVideoTrack(video.source, video.trackMetadata(composition.fps))
    await output.start()
    await video.open(renderer)
    let provenance: VideoRenderCacheStoredEntry['provenance'] = 'live'
    // 让出时流水随信号立即结束、会话随即释放，不等在途的帧算完。
    await runVideoEditEncodePipeline({
      frames: window.endFrame - window.startFrame,
      inFlight: input.inFlight,
      signal,
      before: index => input.beforeFrame(index),
      send: (index, submitted) => video.encode(window.startFrame + index, index / composition.fps, 1 / composition.fps, precision, submitted),
      finished: async (_index, rendered) => {
        if (rendered.provenance === 'web-cache') provenance = 'web-cache'
        await input.afterFrame()
      },
    })
    await abortable(video.finish(), signal)
    await output.finalize()
    input.beforeCommit()
    return await platform.mediaCache.renderCommit({ temporaryPath: path, entry: { provenance, projectId, sequenceId: composition.id, windowKey: window.key, profile: encoding.profile, startFrame: window.startFrame, endFrame: window.endFrame, width: composition.width, height: composition.height, fps: composition.fps } })
  } catch (error) {
    video.close()
    await output.cancel().catch(() => undefined)
    await platform.mediaCache.renderDiscard(path).catch(() => undefined)
    throw error
  }
}

/** 在途请求随信号立即结束；原请求迟到的结果被吞掉，不成为未处理的拒绝。 */
export function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  work.catch(() => undefined)
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    work.then(value => { signal.removeEventListener('abort', onAbort); resolve(value) }, error => { signal.removeEventListener('abort', onAbort); reject(error) })
  })
}
