import { ipcRenderer, sharedTexture } from 'electron'
import {
  VIDEO_FRAMES_PORT_MESSAGE_TYPE,
  VIDEO_FRAMES_SCHEDULE_EVENT_CHANNEL,
  type VideoFrameMeta,
  type VideoFramePortCall,
  type VideoFramePortResponseMessage,
  type VideoFrameScheduleEvent,
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

/** 端口请求方法 → IPC 通道（解码会话的取帧请求，权限与归属仍由主进程按发起窗口检查）。 */
const PORT_CALL_CHANNELS: Record<VideoFramePortCall['method'], string> = {
  openDecoder: 'videoFrames:openDecoder',
  frameAt: 'videoFrames:frameAt',
  schedule: 'videoFrames:schedule',
  cancelSchedule: 'videoFrames:cancelSchedule',
  closeStream: 'videoFrames:closeStream',
  openAudio: 'videoFrames:openAudio',
  readAudio: 'videoFrames:readAudio',
  closeAudio: 'videoFrames:closeAudio',
}

/** 会话归属本通道的请求：preload 填入本通道的 route（忽略消费方给的值）。 */
const ROUTED_CALLS: ReadonlySet<VideoFramePortCall['method']> = new Set(['openDecoder', 'openAudio'])

/**
 * 声音读取结果里的 PCM：IPC 送来的是字节数组，转为独占的 ArrayBuffer 后 transfer 给 Worker（这一跳不再拷贝）。
 * 其他请求的结果不含可转交的数据。
 */
function transferable(method: VideoFramePortCall['method'], result: unknown): { result: unknown; transfer: unknown[] } {
  if (method !== 'readAudio' || !result || typeof result !== 'object') return { result, transfer: [] }
  const data = (result as { data?: unknown }).data
  if (!(data instanceof Uint8Array)) return { result, transfer: [] }
  const buffer = data.byteOffset === 0 && data.byteLength === data.buffer.byteLength && data.buffer instanceof ArrayBuffer ? data.buffer : data.slice().buffer
  return { result: { ...result, data: buffer }, transfer: [buffer] }
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

  // 解码计划的缺帧与结束事件：投递到流所属通道的端口（与帧同一端口，消费方按 index 对齐）。
  ipcRenderer.on(VIDEO_FRAMES_SCHEDULE_EVENT_CHANNEL, (_event, payload: VideoFrameScheduleEvent) => {
    const route = payload && typeof payload.route === 'string' ? routes.get(payload.route) : undefined
    if (!route) return
    try {
      route.port.postMessage({ type: 'schedule', event: payload }, [])
    } catch {
      // 端口已关闭：消费方已不在，忽略。
    }
  })

  // 流结束（原生出错、服务退出）也投递到所属通道的端口：消费方 Worker 据此停止等待该流的帧。
  ipcRenderer.on('videoFrames:streamEnded', (_event, payload: VideoFrameStreamEndedPayload) => {
    const route = payload && typeof payload.route === 'string' ? routes.get(payload.route) : undefined
    if (!route) return
    try {
      route.port.postMessage({ type: 'ended', payload }, [])
    } catch {
      // 端口已关闭：消费方已不在，忽略。
    }
  })

  const closeRoute = (route: string): void => {
    const entry = routes.get(route)
    if (!entry) return
    routes.delete(route)
    entry.port.onmessage = null
    entry.port.close()
    // 消费方 Worker 可能未能自行关闭会话（被终止、崩溃）：由主进程关闭该通道上仍打开的会话。
    void Promise.resolve(nativeInvoke('videoFrames:closeRoute', { route })).catch(() => undefined)
  }

  /** 端口请求转为 IPC；打开的解码会话与声音会话一律归属本通道（忽略请求里的 route）。 */
  const answer = async (route: string, entry: Route, id: number, call: VideoFramePortCall | undefined): Promise<void> => {
    const reply = (body: Omit<VideoFramePortResponseMessage, 'type' | 'id'>, transfer: unknown[] = []): void => {
      if (routes.get(route) !== entry) return
      try {
        entry.port.postMessage({ type: 'response', id, ...body } satisfies VideoFramePortResponseMessage, transfer)
      } catch {
        // 端口已关闭：消费方已不在。
      }
    }
    const channel = call && typeof call === 'object' && Object.hasOwn(PORT_CALL_CHANNELS, call.method) ? PORT_CALL_CHANNELS[call.method] : undefined
    if (!call || !channel) {
      reply({ error: '未知的帧通道请求' })
      return
    }
    const payload = ROUTED_CALLS.has(call.method) ? { ...call.params, route } : call.params
    try {
      const { result, transfer } = transferable(call.method, await nativeInvoke(channel, payload))
      reply({ result }, transfer)
    } catch (error) {
      reply({ error: error instanceof Error ? error.message : String(error) })
    }
  }

  return {
    connect: () => {
      const route = `vf-route-${nextRoute++}`
      const channel = new (globalThis as unknown as { MessageChannel: new () => FrameChannel }).MessageChannel()
      const entry: Route = { port: channel.port1, outstanding: new Map() }
      channel.port1.onmessage = (event) => {
        const message = event.data as { type?: unknown; frame?: unknown; token?: unknown; id?: unknown; call?: VideoFramePortCall } | null
        if (message?.type === 'request' && typeof message.id === 'number') {
          void answer(route, entry, message.id, message.call)
          return
        }
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
    openDecoder: (request) => nativeInvoke('videoFrames:openDecoder', request),
    frameAt: (request) => nativeInvoke('videoFrames:frameAt', request),
    schedule: (request) => nativeInvoke('videoFrames:schedule', request),
    cancelSchedule: (streamId, scheduleId) => nativeInvoke('videoFrames:cancelSchedule', { streamId, scheduleId }),
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
