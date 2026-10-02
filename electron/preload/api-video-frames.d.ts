import type {
  VideoFrameBridgeStats,
  VideoFrameStreamEndedPayload,
  VideoFrameStreamInfo,
  VideoFramesPreloadStats,
  VideoFrameTestStreamRequest,
} from '../../src/platform/contracts/videoFrameTypes'

/**
 * 显卡纹理帧通道（见 src/platform/contracts/videoFrames.ts）。`connect()` 返回通道标识，
 * 对应的 MessagePort 随后以 window message `{ type: 'henji:video-frames-port', route }` 交给页面。
 */
export interface HenjiVideoFramesApi {
  connect: () => string
  disconnect: (route: string) => void
  openTestStream: (request: VideoFrameTestStreamRequest) => Promise<VideoFrameStreamInfo>
  closeStream: (streamId: string) => Promise<boolean>
  stats: () => Promise<VideoFrameBridgeStats & { preload: VideoFramesPreloadStats }>
  onStreamEnded: (handler: (payload: VideoFrameStreamEndedPayload) => void) => () => void
}
