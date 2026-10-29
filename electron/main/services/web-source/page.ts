import crypto from 'node:crypto'
import { BrowserWindow, session as electronSession, sharedTexture, type OffscreenSharedTexture, type Session } from 'electron'
import type { CodeWebView } from '../../../../src/core/videoEdit/codeMaterial/webSource'
import type { VideoFrameMeta, WebSourceBox } from '../../../../src/platform/contracts/videoFrameTypes'
import type { MainLogger } from '../logging/main-logger'
import type { VideoFrameTarget } from '../video-decoder'
import { serveWebSourceFile, WEB_SOURCE_ORIGIN, webSourceEntryUrl, type WebSourceFolder } from './site'

const LOAD_TIMEOUT_MS = 30_000
/** 页面出现 `window.henjiWeb` 并就绪（资源、字体）的时限。 */
const READY_TIMEOUT_MS = 30_000
const SEEK_TIMEOUT_MS = 30_000
/** 标记帧的画面通常几毫秒内到达；超过这么久仍没有任何新画面算取帧失败。 */
const PAINT_TIMEOUT_MS = 3_000
/**
 * 标记的损坏区会被上层的 backdrop-filter、filter 扩大成一大块，认不出“只含标记”的那一幅时：页面停住后标记帧就是最后一幅，
 * 画面停下这么久（约五个画面周期）没有新的就取最新一幅盖住标记的。
 */
const MARK_QUIET_MS = 20
/** 过了这么久画面仍在不停变化（页面没按约定停住），取最新一幅盖住标记的画面并记一次警告。 */
const MARK_BUSY_MS = 300
/** 页面帧率上限：seek 后等的几帧与标记帧都按它推进，越高取帧越快；页面停住时不会白白绘制。 */
const FRAME_RATE = 240
/** 浏览器借出的共享纹理池很小，只留最新几幅。 */
const HELD_PAINTS = 3

const READY_SCRIPT = `(async () => {
  const started = performance.now()
  while (!window.henjiWeb) {
    if (performance.now() - started > ${READY_TIMEOUT_MS - 1000}) throw new Error('页面没有提供 window.henjiWeb')
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  await window.henjiWeb.ready
  if (document.fonts) await document.fonts.ready
  const duration = Number(window.henjiWeb.duration)
  return Number.isFinite(duration) && duration >= 0 ? duration : null
})()`

/**
 * 摆到第 t 秒，等三帧再读元素矩形。等三帧的依据（Electron 44 离屏页面实测）：改动后只等两帧，约三分之一的取帧
 * 还是上一刻的画面；三帧时数百次随机跳转全部正确。页面没实现 boxes 时按选择器直接量元素。
 */
function seekScript(time: number, selectors: readonly string[] | undefined): string {
  return `(async () => {
    const page = window.henjiWeb
    await page.seek(${JSON.stringify(time)})
    for (let i = 0; i < 3; i++) await new Promise(resolve => requestAnimationFrame(resolve))
    const selectors = ${JSON.stringify(selectors ?? null)}
    if (!selectors) return null
    if (typeof page.boxes === 'function') return await page.boxes(selectors)
    const boxes = {}
    for (const selector of selectors) {
      let element = null
      try { element = document.querySelector(selector) } catch {}
      const rect = element && element.getBoundingClientRect()
      boxes[selector] = rect ? [rect.x, rect.y, rect.width, rect.height] : null
    }
    return boxes
  })()`
}

/**
 * 标记帧：取景左上角一个 1×1 的透明画布清一次。像素不变，但这一帧带着只有这一点的损坏区，
 * 共享纹理的 paint 按损坏区出画面（`invalidate()` 在共享纹理模式下给不出纹理），据此认出 seek 之后的那一幅。
 */
function markScript(region: CodeWebView['region']): string {
  return `(async () => {
    let mark = window.__henjiWebSourceMark
    if (!mark || !mark.isConnected) {
      mark = document.createElement('canvas'); mark.width = 1; mark.height = 1; mark.setAttribute('aria-hidden', 'true')
      document.documentElement.appendChild(mark); window.__henjiWebSourceMark = mark
    }
    mark.style.cssText = 'all:initial!important;display:block!important;position:fixed!important;left:${region[0]}px!important;top:${region[1]}px!important;width:1px!important;height:1px!important;pointer-events:none!important;z-index:2147483647!important'
    mark.getContext('2d').clearRect(0, 0, 1, 1)
    for (let i = 0; i < 2; i++) await new Promise(resolve => requestAnimationFrame(resolve))
    return true
  })()`
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(value => { clearTimeout(timer); resolve(value) }, error => { clearTimeout(timer); reject(error) })
  })
}

