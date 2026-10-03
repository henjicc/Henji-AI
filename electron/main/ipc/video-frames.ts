import path from 'node:path'
import { app, type WebContents } from 'electron'
import { isPathWithinAllowedMediaRoots } from '../protocol'
import type { VideoAudioOpenRequest, VideoAudioReadRequest, VideoAudioReadResult, VideoAudioSessionInfo } from '../../../src/platform/contracts/videoFrameTypes'
import {
  getVideoAudioSessions,
  getVideoFrameBridge,
  parseVideoAudioCloseRequest,
  parseVideoAudioOpenRequest,
  parseVideoAudioReadRequest,
  parseVideoFrameAtRequest,
  parseVideoFrameCancelRequest,
  parseVideoFrameDecoderRequest,
  parseVideoFrameScheduleRequest,
  parseVideoFrameTestStreamRequest,
  VideoDecoderError,
  type VideoFrameAtRequest,
  type VideoFrameAtResult,
  type VideoFrameBridgeStats,
  type VideoFrameDecoderInfo,
  type VideoFrameDecoderRequest,
  type VideoFrameScheduleAck,
  type VideoFrameScheduleRequest,
  type VideoFrameStreamInfo,
  type VideoFrameTarget,
} from '../services/video-decoder'
import { parseStringField, parseVoid, registerIpcHandler } from './registry'

/**
 * 显卡纹理帧流 IPC：渲染层经 preload `videoFrames` 打开/关闭帧流，帧本身走 `sharedTexture`
 * 直接送到发起请求的窗口主 frame。合成测试画面只在开发运行或显式诊断开关下开放；
 * 原生解码会话（1.3）读取已授权媒体目录内的本地文件（与 henji-media 协议同一授权），
 * 取帧请求只能操作本窗口打开的会话。声音会话（2.3）同一授权与归属规则，PCM 随响应返回。
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
  registerIpcHandler<VideoFrameDecoderRequest, VideoFrameDecoderInfo>('videoFrames:openDecoder', parseVideoFrameDecoderRequest, (request, event) => {
    if (!path.isAbsolute(request.path)) throw new VideoDecoderError('UNAUTHORIZED', '素材路径必须是绝对路径')
    if (!isPathWithinAllowedMediaRoots(request.path)) throw new VideoDecoderError('UNAUTHORIZED', '素材所在目录尚未授权读取')
    return getVideoFrameBridge().openDecoder(webContentsFrameTarget(event.sender), request)
  })
  registerIpcHandler<VideoFrameAtRequest, VideoFrameAtResult>('videoFrames:frameAt', parseVideoFrameAtRequest, (request, event) => getVideoFrameBridge().frameAt(event.sender.id, request))
  registerIpcHandler<VideoFrameScheduleRequest, VideoFrameScheduleAck>('videoFrames:schedule', parseVideoFrameScheduleRequest, (request, event) => getVideoFrameBridge().schedule(event.sender.id, request))
  registerIpcHandler<{ streamId: string; scheduleId: string }, boolean>('videoFrames:cancelSchedule', parseVideoFrameCancelRequest, (request, event) => getVideoFrameBridge().cancelSchedule(event.sender.id, request.streamId, request.scheduleId))
  registerIpcHandler<string, boolean>(
    'videoFrames:closeStream',
    (input) => parseStringField(input, 'streamId'),
    (streamId, event) => getVideoFrameBridge().closeStream(streamId, 'requested', event.sender.id),
  )
  registerIpcHandler<VideoAudioOpenRequest, VideoAudioSessionInfo>('videoFrames:openAudio', parseVideoAudioOpenRequest, (request, event) => {
    if (!path.isAbsolute(request.path)) throw new VideoDecoderError('UNAUTHORIZED', '素材路径必须是绝对路径')
    if (!isPathWithinAllowedMediaRoots(request.path)) throw new VideoDecoderError('UNAUTHORIZED', '素材所在目录尚未授权读取')
    return getVideoAudioSessions().open(webContentsFrameTarget(event.sender), request)
  })
  registerIpcHandler<VideoAudioReadRequest, VideoAudioReadResult>('videoFrames:readAudio', parseVideoAudioReadRequest, (request, event) => getVideoAudioSessions().read(event.sender.id, request))
  registerIpcHandler<string, boolean>('videoFrames:closeAudio', parseVideoAudioCloseRequest, (audioId, event) => getVideoAudioSessions().close(audioId, event.sender.id))
  // 通道断开（preload disconnect）时关闭该通道上仍打开的会话（画面与声音）：消费方 Worker 被终止时可能来不及自行关闭。
  registerIpcHandler<string, number>(
    'videoFrames:closeRoute',
    (input) => parseStringField(input, 'route'),
    async (route, event) => {
      const [streams, sounds] = await Promise.all([getVideoFrameBridge().closeRoute(event.sender.id, route), getVideoAudioSessions().closeRoute(event.sender.id, route)])
      return streams + sounds
    },
  )
  registerIpcHandler<void, VideoFrameBridgeStats>('videoFrames:stats', parseVoid, () => getVideoFrameBridge().stats())
}
