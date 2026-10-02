import { app, type WebContents } from 'electron'
import {
  getVideoFrameBridge,
  parseVideoFrameTestStreamRequest,
  type VideoFrameBridgeStats,
  type VideoFrameStreamInfo,
  type VideoFrameTarget,
} from '../services/video-decoder'
import { parseStringField, parseVoid, registerIpcHandler } from './registry'

/**
 * 显卡纹理帧流 IPC：渲染层经 preload `videoFrames` 打开/关闭帧流，帧本身走 `sharedTexture`
 * 直接送到发起请求的窗口主 frame。1.2 只开放合成测试画面（开发运行或显式诊断开关），
 * 真实解码流在 1.3/2.2 接入同一桥。
 */

const targets = new WeakMap<WebContents, VideoFrameTarget>()

/** 把 WebContents 适配为帧目标；导航、渲染进程退出或销毁都视为页面内接收端失效。 */
export function webContentsFrameTarget(contents: WebContents): VideoFrameTarget {
  const existing = targets.get(contents)
  if (existing) return existing
  const target: VideoFrameTarget = {
    id: contents.id,
    isDestroyed: () => contents.isDestroyed(),
    get mainFrame() {
      return contents.mainFrame
    },
    send: (channel, payload) => {
      if (!contents.isDestroyed()) contents.send(channel, payload)
    },
    onGone: (listener) => {
      const destroyed = () => listener('destroyed')
      const gone = () => listener('render_process_gone')
      const navigated = () => listener('navigated')
      contents.once('destroyed', destroyed)
      contents.on('render-process-gone', gone)
      contents.on('did-navigate', navigated)
      return () => {
        contents.removeListener('destroyed', destroyed)
        contents.removeListener('render-process-gone', gone)
        contents.removeListener('did-navigate', navigated)
      }
    },
  }
  targets.set(contents, target)
  return target
}

/** 合成测试画面只用于开发与诊断，正式安装包需显式开启。 */
export function isVideoFrameTestPatternAllowed(isPackaged: boolean, env: NodeJS.ProcessEnv): boolean {
  return !isPackaged || env.HENJI_VIDEO_FRAME_DIAGNOSTICS === '1'
}

export function registerVideoFramesIpc(): void {
  registerIpcHandler<ReturnType<typeof parseVideoFrameTestStreamRequest>, VideoFrameStreamInfo>(
    'videoFrames:openTestStream',
    parseVideoFrameTestStreamRequest,
    (request, event) => {
      if (!isVideoFrameTestPatternAllowed(app.isPackaged, process.env)) throw new Error('测试帧流未开启')
      return getVideoFrameBridge().openTestStream(webContentsFrameTarget(event.sender), request)
    },
  )
  registerIpcHandler<string, boolean>(
    'videoFrames:closeStream',
    (input) => parseStringField(input, 'streamId'),
    (streamId, event) => getVideoFrameBridge().closeStream(streamId, 'requested', event.sender.id),
  )
  registerIpcHandler<void, VideoFrameBridgeStats>('videoFrames:stats', parseVoid, () => getVideoFrameBridge().stats())
}
