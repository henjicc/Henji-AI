import { app } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { createMainLogger } from '../../logging'
import { NativeProcessClient, type NativeProcessLoss } from '../../native-process/client'
import { NativeFrameReader, NativeProcessError, nativeErrorSchema } from '../../native-process/protocol'

const logger = createMainLogger('main.screen_recording.native_process')
export class ScreenCaptureError extends NativeProcessError {}
/**
 * 与 native/screen-capture 的协议号一致；不配套时握手就失败（原生回 PROTOCOL_MISMATCH），不在录制中途才出错。
 * 协议 2：显示器断开不再结束录制，改发 sourceLost / sourceRestored；另有 sourceChanged、代理与预览（这里没用到）。
 */
export const SCREEN_CAPTURE_PROTOCOL = 2

const messageSchema = z.object({
  id: z.string().optional(), ok: z.boolean().optional(), result: z.unknown().optional(), error: nativeErrorSchema.optional(),
  event: z.string().optional(), binaryBytes: z.number().int().min(0).max(0).default(0),
}).passthrough()
type ScreenCaptureMessage = z.infer<typeof messageSchema>
const count = z.number().int().nonnegative()
const filesSchema = z.object({ video: z.string(), timing: z.string(), activity: z.string(), manifest: z.string() }).passthrough()
export const screenCapturePreparedSchema = z.object({ sessionId: z.string(), width: count, height: count, fps: z.number().positive(), codec: z.enum(['h264', 'hevc']), encoder: z.string(), proxy: z.object({ width: count, height: count }).nullable().optional(), files: filesSchema }).passthrough()
/** 停止的结果：`frames` 是时刻表条数，也是文件时间轴的长度；一帧都没录到时为 0 且不留文件。 */
export const screenCaptureResultSchema = z.object({
  frames: count, encodedFrames: count, durationUs: z.number(), originUs: z.number(), freshFrames: count, repeatedFrames: count, droppedFrames: count,
  captureDropped: count, bytes: count, durableFrames: count, proxyFrames: count.optional(), files: filesSchema,
}).passthrough()
export type ScreenCaptureResult = z.infer<typeof screenCaptureResultSchema>
const sessionEvent = { sessionId: z.string() }
const eventSchema = z.discriminatedUnion('event', [
  z.object({ event: z.literal('started'), ...sessionEvent, originUs: z.number(), firstSourceUs: z.number() }).passthrough(),
  z.object({ event: z.literal('fragment'), ...sessionEvent, frames: count, bytes: count }).passthrough(),
  z.object({ event: z.literal('paused'), ...sessionEvent, atUs: z.number(), cell: count, frame: count, reason: z.enum(['user', 'sourceLost']).optional() }).passthrough(),
  z.object({ event: z.literal('resumed'), ...sessionEvent, atUs: z.number(), cell: count, frame: count }).passthrough(),
  z.object({ event: z.literal('interrupted'), ...sessionEvent, error: nativeErrorSchema }).passthrough(),
  z.object({ event: z.literal('sourceLost'), ...sessionEvent, atUs: z.number() }).passthrough(),
  z.object({ event: z.literal('sourceRestored'), ...sessionEvent, atUs: z.number() }).passthrough(),
  z.object({ event: z.literal('sourceChanged'), ...sessionEvent, atUs: z.number(), width: count, height: count, frame: count }).passthrough(),
  z.object({ event: z.literal('health'), ...sessionEvent, frames: count, droppedFrames: count, repeatedFrames: count, captureDropped: count }).passthrough(),
])
/** 采集进程的事件；时刻（`atUs`、`originUs`）仍是采集进程的时钟，用 `toMainUs` 换算。 */
export type ScreenCaptureEvent = z.infer<typeof eventSchema>

export function screenCaptureExecutablePath(): string {
  const name = 'henji-screen-capture.exe'
  // 与视频解码服务同放在 video-decoder 目录，共用同一份 FFmpeg 动态库；开发时构建脚本在产物旁放了一份。
  const executable = app.isPackaged ? path.join(process.resourcesPath, 'resources', 'video-decoder', name) : path.join(process.cwd(), 'native/screen-capture/target/release', name)
  if (!existsSync(executable)) throw new ScreenCaptureError('ENGINE_MISSING', '原生画面采集程序缺失')
  return executable
}

/** 原生画面采集进程（native/screen-capture）的客户端：一次只有一个录制，事件按会话号分给订阅者。 */
export class ScreenCaptureClient extends NativeProcessClient<ScreenCaptureMessage> {
  private readonly listeners = new Map<string, (event: ScreenCaptureEvent) => void>()
  private readonly lostListeners = new Set<(loss: NativeProcessLoss) => void>()
  constructor(executable: () => string, private readonly onLost: (loss: NativeProcessLoss) => void = () => undefined) {
    super({
      label: '原生画面采集服务', event: 'screen_capture', logger, protocol: SCREEN_CAPTURE_PROTOCOL, hello: { protocol: SCREEN_CAPTURE_PROTOCOL },
      versionMismatch: '画面采集组件与应用版本不一致，请重新安装痕迹AI；开发环境请运行 node scripts/build-screen-capture.cjs 重新构建。',
      texts: { closed: '画面采集服务已关闭', unavailable: '画面采集服务连续异常', notStarted: '画面采集服务未启动', exited: '画面采集服务已退出，已写文件保留', timeout: '画面采集服务响应超时；已录文件保留', closing: '画面采集服务正在关闭，已写文件保留' },
      losses: { exited: { code: 'PROCESS_EXITED', message: '画面采集服务异常退出，已录部分保留，可以导入' }, notResponding: { code: 'NOT_RESPONDING', message: '画面采集服务没有应答，录制已结束；已录部分保留，可以导入' } },
      // 停止要排空编码器、写好结尾；原生自己最多等 100 秒。
      timeouts: { stop: 120_000, prepare: 10_000, start: 10_000 },
      reader: () => new NativeFrameReader(messageSchema, '画面采集服务'), error: (code, message) => new ScreenCaptureError(code, message),
    }, executable, loss => { for (const listener of [...this.lostListeners]) listener(loss); this.onLost(loss) })
  }
  /** 订阅一次录制的事件与进程失联；返回取消订阅。 */
  subscribe(sessionId: string, listener: (event: ScreenCaptureEvent) => void, lost: (loss: NativeProcessLoss) => void): () => void {
    this.listeners.set(sessionId, listener); this.lostListeners.add(lost)
    return () => { if (this.listeners.get(sessionId) === listener) this.listeners.delete(sessionId); this.lostListeners.delete(lost) }
  }
  toMainUs(nativeUs: number): number { return Math.round(nativeUs + this.clock.offsetUs) }
  toNativeUs(mainUs: number): number { return Math.round(mainUs - this.clock.offsetUs) }
  protected event(message: ScreenCaptureMessage): void {
    const parsed = eventSchema.safeParse(message)
    // 以后的版本可能加事件：不认识的只记日志，不当协议错误断开正在录的进程。
    if (!parsed.success) { logger.debug('未识别的画面采集事件', { event: 'screen_capture.event.unknown', context: { name: message.event ?? '' } }); return }
    this.listeners.get(parsed.data.sessionId)?.(parsed.data)
  }
}

let shared: ScreenCaptureClient | undefined
export function screenCaptureProcess(): ScreenCaptureClient { return shared ??= new ScreenCaptureClient(screenCaptureExecutablePath) }
/** 应用退出：正在录的由录制收尾先停下（文件收尾），这里关掉进程。 */
export async function disposeScreenCaptureProcess(): Promise<void> { const client = shared; shared = undefined; await client?.dispose() }
