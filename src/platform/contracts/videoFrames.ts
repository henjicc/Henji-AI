/**
 * 显卡纹理帧通道（原生解码画面零拷贝送到渲染层）的渲染层契约：端口消息与平台接口。
 * 渲染层专用（含 DOM 类型）；主进程与 preload 引用 DOM 无关的数据契约 `videoFrameTypes.ts`。
 *
 * 帧本身不走 IPC：主进程 `sharedTexture` → preload 得到 VideoFrame → 经 `connect()` 交给页面的
 * MessagePort 转交（transfer）到消费方 Worker。**VideoFrame 必须回到渲染进程主线程关闭**：在 Worker 里
 * close（或被 Worker 回收）会触发 Electron 共享纹理释放回调的线程检查，整个渲染进程崩溃。
 * 所以消费方用完后把帧原样 `postMessage({ type: 'release', frame }, [frame])` 发回同一端口，由 preload 关闭。
 */

export * from './videoFrameTypes'
import type { VideoFrameBridgeStats, VideoFrameMeta, VideoFrameStreamEndedPayload, VideoFrameStreamInfo, VideoFramesPreloadStats, VideoFrameTestStreamRequest } from './videoFrameTypes'

/** preload → 消费方端口的消息。 */
export interface VideoFramePortFrameMessage {
  type: 'frame'
  meta: VideoFrameMeta
  frame: VideoFrame
  /** preload 分配的借出编号，交回时原样带回（transfer 后对象身份会变，不能按对象匹配）。 */
  token: number
}

/** 消费方 → preload 端口的消息：交回帧，由 preload 在主线程关闭。 */
export interface VideoFramePortReleaseMessage {
  type: 'release'
  frame: VideoFrame
  token: number
}

export interface VideoFrameChannel {
  route: string
  /** 交给消费方 Worker（transfer）；帧消息与交回协议见文件头。 */
  port: MessagePort
}

export interface VideoFramesPlatform {
  /** 建立一条帧通道。端口只应转交给一个消费方。 */
  connect(): Promise<VideoFrameChannel>
  disconnect(route: string): void
  /** 合成测试画面帧流（开发与诊断）。 */
  openTestStream(request: VideoFrameTestStreamRequest): Promise<VideoFrameStreamInfo>
  closeStream(streamId: string): Promise<boolean>
  stats(): Promise<VideoFrameBridgeStats & { preload: VideoFramesPreloadStats }>
  onStreamEnded(listener: (payload: VideoFrameStreamEndedPayload) => void): () => void
}
