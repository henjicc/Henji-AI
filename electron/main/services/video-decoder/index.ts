import { app, sharedTexture } from 'electron'
import { createMainLogger } from '../logging/main-logger'
import { VideoDecoderService } from './client'
import { resolveVideoDecoderExecutable, videoDecoderDiagnosticLimits, videoDecoderExecutableOverride } from './paths'
import { VideoFrameBridge } from './texture-bridge'
import { VideoAudioSessions } from './audio-sessions'

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
export { VideoAudioSessions, parseVideoAudioCloseRequest, parseVideoAudioOpenRequest, parseVideoAudioReadRequest } from './audio-sessions'
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
 *
 * 开发诊断（未打包时才读，每次启动服务时重新读取，故障注入场景据此在运行中切换，3.1）：
 * `HENJI_VIDEO_DECODER_EXECUTABLE` 指定服务可执行文件（不存在即“服务缺失”）；
 * `HENJI_VIDEO_DECODER_VRAM_BUDGET_MB` 缩小解码显存预算（验证超出预算的提示）。
 */
export function getVideoDecoderService(): VideoDecoderService {
  if (service) return service
  const created = new VideoDecoderService({
    logger: createMainLogger('main.video_decoder'),
    resolveExecutable: () => {
      const override = videoDecoderExecutableOverride(app.isPackaged, process.env)
      if (override) return override.path
      return resolveVideoDecoderExecutable({
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        cwd: process.cwd(),
        platform: process.platform,
      })
    },
    limits: () => videoDecoderDiagnosticLimits(app.isPackaged, process.env),
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

let audioSessions: VideoAudioSessions | null = null

/** 主进程唯一的原生声音会话登记（共用原生服务实例，2.3）。 */
export function getVideoAudioSessions(): VideoAudioSessions {
  if (audioSessions) return audioSessions
  const created = new VideoAudioSessions({ service: getVideoDecoderService(), logger: createMainLogger('main.video_audio') })
  app.once('will-quit', () => {
    void created.dispose()
  })
  audioSessions = created
  return created
}
