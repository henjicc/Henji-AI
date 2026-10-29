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
  /** 网页来源文件夹的内容指纹（预渲染的窗口指纹用它）；开始监视，变化经 `onWebContentChanged` 通知。 */
  webContent: (path: string) => Promise<string>
  onWebContentChanged: (handler: (change: WebSourceContentChange) => void) => () => void
}
