import type { ImportSharedTextureOptions, SharedTextureImported, WebFrameMain } from 'electron'
import { z } from 'zod'
import { createMainLogger } from '../../logging'
import { encodeNtHandle, type SharedTextureApi } from '../../video-decoder/texture-bridge'
import type { VideoFrameMeta } from '../../../../../src/platform/contracts/videoFrameTypes'

const logger = createMainLogger('main.screen_recording.preview')
/** 预览画面的宽度上限与帧率上限：画面区最大也就半块 4K 屏，30 帧看得出实时，主进程每秒只转交 30 次。 */
const PREVIEW_MAX_WIDTH = 1920
const PREVIEW_FPS = 30
const SRGB: ImportSharedTextureOptions['textureInfo']['colorSpace'] = { primaries: 'bt709', transfer: 'srgb', matrix: 'rgb', range: 'full' }

const startedSchema = z.object({ format: z.literal('bgra'), codedSize: z.object({ width: z.number().int().min(2), height: z.number().int().min(2) }), slots: z.array(z.string()).min(1).max(8) }).passthrough()
/** 采集进程的 `preview` 事件：第 `slot` 张纹理刚写好。 */
export interface CapturePreviewFrame { slot: number; sequence: number; sourceUs: number }
/** 预览送到的窗口：录制会话的宿主页面。 */
export interface CapturePreviewTarget { isDestroyed(): boolean; readonly mainFrame: WebFrameMain }

interface Live {
  /** 采集进程给的句柄值（主进程里的），关的时候原样交回。 */
  slots: string[]
  handles: Buffer[]
  size: { width: number; height: number }
  /** 已导入、渲染层还没放下的槽位。采集进程不等我们，轮着写；还被占着的槽位这一张就跳过。 */
  outstanding: Set<number>
  delivered: number
  skipped: number
  sendFailures: number
}

/**
 * 原生画面采集的实时预览：采集进程把缩小的画面画进几张共享纹理（句柄复制进主进程），这里按 `preview` 事件导入那一张、
 * `sendSharedTexture` 给录制页，与解码服务给界面送帧同一条通道（preload 按 `meta.route` 投到页面的端口）。
 *
 * 预览是附带的：出任何错只停预览，绝不连累录制。复制进主进程的句柄归主进程：先 `detach` 停止导入，再要采集进程替我们关
 * （`closeClientHandles`），所以不会拿一个已经关掉、被别的对象重用的句柄值去导入。采集进程退出后这个请求由重新启动的进程执行。
 * 采集进程中途换了（续录）时按原来的请求重新开。
 */
export class CapturePreview {
  private wanted: { target: CapturePreviewTarget; route: string } | undefined
  private live: Live | undefined
  /** 每次开或关加一：开预览的应答回来时已经又开过或关过，就不认这次的句柄。 */
  private generation = 0
  constructor(private readonly deps: { request(type: string, payload: Record<string, unknown>): Promise<unknown>; sharedTexture: SharedTextureApi; sessionId(): string }) {}

  /** 开预览（或换一个通道）：返回画面尺寸。采集还没准备好时只记下请求，准备好后自动开；这台机器给不出预览时返回 null。 */
  async open(target: CapturePreviewTarget, route: string, ready: boolean): Promise<{ width: number; height: number } | null> {
    this.wanted = { target, route }
    if (!ready) return null
    try { return await this.start() } catch (error) {
      if ((error as { code?: unknown }).code !== 'CAPTURE_UNSUPPORTED') throw error
      this.wanted = undefined
      return null
    }
  }

  /** 关预览：先停止导入、关句柄，再让采集进程停止画预览。 */
  async close(): Promise<void> {
    if (!this.wanted) return
    this.wanted = undefined
    this.detach()
    // 开预览的应答可能还在路上：照样发停止，采集进程按收到的先后处理，不会留下一个没人看的预览。
    await this.deps.request('stopPreview', { sessionId: this.deps.sessionId() }).catch(error => logger.debug('停预览没有应答', { event: 'recording.preview.stop_failed', error }))
  }

  /** 录制结束：不再要预览，停止导入并关句柄。 */
  end(): void {
    this.wanted = undefined
    this.detach()
  }

