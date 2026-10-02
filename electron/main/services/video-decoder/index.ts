import { app } from 'electron'
import { createMainLogger } from '../logging/main-logger'
import { VideoDecoderService } from './client'
import { resolveVideoDecoderExecutable } from './paths'

export { VideoDecoderService } from './client'
export type { VideoDecoderServiceState, VideoDecoderRequestOptions } from './client'
export { VideoDecoderError } from './protocol'
export type { VideoDecoderErrorCode, VideoDecoderHello, VideoDecoderProbeResult, VideoDecoderStreamInfo } from './protocol'

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
