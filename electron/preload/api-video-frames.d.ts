import type {
  VideoFrameAtRequest,
  VideoFrameAtResult,
  VideoFrameBridgeStats,
  VideoFrameDecoderInfo,
  VideoFrameDecoderRequest,
  VideoFrameScheduleAck,
  VideoFrameScheduleRequest,
  VideoFrameStreamEndedPayload,
  VideoFrameStreamInfo,
  VideoFramesPreloadStats,
  VideoFrameTestStreamRequest,
  WebSourceContentChange,
} from '../../src/platform/contracts/videoFrameTypes'

/**
 * 显卡纹理帧通道（见 src/platform/contracts/videoFrames.ts）。`connect()` 返回通道标识，
 * 对应的 MessagePort 随后以 window message `{ type: 'henji:video-frames-port', route }` 交给页面。
 */
export interface HenjiVideoFramesApi {
  connect: () => string
  disconnect: (route: string) => void
  openTestStream: (request: VideoFrameTestStreamRequest) => Promise<VideoFrameStreamInfo>
  openDecoder: (request: VideoFrameDecoderRequest) => Promise<VideoFrameDecoderInfo>
  frameAt: (request: VideoFrameAtRequest) => Promise<VideoFrameAtResult>
  schedule: (request: VideoFrameScheduleRequest) => Promise<VideoFrameScheduleAck>
  cancelSchedule: (streamId: string, scheduleId: string) => Promise<boolean>
  closeStream: (streamId: string) => Promise<boolean>
  stats: () => Promise<VideoFrameBridgeStats & { preload: VideoFramesPreloadStats }>
  onStreamEnded: (handler: (payload: VideoFrameStreamEndedPayload) => void) => () => void
  /**
   * 设定本窗口要监视的网页路径（打开着的剪辑引用的全部网页，整份替换），返回各路径当前的内容指纹（读不出来为 null）；
   * 之后文件夹变化经 `onWebContentChanged` 通知。
   */
  watchWebContent: (paths: string[]) => Promise<Record<string, string | null>>
  onWebContentChanged: (handler: (change: WebSourceContentChange) => void) => () => void
}