  /** 采集进程那边的预览已经或马上要没了（录制结束、中断、进程退出）：不再导入它的句柄，随即关掉它们。 */
  detach(): void {
    this.generation++
    const live = this.live
    this.live = undefined
    if (!live) return
    logger.info('录制预览已停', { event: 'recording.preview.closed', context: { delivered: live.delivered, skipped: live.skipped, sendFailures: live.sendFailures } })
    this.closeHandles(live.slots)
  }

  /** 让采集进程关掉复制进主进程的句柄；渲染层还拿着的帧有 Electron 自己复制的一份，不受影响。 */
  private closeHandles(handles: readonly string[]): void {
    void this.deps.request('closeClientHandles', { clientPid: process.pid, handles }).then(
      result => { const failed = (result as { failed?: unknown[] }).failed?.length ?? 0; if (failed) logger.warn('有预览句柄没能关掉', { event: 'recording.preview.handles_close_partial', context: { failed } }) },
      // 不重试：超时、应答前进程退出时请求可能已经执行过，句柄值随即会被重用，再关一次可能误关正在用的句柄（比如录制在写的文件）。
      // 宁可留着这几张小纹理到应用退出。
      error => logger.warn('预览句柄没能确认关掉，不再重试', { event: 'recording.preview.handles_close_failed', error, context: { count: handles.length } }),
    )
  }

  /** 采集进程换了一个新的录制会话（续录）：原来开着预览就重新开。 */
  resume(): void {
    if (this.wanted) void this.start().catch(error => logger.warn('续录后没能重新开预览', { event: 'recording.preview.resume_failed', error }))
  }

  private async start(): Promise<{ width: number; height: number } | null> {
    this.detach()
    const generation = this.generation
    const reply = startedSchema.parse(await this.deps.request('startPreview', { sessionId: this.deps.sessionId(), clientPid: process.pid, maxWidth: PREVIEW_MAX_WIDTH, fps: PREVIEW_FPS }))
    // 应答回来时已经又开过或关过：这批句柄不用，照样关掉。
    if (generation !== this.generation || !this.wanted) { this.closeHandles(reply.slots); return null }
    this.live = { slots: reply.slots, handles: reply.slots.map(encodeNtHandle), size: reply.codedSize, outstanding: new Set(), delivered: 0, skipped: 0, sendFailures: 0 }
    logger.info('录制预览已开', { event: 'recording.preview.opened', context: { ...reply.codedSize, slots: reply.slots.length } })
    return reply.codedSize
  }

  /** 一张预览画好了：导入并送给录制页。 */
  frame(event: CapturePreviewFrame): void {
    const live = this.live, wanted = this.wanted
    if (!live || !wanted) return
    if (wanted.target.isDestroyed()) { void this.close(); return }
    const handle = live.handles[event.slot]
    if (!handle || live.outstanding.has(event.slot)) { live.skipped++; return }
    let imported: SharedTextureImported
    try {
      imported = this.deps.sharedTexture.importSharedTexture({
        textureInfo: { pixelFormat: 'bgra', codedSize: live.size, visibleRect: { x: 0, y: 0, ...live.size }, timestamp: event.sourceUs, colorSpace: SRGB, handle: { ntHandle: handle } },
        allReferencesReleased: () => live.outstanding.delete(event.slot),
      })
    } catch (error) {
      logger.warn('预览纹理导入失败，停掉预览，录制不受影响', { event: 'recording.preview.import_failed', error })
      void this.close()
      return
    }
    live.outstanding.add(event.slot)
    const meta: VideoFrameMeta = { route: wanted.route, streamId: 'capture-preview', frameIndex: event.sequence, timestampUs: event.sourceUs }
    let sending: Promise<void>
    try { sending = this.deps.sharedTexture.sendSharedTexture({ frame: wanted.target.mainFrame, importedSharedTexture: imported }, meta) } catch (error) { sending = Promise.reject(error) }
    sending.then(() => { live.delivered++ }, (error: unknown) => {
      // 页面忙或刚导航：这一张没送到，下一张照送。
      if (live.sendFailures++ === 0) logger.warn('预览画面没能送到录制页', { event: 'recording.preview.send_failed', error })
    }).finally(() => imported.release())
  }
}