/** 页面给的矩形只收 [x, y, w, h] 四个有限数或 null；缺的选择器按 null。 */
function webSourceBoxes(value: unknown, selectors: readonly string[]): Record<string, WebSourceBox> {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  return Object.fromEntries(selectors.map(selector => {
    const box = Object.hasOwn(record, selector) ? record[selector] : null
    return [selector, Array.isArray(box) && box.length === 4 && box.every(item => typeof item === 'number' && Number.isFinite(item)) ? [box[0], box[1], box[2], box[3]] as [number, number, number, number] : null]
  }))
}

type UpdateRect = { x: number; y: number; width: number; height: number } | null | undefined
function updateRect(texture: OffscreenSharedTexture): UpdateRect {
  return (texture.textureInfo as { metadata?: { captureUpdateRect?: UpdateRect } }).metadata?.captureUpdateRect
}

/**
 * 一个网页来源的离屏页面：独立的内存分区，沙箱、隔离、不挂任何 preload，页面拿不到痕迹的接口；站点只从网页文件夹提供，
 * 其他地址照常联网（本机项目里的网页属于本机创作）。宿主只经 `window.henjiWeb` 控制时间，取帧串行。
 */
export class WebSourcePage {
  private window?: BrowserWindow
  private session?: Session
  private readonly paints: Array<{ seq: number; texture: OffscreenSharedTexture }> = []
  private seq = 0
  private lastPaintAt = 0
  private untextured = 0
  private wake?: () => void
  private tail: Promise<unknown> = Promise.resolve()
  private frameIndex = 0
  private failure?: Error
  private notStaticLogged = false
  private closed = false
  duration: number | null = null

  constructor(
    readonly streamId: string,
    readonly target: VideoFrameTarget,
    readonly route: string,
    readonly folder: WebSourceFolder,
    readonly view: CodeWebView,
    public contentHash: string,
    private readonly logger: Pick<MainLogger, 'info' | 'warn'>,
  ) {}

  get pixelWidth(): number { return Math.round(this.view.region[2] * this.view.scale) }
  get pixelHeight(): number { return Math.round(this.view.region[3] * this.view.scale) }

