import { ipcRenderer, sharedTexture } from 'electron'
import {
  VIDEO_FRAMES_PORT_MESSAGE_TYPE,
  type VideoFrameMeta,
  type VideoFrameStreamEndedPayload,
  type VideoFramesPortWindowMessage,
  type VideoFramesPreloadStats,
} from '../../src/platform/contracts/videoFrameTypes'
import type { HenjiVideoFramesApi } from './api-video-frames'

type NativeInvoke = <T>(channel: string, payload?: unknown) => Promise<T>

/** preload 编译环境没有 DOM lib，只声明本文件用到的最小形状。 */
interface ClosableFrame {
  close(): void
}

interface FramePort {
  postMessage(message: unknown, transfer: unknown[]): void
  onmessage: ((event: { data: unknown }) => void) | null
  close(): void
}

interface FrameChannel {
  port1: FramePort
  port2: unknown
}

interface WindowLike {
  postMessage(message: unknown, targetOrigin: string, transfer: unknown[]): void
}

interface Route {
  port: FramePort
  /** 借出编号 → 帧号。transfer 回来的是新对象，只能按编号对账。 */
  outstanding: Map<number, number>
}

function isFrameMeta(value: unknown): value is VideoFrameMeta {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.route === 'string' && typeof record.streamId === 'string' && typeof record.frameIndex === 'number'
}

/**
 * 显卡纹理帧接收端（沙盒 preload）。页面拿不到 `sharedTexture` 本身：只拿到一个 MessagePort，
 * 收到的 VideoFrame 经端口 transfer 给页面指定的消费方（通常是渲染 Worker）。
 *
 * VideoFrame 必须在渲染进程主线程关闭（Worker 线程关闭会触发 Electron 释放回调的线程检查而崩溃），
 * 所以消费方用完把帧经同一端口交回（`{ type: 'release', frame }`），在这里关闭。
 */
export function createVideoFramesApi(nativeInvoke: NativeInvoke): HenjiVideoFramesApi {
  const routes = new Map<string, Route>()
  const counters = { received: 0, delivered: 0, dropped: 0, returned: 0 }
  let nextRoute = 1
  let nextToken = 1

  sharedTexture.setSharedTextureReceiver(async (data, ...args: unknown[]) => {
    const imported = data.importedSharedTexture
    counters.received += 1
    try {
      const meta = isFrameMeta(args[0]) ? args[0] : null
      const frame: ClosableFrame = imported.getVideoFrame()
      const route = meta ? routes.get(meta.route) : undefined
      if (!meta || !route) {
        counters.dropped += 1
        frame.close()
        return
      }
      const token = nextToken++
      try {
        route.port.postMessage({ type: 'frame', meta, frame, token }, [frame])
        route.outstanding.set(token, meta.frameIndex)
        counters.delivered += 1
      } catch {
        counters.dropped += 1
        frame.close()
      }
    } finally {
      // VideoFrame 自带对共享纹理的引用；接收端的导入引用可立即释放。
      imported.release()
    }
  })

  const closeRoute = (route: string): void => {
    const entry = routes.get(route)
    if (!entry) return
    routes.delete(route)
    entry.port.onmessage = null
    entry.port.close()
  }

  return {
    connect: () => {
      const route = `vf-route-${nextRoute++}`
      const channel = new (globalThis as unknown as { MessageChannel: new () => FrameChannel }).MessageChannel()
      const entry: Route = { port: channel.port1, outstanding: new Map() }
      channel.port1.onmessage = (event) => {
        const message = event.data as { type?: unknown; frame?: unknown; token?: unknown } | null
        if (message?.type !== 'release' || !message.frame) return
        if (typeof message.token === 'number') entry.outstanding.delete(message.token)
        counters.returned += 1
        ;(message.frame as ClosableFrame).close()
      }
      routes.set(route, entry)
      const announcement: VideoFramesPortWindowMessage = { type: VIDEO_FRAMES_PORT_MESSAGE_TYPE, route }
      // 隔离世界与页面共享同一个 window：用 window message 把端口交给页面（Electron 文档推荐做法）。
      ;(globalThis as unknown as WindowLike).postMessage(announcement, '*', [channel.port2])
      return route
    },
    disconnect: (route) => closeRoute(route),
    openTestStream: (request) => nativeInvoke('videoFrames:openTestStream', request),
    closeStream: (streamId) => nativeInvoke('videoFrames:closeStream', { streamId }),
    stats: async () => {
      const bridge = await nativeInvoke<Awaited<ReturnType<HenjiVideoFramesApi['stats']>>>('videoFrames:stats')
      const outstanding = [...routes.values()].reduce((total, entry) => total + entry.outstanding.size, 0)
      const preload: VideoFramesPreloadStats = { ...counters, outstanding, routes: [...routes.keys()] }
      return { ...bridge, preload }
    },
    onStreamEnded: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: VideoFrameStreamEndedPayload): void => handler(payload)
      ipcRenderer.on('videoFrames:streamEnded', listener)
      return () => {
        ipcRenderer.removeListener('videoFrames:streamEnded', listener)
      }
    },
  }
}
