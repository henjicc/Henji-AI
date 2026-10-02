import { app, sharedTexture } from 'electron'
import { createMainLogger } from '../logging/main-logger'
import { VideoDecoderService } from './client'
import { resolveVideoDecoderExecutable } from './paths'
import { VideoFrameBridge } from './texture-bridge'

export { VideoDecoderService } from './client'
export type { VideoDecoderServiceState, VideoDecoderRequestOptions, VideoDecoderLifecycleEvent } from './client'
export { VideoDecoderError } from './protocol'
export {
  VideoFrameBridge,
  VIDEO_FRAMES_STREAM_ENDED_CHANNEL,
  parseVideoFrameAtRequest,
  parseVideoFrameCancelRequest,
  parseVideoFrameDecoderRequest,
  parseVideoFrameScheduleRequest,
  parseVideoFrameTestStreamRequest,
} from './texture-bridge'
export type {
  VideoFrameAtRequest,
  VideoFrameAtResult,
  VideoFrameBridgeStats,
  VideoFrameDecoderInfo,
  VideoFrameDecoderRequest,
  VideoFrameScheduleAck,
  VideoFrameScheduleRequest,
  VideoFrameStreamInfo,
  VideoFrameTarget,
  VideoFrameTestStreamRequest,
} from './texture-bridge'
export type {
  VideoDecoderErrorCode,
  VideoDecoderEvent,
  VideoDecoderHello,
  VideoDecoderProbeResult,
  VideoDecoderStats,
  VideoDecoderStreamInfo,
  VideoDecoderStreamStarted,
  VideoSharedFormat,
} from './protocol'

let service: VideoDecoderService | null = null

/**
 * 主进程唯一的原生视频解码服务实例。首次请求时才启动子进程（按需），应用退出时关闭；
 * 子进程在 stdin 关闭时也会自行退出，主进程异常结束不会残留。
 */
export function getVideoDecoderService(): VideoDecoderService {
  if (service) return service
  const created = new VideoDecoderService({
    logger: createMainLogger('main.video_decoder'),
    resolveExecutable: () => resolveVideoDecoderExecutable({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      cwd: process.cwd(),
      platform: process.platform,
    }),
  })
  app.once('will-quit', () => {
    void created.shutdown()
  })
  service = created
  return created
}

let bridge: VideoFrameBridge | null = null

/** 主进程唯一的显卡纹理零拷贝桥（共用原生服务实例）。 */
export function getVideoFrameBridge(): VideoFrameBridge {
  if (bridge) return bridge
  const created = new VideoFrameBridge({
    service: getVideoDecoderService(),
    sharedTexture,
    logger: createMainLogger('main.video_frames'),
    allowUnsupportedFormats: process.env.HENJI_VIDEO_FRAMES_UNSUPPORTED_FORMATS === '1',
  })
  app.once('will-quit', () => {
    void created.dispose()
  })
  bridge = created
  return created
}