  async open(): Promise<void> {
    const partition = `web-source-${crypto.randomUUID()}`
    const ses = electronSession.fromPartition(partition)
    this.session = ses
    ses.protocol.handle('https', request => new URL(request.url).origin === WEB_SOURCE_ORIGIN ? serveWebSourceFile(this.folder.root, request) : ses.fetch(request, { bypassCustomProtocolHandlers: true }))
    // 离屏页面只用来出画面，没有人能回应摄像头、麦克风、通知之类的授权请求。
    ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    const { region, scale } = this.view
    const window = new BrowserWindow({
      show: false, focusable: false, skipTaskbar: true, frame: false, width: region[2], height: region[3], useContentSize: true,
      webPreferences: { partition, contextIsolation: true, sandbox: true, nodeIntegration: false, offscreen: { useSharedTexture: true, deviceScaleFactor: scale }, backgroundThrottling: false, spellcheck: false },
    })
    this.window = window
    const contents = window.webContents
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', (event, url) => { if (new URL(url).origin !== WEB_SOURCE_ORIGIN) event.preventDefault() })
    contents.on('render-process-gone', (_event, details) => {
      this.failure = new Error(`网页页面进程已退出（${details.reason}）`)
      this.logger.warn('网页来源页面进程退出', { event: 'web_source.page.gone', context: { streamId: this.streamId, reason: details.reason } })
      this.wake?.()
    })
    contents.on('paint', event => {
      // 位图路径或还没有尺寸的 paint 不带纹理；纹理必须尽快还给浏览器的小池子。
      const texture = event.texture ?? null
      if (!texture) { this.untextured++; return }
      const size = texture.textureInfo.codedSize
      if (this.closed || !size.width || !size.height) { texture.release(); return }
      this.paints.push({ seq: ++this.seq, texture })
      this.lastPaintAt = Date.now()
      while (this.paints.length > HELD_PAINTS) this.paints.shift()!.texture.release()
      this.wake?.()
    })
    contents.setFrameRate(FRAME_RATE)
    await withTimeout(contents.loadURL('about:blank'), LOAD_TIMEOUT_MS, '网页来源页面启动超时')
    contents.debugger.attach('1.3')
    // 布局视口固定为整个视口，只把取景这一块按倍率画进窗口（页面感知不到）。离屏页面的设备像素比下，
    // 取景原点要按设备像素给（实测：按 CSS 像素给时原点落在 x/scale 处），宽高仍是 CSS 像素。
    await withTimeout(contents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
      width: this.view.width, height: this.view.height, deviceScaleFactor: scale, mobile: false,
      viewport: { x: region[0] * scale, y: region[1] * scale, width: region[2], height: region[3], scale: 1 },
    }), LOAD_TIMEOUT_MS, '网页来源页面没有响应视口设置')
    await this.load()
  }

  private async load(): Promise<void> {
    const contents = this.window!.webContents
    await withTimeout(contents.loadURL(webSourceEntryUrl(this.folder)), LOAD_TIMEOUT_MS, '网页加载超时')
    this.duration = await withTimeout(contents.executeJavaScript(READY_SCRIPT, true) as Promise<number | null>, READY_TIMEOUT_MS, '网页没有在 30 秒内就绪（window.henjiWeb.ready）')
  }

  /** 网页文件改了：重新载入（排在进行中的取帧之后），之后的画面用新内容。 */
  reload(contentHash: string): Promise<void> {
    const run = this.tail.catch(() => undefined).then(async () => {
      if (this.closed) return
      this.contentHash = contentHash
      try {
        await this.load()
        this.failure = undefined
        this.logger.info('网页来源已按新内容重新载入', { event: 'web_source.page.reloaded', context: { streamId: this.streamId, contentHash } })
      } catch (error) {
        this.failure = error instanceof Error ? error : new Error(String(error))
        this.logger.warn('网页来源重新载入失败', { event: 'web_source.page.reload_failed', error, context: { streamId: this.streamId } })
      }
    })
    this.tail = run
    return run
  }

  /** 取第 `time` 秒的画面：经帧通道送到发起的通道（带 `ticket`），返回元素矩形。 */
  capture(time: number, ticket: string, selectors: readonly string[] | undefined): Promise<Record<string, WebSourceBox> | null> {
    const run = this.tail.catch(() => undefined).then(() => this.captureNow(time, ticket, selectors))
    this.tail = run
    return run
  }

  private async captureNow(time: number, ticket: string, selectors: readonly string[] | undefined): Promise<Record<string, WebSourceBox> | null> {
    if (this.closed) throw new Error('网页来源已关闭')
    if (this.failure) throw this.failure
    const contents = this.window!.webContents
    let boxes: unknown
    try {
      boxes = await withTimeout(contents.executeJavaScript(seekScript(time, selectors), true), SEEK_TIMEOUT_MS, `网页 seek(${time}) 超过 ${SEEK_TIMEOUT_MS / 1000} 秒没有完成`)
    } catch (error) {
      this.logger.warn('网页 seek 失败', { event: 'web_source.seek.failed', error, context: { streamId: this.streamId, time } })
      throw error
    }
    const mark = this.seq
    await withTimeout(contents.executeJavaScript(markScript(this.view.region), true), SEEK_TIMEOUT_MS, '网页没有响应取帧标记')
    const texture = await this.markedPaint(mark, time)
    await this.deliver(texture, time, ticket)
    return selectors ? webSourceBoxes(boxes, selectors) : null
  }

  /**
   * 标记之后的那一幅（`mark` 是发出标记前的 paint 序号）。只含标记的一幅最先认出；损坏区被上层滤镜扩大时，
   * 页面停住后标记帧就是最后一幅，画面安静 `MARK_QUIET_MS` 后取最新一幅盖住标记的；一直不安静（页面没停住）
   * 到 `MARK_BUSY_MS` 时也取最新一幅并记一次警告。
   */
  private async markedPaint(mark: number, time: number): Promise<OffscreenSharedTexture> {
    const started = Date.now()
    const side = Math.ceil(this.view.scale) + 2
    const onlyMark = (rect: UpdateRect): boolean => !!rect && rect.x <= 1 && rect.y <= 1 && rect.x + rect.width >= 1 && rect.y + rect.height >= 1 && rect.width <= side && rect.height <= side
    const coversMark = (rect: UpdateRect): boolean => !rect || rect.x <= 0 && rect.y <= 0 && rect.x + rect.width >= 1 && rect.y + rect.height >= 1
    for (;;) {
      if (this.closed) throw new Error('网页来源已关闭')
      if (this.failure) throw this.failure
      const now = Date.now(), elapsed = now - started
      const after = this.paints.filter(paint => paint.seq > mark)
      const exact = after.find(paint => onlyMark(updateRect(paint.texture)))
      const latest = after.filter(paint => coversMark(updateRect(paint.texture))).at(-1)
      const quiet = now - this.lastPaintAt >= MARK_QUIET_MS, busy = elapsed >= MARK_BUSY_MS
      const chosen = exact ?? (latest && (quiet || busy) ? latest : undefined)
      if (chosen) {
        for (const paint of this.paints.splice(0, this.paints.indexOf(chosen) + 1)) if (paint !== chosen) paint.texture.release()
        if (!exact && !quiet && !this.notStaticLogged) {
          this.notStaticLogged = true
          this.logger.warn('网页在 seek 之后仍有变化，取帧按最新画面', { event: 'web_source.capture.not_static', context: { streamId: this.streamId, time } })
        }
        return chosen.texture
      }
      if (elapsed >= PAINT_TIMEOUT_MS) {
        const reason = this.untextured && !this.seq ? '这台机器的离屏共享纹理不可用' : '页面没有画出新画面'
        this.logger.warn('网页取帧超时', { event: 'web_source.capture.timeout', context: { streamId: this.streamId, time, paints: this.seq, untextured: this.untextured } })
        throw new Error(`网页取帧超时：${reason}`)
      }
      const until = latest ? Math.min(this.lastPaintAt + MARK_QUIET_MS - now, MARK_BUSY_MS - elapsed) : PAINT_TIMEOUT_MS - elapsed
      await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, Math.max(1, until))
        this.wake = () => { clearTimeout(timer); resolve() }
      })
      this.wake = undefined
    }
  }

  /** 送到发起窗口的主 frame；纹理在全部引用释放后（渲染层关掉帧）才还给浏览器。 */
  private async deliver(texture: OffscreenSharedTexture, time: number, ticket: string): Promise<void> {
    if (this.target.isDestroyed()) { texture.release(); throw new Error('目标窗口已关闭') }
    const meta: VideoFrameMeta = { route: this.route, streamId: this.streamId, frameIndex: this.frameIndex++, timestampUs: Math.round(time * 1e6), request: { kind: 'frame_at', id: ticket } }
    let imported: ReturnType<typeof sharedTexture.importSharedTexture>
    try {
      imported = sharedTexture.importSharedTexture({ textureInfo: texture.textureInfo as unknown as Parameters<typeof sharedTexture.importSharedTexture>[0]['textureInfo'], allReferencesReleased: () => texture.release() })
    } catch (error) {
      texture.release()
      this.logger.warn('网页画面导入共享纹理失败', { event: 'web_source.capture.import_failed', error, context: { streamId: this.streamId } })
      throw new Error(`网页画面导入共享纹理失败：${error instanceof Error ? error.message : String(error)}`)
    }
    try {
      await sharedTexture.sendSharedTexture({ frame: this.target.mainFrame, importedSharedTexture: imported }, meta)
    } catch (error) {
      this.logger.warn('网页画面送达渲染进程失败', { event: 'web_source.capture.send_failed', error, context: { streamId: this.streamId } })
      throw error
    } finally {
      imported.release()
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.wake?.()
    for (const paint of this.paints.splice(0)) paint.texture.release()
    if (this.window && !this.window.isDestroyed()) this.window.destroy()
    this.session?.protocol.unhandle('https')
    void this.session?.clearStorageData().catch(() => undefined)
  }
}
