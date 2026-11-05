import crypto from 'node:crypto'
import { BrowserWindow, sharedTexture, type OffscreenSharedTexture } from 'electron'
import { codeWebLayerCss, codeWebPixelSize, type CodeWebView } from '../../../../src/core/videoEdit/codeMaterial/webSource'
import type { VideoFrameMeta, WebSourceBox, WebSourceCaptureRequest } from '../../../../src/platform/contracts/videoFrameTypes'
import type { VideoFrameTarget } from '../video-decoder'
import { webSourceSession } from './session'
import { GpuFrameCapture } from '../web-replay/player/gpuCapture'
import type { TakenFrame } from '../web-replay/player/frameSource'
import { waitWebCacheTask, type WebCacheSubmissions } from './submissions'
import { unavailableWebText, WEB_TEXT_SAMPLER_VERSION, type WebTextCapture } from '../../../../src/core/videoEdit/webTextGeometry'
import { WebTextCaptureError, TEXT_GEOMETRY_PREPARE_SCRIPT, textGeometryPaintSetup, validateWebTextResults } from './textGeometry'
import { WEB_SOURCE_ENTRY_URL, WEB_SOURCE_ORIGIN, type WebSourceFolder } from './site'
import { WebSnapshotFrames, WebSnapshotMiss, WebSnapshotUnsupported } from './snapshotFrames'
import { createMainLogger } from '../logging/main-logger'

const LOAD_TIMEOUT_MS = 30_000
/** 页面出现 `window.henjiWeb` 并就绪（资源、字体）的时限。 */
const READY_TIMEOUT_MS = 30_000
const SEEK_TIMEOUT_MS = 30_000
/** 载入失败后隔这么久，下一次取帧再试载入；这之间的取帧直接报上一次的错。 */
const RELOAD_RETRY_MS = 2_000
/** 标记帧的画面通常几毫秒内到达；超过这么久仍没有任何新画面算取帧失败。 */
const PAINT_TIMEOUT_MS = 3_000
/** 页面换绘制链路或挪动取景后，先接完仍在传输的画面；这段等待只用于准备、降级与文档滚动，不进入普通的逐帧取图。 */
const PREPARE_QUIET_MS = 100
const PREPARE_BUSY_MS = 500
/**
 * 标记的损坏区会被上层的 backdrop-filter、filter 扩大成一大块，认不出“只含标记”的那一幅时：页面停住后标记帧就是最后一幅，
 * 画面停下这么久（约五个画面周期）没有新的就取最新一幅盖住标记的。
 */
const MARK_QUIET_MS = 20
/** 过了这么久画面仍在不停变化（页面没按约定停住），取最新一幅盖住标记的画面。 */
const MARK_BUSY_MS = 300
/** 取帧结束这么久以后还有新画面，就是页面在自己动，不是取帧的余波。 */
const IDLE_PAINT_GRACE_MS = 100
/** 恢复绘制重发上一幅通常十几毫秒送到；等到它再动页面。 */
const RESEND_WAIT_MS = 50
/** 一轮跟随最多等 500 毫秒，跟这么多轮还在滚就按没停住的页面取帧。 */
const SCROLL_FOLLOW_ROUNDS = 8
/** 快照的显示列表按视口裁剪，文档滚走后舞台内容不再录制，画出来只剩固定定位的元素。 */
const DOCUMENT_SCROLL_REASON = '网页文档滚动需要普通绘制'
/** 页面帧率上限：seek 后等的几帧与标记帧都按它推进，越高取帧越快。 */
const FRAME_RATE = 240
/** 浏览器借出的共享纹理池很小，取帧过程中只留最新几幅。 */
const HELD_PAINTS = 3
/** 宿主自己的等帧、量元素与标记脚本跑在隔离世界：和页面共用 DOM，但页面看不到宿主的变量，宿主也不受页面改写全局的影响。 */
const HOST_WORLD = 1001

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

/** 文字几何只取每个选择器的第一个元素，样式却命中全部：命中多个时其余的字会从两层都消失。写错的选择器也在这里报出来。 */
function layerSelectorCheckScript(layer: NonNullable<CodeWebView['layer']>): string {
  return `(() => {
    for (const selector of ${JSON.stringify(layer.only ?? layer.hide)}) {
      let count
      try { count = document.querySelectorAll(selector).length } catch { return '网页 layer 的选择器写错了：' + selector }
      if (count > 1) return '网页 layer 的选择器要只命中一个元素：' + selector + ' 命中了 ' + count + ' 个'
    }
    // 页面写了 transition 时，刚注入的样式会慢慢过渡过去，这期间的画面不是拆好的层。
    for (const animation of document.getAnimations()) if (animation instanceof CSSTransition) animation.finish()
    return null
  })()`
}

/** 隔离世界保存资源与还原操作，准备失败和运行中降级都恢复普通页面绘制。 */
function snapshotPrepareScript(view: CodeWebView, frameToken?: string): string {
  const size = codeWebPixelSize(view)
  return `(async () => {
    let stage = document.querySelector('[data-henji-stage]')
    const checkTopLayer = () => {
      if (document.fullscreenElement || document.querySelector(':modal, :popover-open')) throw new Error('网页顶层元素需要普通绘制')
    }
    try { checkTopLayer() } catch (error) { return { captureMode: 'compositor', fallbackReason: String(error) } }
    // 文档滚动依赖 body 的流内高度；不能用固定快照容器改变它的滚动范围。
    if (!stage && (window.scrollX || window.scrollY || document.documentElement.scrollHeight > window.innerHeight || document.documentElement.scrollWidth > window.innerWidth ||
        bodyScrollable())) return { captureMode: 'compositor', fallbackReason: 'automatic-stage-document-scroll' }
    function bodyScrollable() {
      const body = document.body, style = getComputedStyle(body)
      return /auto|scroll/.test(style.overflowY) && body.scrollHeight > body.clientHeight || /auto|scroll/.test(style.overflowX) && body.scrollWidth > body.clientWidth
    }
    if (typeof HTMLCanvasElement.prototype.requestPaint !== 'function' || !navigator.gpu ||
        typeof GPUQueue === 'undefined' || typeof Element.prototype.moveBefore !== 'function')
      return { captureMode: 'compositor', fallbackReason: 'missing-html-in-canvas' }
    const copy = GPUQueue.prototype.copyElementImageToTexture
    const draw = GPUQueue.prototype.drawElementImageToTexture
    if (typeof copy !== 'function') return { captureMode: 'compositor', fallbackReason: typeof draw === 'function' ? 'unsupported-draw-element-dictionary' : 'missing-element-image-to-texture' }
    const container = document.createElement('canvas'), output = document.createElement('canvas')
    ${frameToken ? `container.setAttribute('data-henji-frame-active', ${JSON.stringify(frameToken)})` : ''}
    let isolation, priority, automatic
    const body = document.body
    let device, disposed = false, pageChanged = false
    const state = { dispose() {
      disposed = true
      state.cancel?.()
      automatic?.observer.disconnect()
      // innerHTML 会把宿主标签重新解析，嵌套 body 的属性也可能合并进真 body；只能从源页面恢复。
      state.reloadRequired = !!automatic && !stage.isConnected && (!container.hasAttribute('data-henji-body-replaced') || !!document.querySelector('henji-web-stage, canvas[layoutsubtree], canvas[content="drawable"]'))
      const parent = container.parentNode
      if (parent) while (container.firstChild) parent.moveBefore(container.firstChild, container)
      if (stage) {
        if (isolation) stage.style.setProperty('isolation', isolation, priority); else stage.style.removeProperty('isolation')
      }
      if (automatic && stage.isConnected && document.body === body) {
        // 页面主动删除的分支属于页面的新状态，不能在降级时重新挂回。
        while (automatic.content.firstChild) body.moveBefore(automatic.content.firstChild, stage.parentNode === body ? stage : null)
        stage.remove()
      }
      output.remove(); container.remove(); device?.destroy()
      delete window.__henjiWebSourceSnapshot
      return pageChanged
    } }
    window.__henjiWebSourceSnapshot = state
    try {
      const adapter = await navigator.gpu.requestAdapter()
      if (disposed) throw new Error('网页快照准备已停止')
      if (!adapter) throw new Error('WebGPU adapter 不可用')
      device = await adapter.requestDevice()
      device.lost.then(info => {
        state.lostReason = '显卡设备丢失：' + (info.message || info.reason)
        state.cancel?.(new Error(state.lostReason))
      })
      if (disposed) throw new Error('网页快照准备已停止')
      container.setAttribute('layoutsubtree', ''); container.setAttribute('content', 'drawable')
      container.width = ${view.width}; container.height = ${view.height}
      container.style.cssText = 'all:unset!important;display:block!important;position:absolute!important;left:0!important;top:0!important;width:${view.width}px!important;height:${view.height}px!important;pointer-events:none!important'
      if (!container.getContext('2d')) throw new Error('舞台画布的 2D 上下文不可用')
      if (!stage) {
        stage = document.createElement('henji-web-stage')
        stage.style.cssText = 'all:unset!important;display:block!important;position:absolute!important;left:0!important;top:0!important;width:${view.width}px!important;height:${view.height}px!important;overflow:hidden!important'
        // body 的 margin、flex/grid 与直接子选择器由内容层承接；舞台本身始终是视口盒。
        // body 的 onresize/onscroll 等属性实际控制 window 处理器，不能在内容层上再次设置。
        const content = document.createElement('body')
        const visualKeys = ['color', 'background-color', 'font-family', 'font-size', 'font-weight', 'line-height', 'visibility', 'display']
        const layout = [...body.querySelectorAll('*')].filter(element => !element.getAnimations().some(animation => animation.playState === 'running')).map(element => {
          const style = getComputedStyle(element)
          return { element, rect: element.getBoundingClientRect(), visual: visualKeys.map(key => style.getPropertyValue(key)) }
        })
        const syncBackground = () => {
          const bodyStyle = getComputedStyle(body), rootStyle = getComputedStyle(document.documentElement)
          const propagated = rootStyle.backgroundColor === 'rgba(0, 0, 0, 0)' && rootStyle.backgroundImage === 'none'
          const background = propagated ? bodyStyle : rootStyle
          // 根背景以根盒而非视口定位，系统暗色画布也不能用固定白底模拟。
          if (background.backgroundImage !== 'none' || background.backgroundColor === 'rgba(0, 0, 0, 0)' && /dark/.test(rootStyle.colorScheme + ' ' + bodyStyle.colorScheme))
            throw new Error('网页画布背景需要普通绘制')
          for (const key of ['background-color', 'background-image', 'background-position', 'background-size', 'background-repeat', 'background-origin', 'background-clip', 'background-attachment'])
            stage.style.setProperty(key, background.getPropertyValue(key), 'important')
          if (background.backgroundColor === 'rgba(0, 0, 0, 0)') stage.style.setProperty('background-color', 'white', 'important')
          // body 背景传播到视口时只画一次，避免带 margin 的内容层重复铺图。
          if (propagated) content.style.setProperty('background', 'transparent', 'important')
        }
        syncBackground()
        body.appendChild(stage); stage.appendChild(content); pageChanged = true
        const moveContents = () => {
          if (!stage.isConnected || content.parentNode !== stage || document.body !== body) throw new Error('网页自动舞台已被替换或移除')
          const anchor = content.firstChild
          let before = true
          for (const node of [...body.childNodes]) {
            if (node === stage || node === container) { before = false; continue }
            content.moveBefore(node, before ? anchor : null)
          }
          for (const attribute of [...content.attributes]) if (!body.hasAttribute(attribute.name)) content.removeAttribute(attribute.name)
          for (const attribute of body.attributes) if (!/^on/i.test(attribute.name) && content.getAttribute(attribute.name) !== attribute.value) content.setAttribute(attribute.name, attribute.value)
          // 相对字号、字重和行高只按原 body 计算一次，不能在嵌套内容层再次继承放大。
          const bodyStyle = getComputedStyle(body)
          for (const key of ['font-size', 'font-weight', 'line-height']) content.style.setProperty(key, bodyStyle.getPropertyValue(key), 'important')
          syncBackground()
          const rect = content.getBoundingClientRect()
          if (rect.top + Math.max(rect.height, content.scrollHeight) + parseFloat(bodyStyle.marginBottom) > ${view.height} ||
              rect.left + Math.max(rect.width, content.scrollWidth) + parseFloat(bodyStyle.marginRight) > ${view.width})
            throw new Error('网页自动舞台需要文档滚动')
        }
        const observer = new MutationObserver(() => {
          try { moveContents() } catch (error) { state.lostReason = String(error); state.cancel?.(error) }
        })
        automatic = { content, observer, validateLayout() {
          for (const { element, rect, visual } of layout) {
            const moved = element.getBoundingClientRect()
            if (['x', 'y', 'width', 'height'].some(key => Math.abs(moved[key] - rect[key]) >= 1 / 64) ||
                visualKeys.some((key, index) => getComputedStyle(element).getPropertyValue(key) !== visual[index]))
              throw new Error('网页自动舞台无法保持原排版：' + element.localName)
          }
        } }
        moveContents()
        observer.observe(body, { childList: true, attributes: true })
        state.sync = moveContents
        container.style.setProperty('position', 'fixed', 'important')
      }
      isolation = stage.style.getPropertyValue('isolation'); priority = stage.style.getPropertyPriority('isolation')
      stage.before(container); pageChanged = true; container.moveBefore(stage, null)
      stage.style.setProperty('isolation', 'isolate', 'important')
      automatic?.validateLayout()
      output.width = ${size.width}; output.height = ${size.height}
      output.style.cssText = 'all:initial!important;display:block!important;position:fixed!important;left:${view.region[0]}px!important;top:${view.region[1]}px!important;width:${view.region[2]}px!important;height:${view.region[3]}px!important;pointer-events:none!important;z-index:2147483647!important'
      document.documentElement.appendChild(output)
      const context = output.getContext('webgpu')
      if (!context) throw new Error('输出画布的 WebGPU 上下文不可用')
      context.configure({ device, format: 'rgba8unorm', alphaMode: '${view.layer?.only ? 'premultiplied' : 'opaque'}', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC })
      Object.assign(state, { stage, container, output, context, device, copy, checkFrame(end = false) {
        checkTopLayer()
        if (window.scrollX || window.scrollY) throw new Error(${JSON.stringify(DOCUMENT_SCROLL_REASON)})
        if (end) container.removeAttribute('data-henji-frame-active')
        if (container.hasAttribute('data-henji-script-error')) throw new Error(container.getAttribute('data-henji-script-error'))
      } })
      return { captureMode: 'html-in-canvas', fallbackReason: null, pageChanged, automatic: !!automatic }
    } catch (error) {
      state.dispose()
      return { captureMode: 'compositor', fallbackReason: String(error), pageChanged }
    }
  })()`
}

function measureBoxesScript(selectors: readonly string[] | undefined): string {
  return `const selectors = ${JSON.stringify(selectors ?? null)}
    if (!selectors) return null
    const boxes = {}
    for (const selector of selectors) {
      let element = null
      try { element = document.querySelector(selector) } catch {}
      const rect = element && element.getBoundingClientRect()
      boxes[selector] = rect ? [rect.x, rect.y, rect.width, rect.height] : null
    }
    return boxes`
}

function snapshotPaintScript(view: CodeWebView, selectors: readonly string[] | undefined, textSelectors?: readonly string[], traceText = false, identity?: string): string {
  const [sx, sy, swidth, sheight] = view.region
  const { width, height } = codeWebPixelSize(view)
  return `new Promise((resolve, reject) => {
    const state = window.__henjiWebSourceSnapshot
    if (!state) { reject(new Error('网页快照尚未准备')); return }
    if (state.lostReason) { reject(new Error(state.lostReason)); return }
    const { stage, container, context, device, copy } = state
    try { state.checkFrame(); state.sync?.() } catch (error) { reject(error); return }
    if (stage.parentNode !== container) { reject(new Error('网页舞台已被替换或移除')); return }
    ${textSelectors?.length ? textGeometryPaintSetup(textSelectors, view.region, traceText) : ''}
    const clean = () => { clearTimeout(timer); container.removeEventListener('paint', paint); delete state.cancel }
    const paint = () => {
      clean()
      try {
        state.checkFrame(true)
        if (state.lostReason) throw new Error(state.lostReason)
        if (stage.parentNode !== container) throw new Error('网页舞台已被替换或移除')
        ${textSelectors?.length ? "let text, textError; try { const reasons=textSyncReasons(); text = reasons.length ? unavailableText('unsynchronized',reasons) : sampleText() } catch (error) { textError = { code:'sampling-failed', message:error.message } }" : ''}
        const texture = context.getCurrentTexture()
        device.pushErrorScope('validation')
        copy.call(device.queue, { source: stage, sx: ${sx}, sy: ${sy}, swidth: ${swidth}, sheight: ${sheight} },
          { destination: { texture${view.layer?.only ? ', premultipliedAlpha: true' : ''} }, width: ${width}, height: ${height} })
        ${identity ? `const saved = device.createBuffer({ size: 1024, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
        const encoder = device.createCommandEncoder()
        encoder.copyTextureToBuffer({ texture }, { buffer: saved, bytesPerRow: 256 }, [8, 4])
        device.queue.submit([encoder.finish()])
        const pixels = new Uint8Array(8 * 4 * 4)
        for (const [i, digit] of [...${JSON.stringify(identity)}].entries()) {
          pixels.fill(parseInt(digit, 16) * 17, i * 4, i * 4 + 3); pixels[i * 4 + 3] = 255
        }
        device.queue.writeTexture({ texture }, pixels, { bytesPerRow: 32 }, [8, 4])` : ''}
        // 身份区原像素要等显卡做完这一幅才读得到；不让它挡住下一次 seek，宿主随后单独领取。
        ${identity ? `const restoring = saved.mapAsync(GPUMapMode.READ).then(() => Array.from(new Uint8Array(saved.getMappedRange()))).finally(() => saved.destroy())
        restoring.catch(() => undefined)
        ;(state.restores ??= new Map()).set(${JSON.stringify(identity)}, restoring)` : ''}
        const boxes = (() => { ${measureBoxesScript(selectors)} })()
        device.popErrorScope().then(error => {
          if (error) throw new Error(error.message)
          state.checkFrame()
          if (state.lostReason) throw new Error(state.lostReason)
          // 文字位置在提交画面之前采样；画面提交后再核对一次同步状态，期间页面变了就标为未同步。
          resolve(${textSelectors?.length ? "{ boxes, textError, text: (() => { const reasons=textSyncReasons(); return reasons.length ? unavailableText('unsynchronized',reasons) : text })() }" : identity ? '{ boxes }' : 'boxes'})
        }).catch(error => { ${identity ? `state.restores?.delete(${JSON.stringify(identity)}); ` : ''}reject(error) })
      } catch (error) { reject(error) }
    }
    const timer = setTimeout(() => { clean(); reject(new Error('网页快照 paint 超时')) }, ${PAINT_TIMEOUT_MS})
    state.cancel = (error = new Error('网页快照已停止')) => { clean(); reject(error) }
    container.addEventListener('paint', paint, { once: true })
    try { container.requestPaint() } catch (error) { clean(); reject(error) }
  })`
}

/** 领取快照身份区下面的原像素（RGBA，256 字节行距）；每幅恰好领取一次。 */
function snapshotRestoreScript(identity: string): string {
  return `(async () => {
    const restores = window.__henjiWebSourceSnapshot?.restores, pending = restores?.get(${JSON.stringify(identity)})
    if (!pending) throw new Error('网页快照原始像素已失效')
    restores.delete(${JSON.stringify(identity)})
    return await pending
  })()`
}

const SNAPSHOT_DISPOSE_SCRIPT = '(() => { const state = window.__henjiWebSourceSnapshot; return { automatic: !!state?.sync, pageChanged: state?.dispose(), reloadRequired: state?.reloadRequired } })()'

// error/unhandledrejection 不跨隔离世界派发；通过共享 DOM 把页面脚本失败带到快照验证点。
const SNAPSHOT_ERRORS_SCRIPT = `(() => {
  window.__henjiWebSourceStopErrors?.()
  const current = () => document.querySelector('henji-web-stage')?.closest('canvas[layoutsubtree]')
  const body = document.body
  const patches = [], related = new WeakMap()
  const patch = (prototype, key, wrap) => {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, key)
    const value = wrap(descriptor.value)
    Object.defineProperty(prototype, key, { ...descriptor, value })
    patches.push(() => { if (prototype[key] === value) Object.defineProperty(prototype, key, descriptor) })
  }
  // 完整替换正文与替换宿主首节点的 MutationRecord 相同，只记录明确的整体替换意图，不转发 DOM 操作。
  patch(Element.prototype, 'replaceChildren', replace => function(...nodes) {
    const container = current()
    const result = replace.apply(this, nodes)
    if (this === body) container?.setAttribute('data-henji-body-replaced', '')
    return result
  })
  // 只关联因搬走 body 直接子节点而失败的原生操作，不把网络或第三方脚本错误当成舞台错误。
  for (const key of ['removeChild', 'insertBefore', 'replaceChild']) patch(Node.prototype, key, original => function(...nodes) {
    const child = nodes[key === 'removeChild' ? 0 : 1]
    const container = current()
    const moved = !!container && this === body && child?.parentNode === container.querySelector('henji-web-stage > body')
    try { return original.apply(this, nodes) } catch (error) {
      if (moved && container.hasAttribute('data-henji-frame-active')) related.set(error, container.getAttribute('data-henji-frame-active'))
      throw error
    }
  })
  const onError = event => {
    const container = current()
    const error = event.type === 'unhandledrejection' ? event.reason : event.error
    if (container?.hasAttribute('data-henji-frame-active') && error && related.get(error) === container.getAttribute('data-henji-frame-active'))
      container.setAttribute('data-henji-script-error', String(error))
  }
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onError)
  window.__henjiWebSourceStopErrors = () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onError)
    for (const restore of patches.reverse()) restore()
    delete window.__henjiWebSourceStopErrors
  }
})()`

const IDENTITY_READER_IDLE_MS = 2_000

/**
 * 流水线里同时有几幅快照在传输，到达主进程的纹理只能按画面左上角的身份区对号。身份区只读 32 个像素，全部网页来源共用一个读回窗口，
 * 不为每个页面多开一个显卡进程；还没打开好时照常串行取帧，打不开（这台机器的读回窗口不能用 WebGPU）就一直串行。
 * 最后一个网页来源关掉后稍等再关窗口：隐藏窗口也算窗口，久留会让关掉主窗口后应用迟迟不退出；稍等是为了淘汰一页再开一页时不重开。
 */
class SnapshotIdentityReader {
  private reader?: GpuFrameCapture
  private opening?: Promise<void>
  private users = 0
  private idle?: ReturnType<typeof setTimeout>
  private unavailable = false
  private readonly logger = createMainLogger('main.web_source')

  acquire(): void {
    this.users++
    clearTimeout(this.idle); this.idle = undefined
    if (this.reader || this.unavailable) return
    const reader = new GpuFrameCapture(0)
    this.reader = reader
    this.opening = reader.open().catch(error => {
      void reader.dispose()
      // 没人用而中途关掉的不算打不开。
      if (this.reader !== reader) return
      this.reader = undefined; this.opening = undefined; this.unavailable = true
      this.logger.warn('网页快照身份读回不可用，网页取帧不做流水线', { event: 'web_source.snapshot.identity_unavailable', error })
    })
    const opening = this.opening
    void opening.then(() => { if (this.opening === opening) this.opening = undefined })
  }

  /** 已打开的读回窗口；还在打开或打不开时为空。 */
  ready(): GpuFrameCapture | undefined { return this.opening ? undefined : this.reader }

  /** 打开后读回失败（窗口崩溃、显卡设备丢失）：本次运行不再流水线，避免每幅都先失败一次。 */
  fail(reader: GpuFrameCapture, error: unknown): void {
    if (this.reader !== reader) return
    this.reader = undefined; this.unavailable = true
    void reader.dispose()
    this.logger.warn('网页快照身份读回失败，网页取帧改回串行', { event: 'web_source.snapshot.identity_failed', error })
  }

  release(): void {
    if (--this.users > 0) return
    this.idle = setTimeout(() => {
      this.idle = undefined
      if (this.users > 0 || !this.reader) return
      const reader = this.reader
      this.reader = undefined; this.opening = undefined
      void reader.dispose()
    }, IDENTITY_READER_IDLE_MS)
  }
}
const snapshotIdentity = new SnapshotIdentityReader()

interface CapturePath { captureMode: 'compositor' | 'html-in-canvas'; fallbackReason: string | null; automatic?: boolean }
interface SnapshotPreparation extends CapturePath { pageChanged?: boolean }

/** 页面世界：摆到第 t 秒；页面实现了 boxes 时顺带读元素矩形，没实现时为 undefined（由宿主在隔离世界里量）。 */
function seekScript(time: number): string {
  return `(async () => {
    const container = document.querySelector('henji-web-stage')?.parentNode
    container?.removeAttribute('data-henji-script-error')
    container?.setAttribute('data-henji-frame-active', ${JSON.stringify(crypto.randomUUID())})
    const page = window.henjiWeb
    await page.seek(${JSON.stringify(time)})
  })()`
}

function boxesScript(selectors: readonly string[]): string {
  return `(async () => {
    const page = window.henjiWeb
    return typeof page.boxes === 'function' ? { boxes: await page.boxes(${JSON.stringify(selectors)}) } : {}
  })()`
}

/** 隔离世界：让出三帧，页面延后到 requestAnimationFrame 里的 DOM 改动先做完。 */
const SETTLE_SCRIPT = `(async () => {
    for (let i = 0; i < 3; i++) await new Promise(resolve => requestAnimationFrame(resolve))
  })()`

/** 取景左上角的透明小画布：每清一次像素不变，但这一帧必须提交，并带着只有这一点的损坏区。 */
function touchMarkScript({ region, scale }: CodeWebView): string {
  // 损坏区至少覆盖一个输出像素，低倍率下亚像素透明画布不会触发新的 paint。
  const side = Math.max(1, Math.ceil(1 / scale))
  return `const touchMark = () => {
      let mark = window.__henjiWebSourceMark
      if (!mark || !mark.isConnected) {
        mark = document.createElement('canvas'); mark.setAttribute('aria-hidden', 'true')
        document.documentElement.appendChild(mark); window.__henjiWebSourceMark = mark
      }
      mark.width = ${side}; mark.height = ${side}
      mark.style.cssText = 'all:initial!important;display:block!important;position:fixed!important;left:${region[0]}px!important;top:${region[1]}px!important;width:${side}px!important;height:${side}px!important;pointer-events:none!important;z-index:2147483647!important'
      mark.getContext('2d').clearRect(0, 0, ${side}, ${side})
    }`
}

/**
 * 隔离世界：等 seek 的内容真正上屏，再按选择器量元素（页面没实现 boxes 时）并读滚动位置。可见区域栅格完之前新内容不会激活，
 * 这期间合成器画出来的仍是旧画面；后一次提交要等前一次激活，所以前两帧都碰一下标记强制提交，第三帧到来时 seek 的内容已经激活。
 * 只等 requestAnimationFrame 不够：没有改动的帧不提交，也就不等栅格，重页面跳远时会把旧画面当成这一刻。
 */
function activationScript(view: CodeWebView, selectors: readonly string[] | undefined): string {
  return `(async () => {
    ${touchMarkScript(view)}
    for (let i = 0; i < 3; i++) {
      touchMark()
      await new Promise(resolve => requestAnimationFrame(resolve))
    }
    const boxes = (() => { ${measureBoxesScript(selectors)} })()
    return { boxes, scroll: { x: window.scrollX, y: window.scrollY } }
  })()`
}

/**
 * 隔离世界里的标记帧：共享纹理的 paint 按损坏区出画面（`invalidate()` 在共享纹理模式下给不出纹理），
 * 据此认出 seek 之后的那一幅。
 */
function markScript(view: CodeWebView): string {
  return `(async () => {
    ${touchMarkScript(view)}
    touchMark()
    for (let i = 0; i < 2; i++) await new Promise(resolve => requestAnimationFrame(resolve))
    return { scroll: { x: window.scrollX, y: window.scrollY } }
  })()`
}

function withTimeout<T>(promise: Promise<T>, ms: number, failure: string | Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(typeof failure === 'string' ? new Error(failure) : failure), ms)
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

export interface WebSourcePageCapture { boxes: Record<string, WebSourceBox> | null; text?: WebTextCapture; duration: number | null; unsettled: boolean; pixelWidth: number; pixelHeight: number; dropped?: boolean }
export interface ReliableWebSourceFrame {
  frame: TakenFrame<'yuv444p'>
  identity: string
  time: number
  contentHash: string
  epoch: AbortSignal
  boxes: Record<string, WebSourceBox> | null
  /** 发布前还须复核；取帧成功不允许跨页面销毁、重载或内容代次继续发布。 */
  isCurrent: () => boolean
  validate: () => Promise<boolean>
}
/** 精确导出的一幅：画面已交给导出；`reliable` 是后台读回的同幅可靠帧，只供缓存段使用，没有表示这一幅不进缓存。 */
export interface WebSourceExportCapture { boxes: Record<string, WebSourceBox> | null; reliable?: Promise<ReliableWebSourceFrame> }
interface CaptureJob { cancelled: boolean; started: boolean; latest: boolean; controller?: AbortController; signal?: AbortSignal }

interface PreparedCapture { boxes: Record<string, WebSourceBox> | null; text?: WebTextCapture; unsettled: boolean; texture: OffscreenSharedTexture; restore?: number[] }
interface ReliableSnapshot { captured: PreparedCapture; identity: string; contentHash: string; lifetime: AbortSignal; job: CaptureJob; isCurrent: () => boolean; time: number }

type UpdateRect = { x: number; y: number; width: number; height: number } | null | undefined
function updateRect(texture: OffscreenSharedTexture): UpdateRect {
  return (texture.textureInfo as { metadata?: { captureUpdateRect?: UpdateRect } }).metadata?.captureUpdateRect
}

/**
 * 一个网页来源的离屏页面：沙箱、隔离、不挂任何 preload，页面拿不到痕迹的接口。宿主只经 `window.henjiWeb` 串行推进时间，快照传输并行；
 * 页面进程退出、seek 或快照脚本超时（结束页面进程，免得迟到的脚本继续改页面）或重新载入失败后，下一次取帧先重新载入页面。
 */
export class WebSourcePage {
  private window?: BrowserWindow
  private readonly paints: Array<{ seq: number; texture: OffscreenSharedTexture }> = []
  private seq = 0
  private lastPaintAt = 0
  private untextured = 0
  private wake?: () => void
  private tail: Promise<unknown> = Promise.resolve()
  /** 重新载入与调整输出尺寸必须等全部在途快照领取。 */
  private paintTail: Promise<unknown> = Promise.resolve()
  private identityHeld = false
  /** 存在时快照按画面身份对号，后一幅不必等前一幅送到；不存在时快照串行。 */
  private snapshotFrames?: WebSnapshotFrames
  /** 对号器中途撤掉时它等的纹理可能还在路上；改回串行前先接完，免得被当成下一幅。 */
  private drainBeforeSerial = false
  private readonly logger = createMainLogger('main.web_source')
  private readonly jobs = new Map<string, CaptureJob>()
  private deviceScale: number
  private lastSeekTime?: number
  private viewportScroll = { x: 0, y: 0 }
  private loading = false
  private lastBusyPaintAt = 0
  private rendererLifetime = new AbortController()
  private readonly pageLifetime = new AbortController()
  private snapshotFailure?: string
  private frameIndex = 0
  /** 页面进程退出（含脚本超时后主动结束）或重新载入失败：下一次取帧前重新载入。 */
  private stale?: 'gone' | 'reload'
  /** 上一次载入失败：RELOAD_RETRY_MS 之内的取帧直接报这个错，之后再试载入（文件改好了内容指纹不变也能恢复）。 */
  private failure?: { error: Error; at: number }
  private closed = false
  private snapshotWarned = false
  private snapshotMark?: number
  capturePath: CapturePath = { captureMode: 'compositor', fallbackReason: null }
  /** 搬迁影响脚本时，可靠帧只在 seek 完成后临时搬迁，仍使用同幅身份校验。 */
  private snapshotAfterSeek = false
  duration: number | null = null

  constructor(
    readonly streamId: string,
    readonly target: VideoFrameTarget,
    readonly route: string,
    readonly folder: WebSourceFolder,
    readonly view: CodeWebView,
    public contentHash: string,
    private readonly onGone: (reason: string) => void,
    private readonly onSnapshotFallback: (reason: string) => void,
    private readonly recording: WebCacheSubmissions | false = false,
  ) { this.deviceScale = view.scale }

  get pixelWidth(): number { return codeWebPixelSize(this.view).width }
  get pixelHeight(): number { return codeWebPixelSize(this.view).height }
  get signal(): AbortSignal { return this.pageLifetime.signal }

  async validateEnvironment(): Promise<boolean> {
    return !!this.window && !this.closed && !this.stale && webSourceSession(this.folder.root).validate(this.window.webContents)
  }

  /** 打开页面；之后的重新载入与取帧排在它后面。 */
  open(signal?: AbortSignal): Promise<void> {
    if (!this.identityHeld && !this.closed) { this.identityHeld = true; snapshotIdentity.acquire() }
    const run = this.openNow(signal)
    this.tail = run
    return run
  }

  private async openNow(signal?: AbortSignal): Promise<void> {
    await this.submitPage(async () => { this.createWindow() }, signal)
    await this.load(signal)
  }

  private createWindow(): void {
    const { partition } = webSourceSession(this.folder.root)
    const { region } = this.view
    // 离屏窗口的内容尺寸就是取景，设备像素比是倍率；视口与取景原点见 load()。
    const window = new BrowserWindow({
      show: false, focusable: false, skipTaskbar: true, frame: false, width: region[2], height: region[3], useContentSize: true,
      // 只留文字的层靠窗口透明把 alpha 交出去。
      ...(this.view.layer?.only ? { transparent: true } : {}),
      webPreferences: { partition, contextIsolation: true, sandbox: true, nodeIntegration: false, enableBlinkFeatures: 'CanvasDrawElement', offscreen: { useSharedTexture: true, deviceScaleFactor: this.deviceScale }, backgroundThrottling: false, spellcheck: false },
    })
    this.window = window
    const contents = window.webContents
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', (event, url) => { if (new URL(url).origin !== WEB_SOURCE_ORIGIN) event.preventDefault() })
    contents.on('render-process-gone', (_event, details) => {
      if (this.window !== window) return
      this.stale = 'gone'
      this.rendererLifetime.abort()
      for (const job of this.jobs.values()) job.controller?.abort(new Error('网页页面进程已退出'))
      this.releasePaints()
      this.onGone(details.reason)
      this.wake?.()
    })
    contents.on('paint', event => {
      // 位图路径或还没有尺寸的 paint 不带纹理；纹理必须尽快还给浏览器的小池子。
      const texture = event.texture ?? null
      if (!texture) { this.untextured++; return }
      const size = texture.textureInfo.codedSize
      if (this.closed || this.window !== window || !size.width || !size.height) { texture.release(); return }
      this.lastPaintAt = Date.now()
      if (this.capturePath.captureMode !== 'html-in-canvas') {
        if (this.jobs.size || this.loading) this.lastBusyPaintAt = this.lastPaintAt
        else {
          // 没人取帧时的画面没有用处。页面自己在动就停止绘制，每幅都要走共享纹理与 IPC；
          // 停得住的页面没有改动就没有画面，一直开着，免得恢复绘制重发上一幅。
          texture.release()
          if (this.lastPaintAt - this.lastBusyPaintAt >= IDLE_PAINT_GRACE_MS && contents.isPainting()) contents.stopPainting()
          return
        }
      }
      if (this.snapshotFrames && this.capturePath.captureMode === 'html-in-canvas') {
        if (this.coversOutput(texture)) this.snapshotFrames.accept(texture)
        else texture.release()
        this.wake?.()
        return
      }
      this.paints.push({ seq: ++this.seq, texture })
      // 脚本还未返回时输出也可能已到达；第一幅完整快照必须保留到领取，后续局部画面不能把它挤走。
      const mark = this.snapshotMark
      const snapshot = mark === undefined ? undefined : this.paints.find(paint => paint.seq > mark && this.coversOutput(paint.texture))
      while (this.paints.length > HELD_PAINTS) this.paints.splice(this.paints[0] === snapshot ? 1 : 0, 1)[0].texture.release()
      this.wake?.()
    })
    contents.setFrameRate(FRAME_RATE)
  }

  private submitPage<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const active = signal ? AbortSignal.any([signal, this.pageLifetime.signal]) : this.pageLifetime.signal
    const run = (): Promise<T> => { active.throwIfAborted(); return waitWebCacheTask(work(), active) }
    return this.recording ? this.recording.run(run, active) : run()
  }

  /** 载入（或重新载入）网页并等它就绪；页面进程退出过或调试会话断了，先回到空白页重新接上视口设置。 */
  private async load(signal?: AbortSignal): Promise<void> {
    this.loading = true
    try { await this.loadPage(signal) }
    finally { this.loading = false }
  }

  private async loadPage(signal?: AbortSignal): Promise<void> {
    this.rendererLifetime.abort()
    this.snapshotFrames?.close(); this.snapshotFrames = undefined
    const contents = this.window!.webContents
    if (this.stale === 'gone' || !contents.debugger.isAttached()) {
      // 视口设置要等页面有渲染进程才能下发。
      await this.submitPage(() => withTimeout(contents.loadURL('about:blank'), LOAD_TIMEOUT_MS, '网页来源页面启动超时'), signal)
      if (!contents.debugger.isAttached()) contents.debugger.attach('1.3')
    }
    this.viewportScroll = { x: 0, y: 0 }
    await this.submitPage(() => this.configureViewport(), signal)
    await this.submitPage(() => webSourceSession(this.folder.root).observe(contents), signal)
    await this.submitPage(() => {
      if (!contents.isPainting()) contents.startPainting()
      return withTimeout(contents.loadURL(WEB_SOURCE_ENTRY_URL), LOAD_TIMEOUT_MS, '网页加载超时')
    }, signal)
    // 平滑滚动是页面时间之外的动画：seek 之后要立刻到位，取帧才确定。
    await this.submitPage(() => withTimeout(contents.insertCSS('* { scroll-behavior: auto !important }', { cssOrigin: 'user' }), LOAD_TIMEOUT_MS, '网页样式设置超时'), signal)
    const layer = this.view.layer
    if (layer) await this.submitPage(() => withTimeout(contents.insertCSS(codeWebLayerCss(layer), { cssOrigin: 'user' }), LOAD_TIMEOUT_MS, '网页拆层样式注入超时'), signal)
    this.duration = await this.submitPage(() => withTimeout(contents.executeJavaScript(READY_SCRIPT, false) as Promise<number | null>, READY_TIMEOUT_MS, '网页没有在 30 秒内就绪（window.henjiWeb.ready）'), signal)
    if (layer) {
      const issue = await this.submitPage(() => withTimeout(contents.executeJavaScript(layerSelectorCheckScript(layer), false) as Promise<string | null>, LOAD_TIMEOUT_MS, '网页拆层选择器核对超时'), signal)
      if (issue) throw new Error(issue)
    }
    this.stale = undefined
    this.lastSeekTime = undefined
    let pageChanged = false
    try {
      const prepared: SnapshotPreparation = this.snapshotFailure
        ? { captureMode: 'compositor' as const, fallbackReason: this.snapshotFailure }
        : await this.prepareSnapshot(signal)
      this.capturePath = { captureMode: prepared.captureMode, fallbackReason: prepared.fallbackReason, automatic: prepared.automatic }
      pageChanged = prepared.pageChanged === true
      if (this.capturePath.captureMode === 'html-in-canvas') {
        this.snapshotWarned = false
        await this.drainPaints()
        // 首次 GPU 复制可能比静默窗口更慢，必须收到初始输出，不能只以脚本返回作为准备完成。
        const initial = await this.submitPage(() => this.takeSnapshot(undefined), signal)
        initial.texture.release()
      }
    } catch (error) {
      signal?.throwIfAborted()
      if (this.closed || this.window!.isDestroyed() || contents.isDestroyed() || this.stale === 'gone') throw error
      await this.disableSnapshot(error, signal)
      pageChanged = false
    }
    if (pageChanged) await this.drainPaints()
    else this.releasePaints()
    if (this.stale) throw new Error('网页来源准备未完成，需要重新载入')
    this.rendererLifetime = new AbortController()
  }

  private async prepareSnapshot(signal?: AbortSignal, frameToken?: string): Promise<SnapshotPreparation> {
    const contents = this.window!.webContents
    if (frameToken) await this.submitPage(() => withTimeout(contents.executeJavaScript(SNAPSHOT_ERRORS_SCRIPT, false), SEEK_TIMEOUT_MS, '网页脚本错误监听准备超时'), signal)
    const prepared = await this.submitPage(() => withTimeout(contents.executeJavaScriptInIsolatedWorld(HOST_WORLD, [{ code: snapshotPrepareScript(this.view, frameToken) }], false) as Promise<SnapshotPreparation>, READY_TIMEOUT_MS, '网页快照准备超时'), signal)
    this.capturePath = prepared
    if (prepared.automatic && !frameToken) await this.submitPage(() => withTimeout(contents.executeJavaScript(SNAPSHOT_ERRORS_SCRIPT, false), SEEK_TIMEOUT_MS, '网页脚本错误监听准备超时'), signal)
    if (frameToken && !prepared.automatic) await this.submitPage(() => withTimeout(contents.executeJavaScript('window.__henjiWebSourceStopErrors?.()', false), PAINT_TIMEOUT_MS, '网页脚本错误监听清理超时'), signal)
    return prepared
  }

  private async prepareAfterSeek(job: CaptureJob): Promise<void> {
    // 延后的 rAF 也必须在原 DOM 中完成；否则重新搬迁仍会打断这一帧的脚本。
    await this.submit(job, () => withTimeout(this.window!.webContents.executeJavaScriptInIsolatedWorld(HOST_WORLD, [{ code: SETTLE_SCRIPT }], false), SEEK_TIMEOUT_MS, '网页没有画出新画面'))
    await this.prepareSnapshot(job.signal, crypto.randomUUID())
    if (this.capturePath.captureMode !== 'html-in-canvas') throw new Error('网页缓存要求 html-in-canvas 快照：' + this.capturePath.fallbackReason)
    await this.drainPaints()
  }

  /**
   * 视口覆盖按文档坐标钉住可见区域，不随页面滚动；不跟上时远处滚动的内容永远画不到，
   * 窗口露出黑底、标记也出不了画面，所以页面滚动后把取景原点一起挪过去。返回是否挪动。
   */
  private async followScroll(job: CaptureJob, scroll: { x: number; y: number } | undefined): Promise<boolean> {
    if (!scroll || scroll.x === this.viewportScroll.x && scroll.y === this.viewportScroll.y) return false
    const previous = this.viewportScroll
    this.viewportScroll = scroll
    try { await this.submit(job, () => this.configureViewport()) }
    catch (error) { this.viewportScroll = previous; throw error }
    // 视口设置与页面脚本走不同通道，返回时页面可能还没用上：等它画完，免得挪动前露出的黑底被当成这一幅。普通绘制的上一幅此时已领走。
    await this.drainPaints()
    return true
  }

  private async configureViewport(): Promise<void> {
    const { region, scale } = this.view
    const ratio = scale / this.deviceScale
    this.window!.setContentSize(Math.max(1, Math.ceil(region[2] * ratio)), Math.max(1, Math.ceil(region[3] * ratio)))
    await withTimeout(this.window!.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
      width: this.view.width, height: this.view.height, deviceScaleFactor: this.deviceScale, mobile: false,
      viewport: { x: (region[0] + this.viewportScroll.x) * this.deviceScale, y: (region[1] + this.viewportScroll.y) * this.deviceScale, width: region[2], height: region[3], scale: ratio },
    }), LOAD_TIMEOUT_MS, '网页来源页面没有响应视口设置')
  }

  private async resize(scale: number): Promise<void> {
    const dimensions = codeWebPixelSize({ ...this.view, scale })
    if (!Number.isFinite(scale) || scale <= 0 || !Number.isSafeInteger(dimensions.width) || !Number.isSafeInteger(dimensions.height) || dimensions.width < 1 || dimensions.height < 1) throw new Error('网页输出尺寸需要有效的整数像素')
    this.view.scale = scale
    try {
      if (scale > this.deviceScale) {
        // 离屏设备倍率属于窗口；只放大视口会放大低 DPR 的 canvas，也可能收不到完整快照。
        this.rendererLifetime.abort()
        this.releasePaints()
        const previous = this.window
        this.window = undefined
        if (previous && !previous.isDestroyed()) {
          webSourceSession(this.folder.root).release(previous.webContents)
          previous.destroy()
        }
        this.deviceScale = scale
        this.stale = 'gone'
        await this.openNow()
        this.failure = undefined
        return
      }
      await this.configureViewport()
      if (this.capturePath.captureMode === 'html-in-canvas') {
        await withTimeout(this.window!.webContents.executeJavaScriptInIsolatedWorld(HOST_WORLD, [{ code: `(() => {
          const state = window.__henjiWebSourceSnapshot
          if (!state) throw new Error('网页快照尚未准备')
          state.output.width = ${dimensions.width}; state.output.height = ${dimensions.height}
        })()` }], false), PAINT_TIMEOUT_MS, '网页快照调整尺寸超时')
      }
      await this.drainPaints()
    } catch (error) { this.stale ??= 'reload'; throw error }
  }

  /** 载入并记下结果：失败时标记待重新载入，下一次取帧（隔 RELOAD_RETRY_MS 之后）再试。 */
  private async loadRecording(signal?: AbortSignal): Promise<void> {
    try {
      await this.load(signal)
      this.failure = undefined
    } catch (error) {
      this.stale ??= 'reload'
      this.failure = { error: error instanceof Error ? error : new Error(String(error)), at: Date.now() }
      throw error
    }
  }

  /** 网页文件改了：重新载入（排在打开与进行中的取帧之后），之后的画面用新内容。 */
  reload(contentHash: string): Promise<void> {
    this.rendererLifetime.abort()
    for (const job of this.jobs.values()) { job.cancelled = true; job.controller?.abort(new Error('网页来源已重新载入')) }
    const run = Promise.allSettled([this.tail, this.paintTail]).then(async () => {
      if (this.closed) return
      this.contentHash = contentHash
      this.snapshotFailure = undefined
      this.snapshotAfterSeek = false
      await this.loadRecording()
    })
    this.tail = run
    return run
  }

  /**
   * 取第 `time` 秒的画面：经帧通道送到发起的通道（带 `ticket`），返回元素矩形与页面时长；`unsettled` 表示页面 seek 后
   * 一直在变（没按约定停住），取的是最新一幅。
   */
  capture(time: number, ticket: string, selectors: readonly string[] | undefined, options: Pick<WebSourceCaptureRequest, 'scale' | 'latest' | 'text'> = {}): Promise<WebSourcePageCapture> {
    if (this.recording) return Promise.reject(new Error('录制页面必须使用可靠快照入口'))
    if (options.latest) for (const job of this.jobs.values()) if (!job.started && job.latest) job.cancelled = true
    // 取消只中止这一幅的快照等待；不给 job.signal，载入与降级重载属于页面，不能因单幅取消中途停下、和下一次载入叠在一起。
    const job: CaptureJob = { cancelled: false, started: false, latest: options.latest === true, controller: new AbortController() }
    this.jobs.set(ticket, job)
    const previous = this.tail, previousPaint = this.paintTail
    let advance!: () => void
    this.tail = new Promise<void>(resolve => { advance = resolve })
    const prepared = previous.catch(() => undefined).then(async () => {
      if (job.cancelled || this.closed) return undefined
      job.started = true
      // 更换倍率与重载会动输出画布，必须先收完上一幅；普通 seek 只改隐藏舞台，可以重叠。
      if (this.stale || options.scale !== undefined && options.scale !== this.view.scale) {
        await previousPaint.catch(() => undefined)
        if (job.cancelled || this.closed) return undefined
      }
      const captured = await this.captureNow(time, selectors, job, previousPaint, advance, options.scale, options.text, ticket)
      return captured && { ...captured, pixelWidth: this.pixelWidth, pixelHeight: this.pixelHeight, duration: this.duration }
    }).catch(error => {
      if (job.cancelled || this.closed) return undefined
      if (!(error instanceof WebSnapshotMiss)) throw error
      this.logger.debug('网页快照缺失，等待消费者补取', { event: 'web_source.snapshot.missed', context: { streamId: this.streamId, ticket, time, ...this.snapshotFrames?.metrics } })
      return undefined
    }).finally(async () => {
      // 取消、载入失败等提前退出也必须传递绘制屏障，不能让后帧越过尚未领取的快照。
      if (!this.snapshotFrames) await previousPaint.catch(() => undefined)
      advance()
    })
    // 只传递完成时机；不保留结果，否则每幅的纹理描述与身份区原像素会沿链一直被引用。
    this.paintTail = Promise.allSettled([previousPaint, prepared]).then(() => undefined)
    return prepared.then(async captured => {
      const dimensions = { pixelWidth: this.pixelWidth, pixelHeight: this.pixelHeight }
      if (!captured || job.cancelled || this.closed) {
        captured?.texture.release()
        return { boxes: null, duration: this.duration, unsettled: false, dropped: true, ...dimensions }
      }
      await this.deliver(captured.texture, time, ticket, captured.restore)
      return { boxes: captured.boxes, ...(captured.text ? { text: captured.text } : {}), duration: captured.duration, unsettled: captured.unsettled, pixelWidth: captured.pixelWidth, pixelHeight: captured.pixelHeight }
    }).finally(() => { this.jobs.delete(ticket) })
  }

  cancel(ticket: string): boolean {
    const job = this.jobs.get(ticket)
    if (!job) return false
    job.cancelled = true
    job.controller?.abort(new Error('网页录制已取消'))
    return true
  }

  /** 录制沿相同 seek/快照实现，守护区读回成功才交给编码；失败后从新页面向前重演。 */
  captureReliable(time: number, ticket: string, reader: Pick<GpuFrameCapture<'yuv444p'>, 'readSnapshot'>, selectors?: readonly string[], signal?: AbortSignal): Promise<ReliableWebSourceFrame> {
    if (!this.recording) return Promise.reject(new Error('可靠快照需要录制页面'))
    return this.reliableSnapshot(time, ticket, selectors, signal, undefined, async snapshot => {
      const { captured, job } = snapshot
      let transferred = false
      const frame = await this.submit(job, () => {
        transferred = true
        return reader.readSnapshot(captured.texture, { identity: snapshot.identity, width: this.pixelWidth, height: this.pixelHeight, restore: captured.restore! })
      }).finally(() => { if (!transferred) captured.texture.release() })
      return this.reliableFrame(snapshot, frame)
    })
  }

  /**
   * 精确导出顺手写缓存：带身份区的快照立即连同身份区原像素交给导出，导出不等缓存。
   * `readBack` 在交付后决定这一幅是否读回；读回与身份核对在后台进行，失败只让 `reliable` 拒绝，不影响已交付的画面，也不让页面重载。
   */
  captureExport(time: number, ticket: string, reader: Pick<GpuFrameCapture<'yuv444p'>, 'readSnapshot'>, selectors: readonly string[] | undefined, signal: AbortSignal | undefined, scale: number | undefined,
    readBack: () => boolean): Promise<WebSourceExportCapture> {
    if (this.recording) return Promise.reject(new Error('录制页面不交付导出画面'))
    return this.reliableSnapshot(time, ticket, selectors, signal, scale, async snapshot => {
      const { captured } = snapshot
      // 导出与读回各持一份引用，两边都结束才把纹理还给浏览器。
      let holders = 2
      const release = (): void => { if (--holders === 0) captured.texture.release() }
      try { await this.deliver({ ...captured.texture, release }, time, ticket, captured.restore) }
      catch (error) { release(); throw error }
      if (!snapshot.isCurrent() || !readBack()) { release(); return { boxes: captured.boxes } }
      const reliable = reader.readSnapshot({ ...captured.texture, release }, { identity: snapshot.identity, width: this.pixelWidth, height: this.pixelHeight, restore: captured.restore! })
        .then(frame => this.reliableFrame(snapshot, frame))
      // 调用方已因取消不再等待时，没人接这份结果。
      void reliable.catch(() => undefined)
      return { boxes: captured.boxes, reliable }
    })
  }

  private reliableFrame(snapshot: ReliableSnapshot, frame: TakenFrame<'yuv444p'> | null): ReliableWebSourceFrame {
    const { captured, identity, contentHash, lifetime, job, isCurrent, time } = snapshot
    if (!frame || !isCurrent()) throw new Error('网页快照身份校验失败或已失效')
    const validate = async (): Promise<boolean> => {
      if (!isCurrent()) return false
      const valid = await this.submit(job, () => withTimeout(this.window!.webContents.executeJavaScriptInIsolatedWorld(HOST_WORLD, [{ code: '!!window.__henjiWebSourceSnapshot && !window.__henjiWebSourceSnapshot.lostReason' }], false), PAINT_TIMEOUT_MS, '网页快照代次检查超时'))
      return valid === true && isCurrent()
    }
    return { frame, identity, time, contentHash, epoch: lifetime, boxes: captured.boxes, isCurrent, validate }
  }

  /** 带身份区的快照；`finish` 仍在页面取帧链里执行，它失败与快照失败一样让页面下次重载。 */
  private reliableSnapshot<T>(time: number, ticket: string, selectors: readonly string[] | undefined, signal: AbortSignal | undefined, scale: number | undefined, finish: (snapshot: ReliableSnapshot) => Promise<T>): Promise<T> {
    const controller = new AbortController()
    const job: CaptureJob = { cancelled: false, started: false, latest: false, controller, signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal }
    this.jobs.set(ticket, job)
    const previous = this.tail, previousPaint = this.paintTail
    let advance = (): void => undefined
    if (!this.recording) this.tail = new Promise<void>(resolve => { advance = resolve })
    const run = previous.catch(() => undefined).then(async () => {
      job.signal!.throwIfAborted()
      if (this.closed || job.cancelled) throw new Error('网页录制已取消')
      if (this.recording || this.stale || scale !== undefined && scale !== this.view.scale || this.snapshotAfterSeek) await previousPaint.catch(() => undefined)
      if (this.stale) await this.loadRecording(job.signal)
      if (this.capturePath.captureMode !== 'html-in-canvas' && !this.snapshotAfterSeek) throw new Error('网页缓存要求 html-in-canvas 快照')
      if (this.pixelWidth < 8 || this.pixelHeight < 4) throw new Error('网页画面容纳不了快照身份区')
      if (!Number.isFinite(time) || time < 0 || this.recording && this.lastSeekTime !== undefined && time <= this.lastSeekTime) throw new Error('网页录制只能向前推进，缺帧须重建本段')
      job.started = true
      let lifetime = this.rendererLifetime.signal
      const contentHash = this.contentHash
      const identity = crypto.createHash('sha256').update(JSON.stringify([crypto.randomUUID(), this.streamId, contentHash, time, ticket])).digest('hex').slice(0, 32)
      const isCurrent = (): boolean => !this.closed && !job.cancelled && !job.signal!.aborted && !lifetime.aborted && this.contentHash === contentHash && this.capturePath.captureMode === 'html-in-canvas'
      const captured = await this.captureNow(time, selectors, job, previousPaint, advance, scale, undefined, ticket, identity)
      lifetime = this.rendererLifetime.signal
      if (!captured) throw new Error('网页录制已取消')
      if (captured.unsettled || !isCurrent()) { captured.texture.release(); throw new Error('网页快照已失效') }
      return finish({ captured, identity, contentHash, lifetime, job, isCurrent, time })
    }).catch(error => {
      if (error instanceof WebSnapshotMiss) throw error
      if (job.started || !job.signal!.aborted) { this.rendererLifetime.abort(); this.stale ??= 'reload' }
      throw error
    }).finally(async () => {
      this.jobs.delete(ticket)
      if (!this.snapshotFrames) await previousPaint.catch(() => undefined)
      advance()
    })
    if (this.recording) this.tail = run
    this.paintTail = Promise.allSettled([previousPaint, run]).then(() => undefined)
    return waitWebCacheTask(run, job.signal!)
  }

  private submit<T>(job: CaptureJob, work: () => Promise<T>): Promise<T> {
    return this.recording ? this.recording.run(async () => {
      if (this.closed || job.cancelled) throw new Error('网页录制已取消')
      return work()
    }, job.signal) : work()
  }

  private async seekAndMeasure(time: number, selectors: readonly string[] | undefined, job: CaptureJob): Promise<{ boxes?: unknown } | undefined> {
    const contents = this.window!.webContents
    try {
      const from = this.lastSeekTime
      await this.submit(job, async () => {
        if (!contents.isPainting()) await this.resumePainting(contents)
        return this.pageScript(seekScript(time), `网页 seek(${time}) 超过 ${SEEK_TIMEOUT_MS / 1000} 秒没有完成（上次完成 ${from ?? '未取帧'}，${from === undefined ? '首次定位' : time < from ? '向后跳转' : '向前推进'}）`)
      })
      this.lastSeekTime = time
      if (job.cancelled || this.closed) return undefined
      return selectors ? await this.submit(job, () => this.pageScript(boxesScript(selectors), `网页 boxes(${time}) 超过 ${SEEK_TIMEOUT_MS / 1000} 秒没有完成`)) as { boxes?: unknown } : {}
    } catch (error) {
      // 超时的 seek 可能还在改页面：结束页面进程，走进程退出后的重建，不让它迟到的结果混进别的时刻。
      if (error instanceof Error && /^网页 (seek|boxes)\(/.test(error.message) && !contents.isDestroyed()) {
        this.stale = 'gone'
        this.rendererLifetime.abort()
        contents.forcefullyCrashRenderer()
      }
      throw error
    }
  }

  /** 恢复绘制会重发上一幅，晚于标记送到就会被当成这一刻，所以先等它过去再动页面。 */
  private async resumePainting(contents: Electron.WebContents): Promise<void> {
    const seen = this.seq, until = Date.now() + RESEND_WAIT_MS
    contents.startPainting()
    while (this.seq === seen && Date.now() < until && !this.closed) {
      await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, until - Date.now())
        this.wake = () => { clearTimeout(timer); resolve() }
      })
      this.wake = undefined
    }
  }

  private async captureNow(time: number, selectors: readonly string[] | undefined, job: CaptureJob, previousPaint: Promise<unknown>, advance: () => void, scale?: number, textSelectors?: readonly string[], ticket = '', identity?: string): Promise<PreparedCapture | undefined> {
    if (this.closed) throw new Error('网页来源已关闭')
    if (this.stale) {
      if (this.failure && Date.now() - this.failure.at < RELOAD_RETRY_MS) throw this.failure.error
      await this.loadRecording(job.signal)
    }
    if (job.cancelled || this.closed) return undefined
    if (scale !== undefined && scale !== this.view.scale) await this.resize(scale)
    if (job.cancelled || this.closed) return undefined
    const contents = this.window!.webContents
    try {
      if (identity && this.snapshotAfterSeek && this.capturePath.captureMode === 'html-in-canvas') await this.disableSnapshot('网页脚本使用原始正文结构', job.signal)
      let seeked: { boxes?: unknown } | undefined
      try { seeked = await this.seekAndMeasure(time, selectors, job) }
      catch (error) {
        if (!this.capturePath.automatic || this.stale || job.cancelled) throw error
        // 前帧仍在领取时不能拆它的舞台；恢复后重做同一时刻，修复 body 子节点操作的失败。
        await previousPaint.catch(() => undefined)
        if (identity) this.snapshotAfterSeek = true
        await this.disableSnapshot(error, job.signal)
        seeked = await this.seekAndMeasure(time, selectors, job)
      }
      if (!seeked) return undefined
      // 快照只改隐藏舞台，是否等前一幅由 takeSnapshot 按能否对号决定；普通绘制必须等上一幅结束才动页面。
      if (this.capturePath.captureMode !== 'html-in-canvas') await previousPaint.catch(() => undefined)
      if (job.cancelled || this.closed) return undefined
      if (this.stale) throw new Error('网页取帧链路已失效，下一次取帧时重新载入')
      if (identity && this.snapshotAfterSeek) {
        await this.prepareAfterSeek(job)
      }
      const textIdentity = { ticket, time, contentHash: this.contentHash }
      const wantsText = !!textSelectors?.length
      let measure = selectors && seeked.boxes === undefined ? selectors : undefined
      if (this.capturePath.captureMode === 'html-in-canvas') {
        let snapshot: { measured: unknown; restore?: number[]; texture: OffscreenSharedTexture } | undefined
        let advanced = false
        // 文本准备失败只拒绝这一读；快照设备仍可服务没有文本声明的消费者及后续重试。
        if (wantsText) {
          try {
            await withTimeout(contents.executeJavaScriptInIsolatedWorld(HOST_WORLD, [{ code: TEXT_GEOMETRY_PREPARE_SCRIPT }], false), SEEK_TIMEOUT_MS,
              new WebTextCaptureError('font-timeout', '网页字体仍未加载完成，请等待字体加载完成后重试。'))
          } catch (error) {
            if (error instanceof WebTextCaptureError) throw error
            throw new WebTextCaptureError('prepare-failed', '网页文字准备失败，请检查网页内容后重试。', { cause: error })
          }
        }
        try {
          if (job.cancelled || this.closed) return undefined
          snapshot = await this.submit(job, () => this.takeSnapshot(measure, () => { advanced = true; advance() }, wantsText ? textSelectors : undefined, identity, job.signal ?? job.controller?.signal, previousPaint))
        } catch (error) {
          if (job.cancelled) return undefined
          if (error instanceof WebSnapshotMiss) throw error
          if (this.closed || this.window!.isDestroyed() || contents.isDestroyed() || this.stale === 'gone') throw error
          if (identity && error instanceof Error && error.message.includes(DOCUMENT_SCROLL_REASON)) throw new WebSnapshotUnsupported(DOCUMENT_SCROLL_REASON, { cause: error })
          // 下一次 seek 已开始时不能在同一个 DOM 上重画上一刻。收口为重载回退，阻止迟到脚本污染下一幅。
          if (advanced) {
            this.snapshotFailure = error instanceof Error ? error.message : String(error)
            this.stale = 'gone'; this.rendererLifetime.abort(); contents.forcefullyCrashRenderer()
            this.onSnapshotFallback(this.snapshotFailure)
            throw error
          }
          if (identity && this.snapshotAfterSeek) throw error
          if (identity) this.snapshotAfterSeek = true
          // 前几幅可能仍按身份等待纹理；拆舞台会让它们全部失效，先等它们领走。
          await previousPaint.catch(() => undefined)
          if (await this.disableSnapshot(error, job.signal)) {
            // 恢复流内布局后再定位，才能兑现自动舞台内被裁掉的文档滚动请求。
            seeked = await this.seekAndMeasure(time, selectors, job)
            if (!seeked) return undefined
            measure = selectors && seeked.boxes === undefined ? selectors : undefined
          }
          if (identity) {
            await this.prepareAfterSeek(job)
            snapshot = await this.submit(job, () => this.takeSnapshot(measure, undefined, undefined, identity, job.signal ?? job.controller?.signal, previousPaint))
          }
        }
        if (snapshot) {
          if (wantsText) {
            try {
              const measured = snapshot.measured as { boxes: unknown; textError?: { code: 'sampling-failed'; message: string }; text: Omit<WebTextCapture, 'ticket' | 'time' | 'contentHash'> }
              if (measured.textError) throw new WebTextCaptureError(measured.textError.code, '网页文字位置采样失败，请检查文本选择器与网页内容后重试。', { cause: new Error(measured.textError.message) })
              const results = validateWebTextResults(measured.text.results, textSelectors!)
              return { texture: snapshot.texture, boxes: selectors ? webSourceBoxes(seeked.boxes ?? measured.boxes, selectors) : null, text: { ...measured.text, ...textIdentity, results }, restore: snapshot.restore, unsettled: false }
            } catch (error) { snapshot.texture.release(); throw error }
          }
          return { texture: snapshot.texture, restore: snapshot.restore, boxes: selectors ? webSourceBoxes(seeked.boxes ?? snapshot.measured, selectors) : null, unsettled: false }
        }
      }
      const activate = (): Promise<{ boxes: unknown; scroll: { x: number; y: number } } | null> => withTimeout(contents.executeJavaScriptInIsolatedWorld(HOST_WORLD, [{ code: activationScript(this.view, measure) }], false), SEEK_TIMEOUT_MS, '网页没有画出新画面')
      const markPage = (): Promise<{ scroll: { x: number; y: number } } | null> => withTimeout(contents.executeJavaScriptInIsolatedWorld(HOST_WORLD, [{ code: markScript(this.view) }], false), SEEK_TIMEOUT_MS, '网页没有响应取帧标记')
      // 延后或脚本发起的平滑滚动时，一轮跟随之后位置还会变。打完标记再核对一次：取景落后时标记不在画面里，也就等不到这一幅。
      let activated: Awaited<ReturnType<typeof activate>> = null
      let mark = this.seq
      let scrolling = true
      for (let round = 0; scrolling && round < SCROLL_FOLLOW_ROUNDS; round++) {
        activated = await activate()
        if (job.cancelled || this.closed) return undefined
        if (await this.followScroll(job, activated?.scroll)) continue
        mark = this.seq
        scrolling = await this.followScroll(job, (await markPage())?.scroll)
        if (job.cancelled || this.closed) return undefined
      }
      if (scrolling) { mark = this.seq; await markPage() }
      let painted: Awaited<ReturnType<WebSourcePage['markedPaint']>> | undefined
      for (let round = 0; !painted; round++) {
        try { painted = await this.markedPaint(mark) }
        catch (error) {
          if (this.closed || this.stale || round >= SCROLL_FOLLOW_ROUNDS) throw error
          // 标记发出之后页面才滚走时，画面里既没有标记也没有新内容；挪过去重打一次，真没有画面才报错。
          scrolling = true
          if (!await this.followScroll(job, (await markPage())?.scroll)) throw error
          mark = this.seq
          await markPage()
        }
      }
      const { texture } = painted, unsettled = painted.unsettled || scrolling
      return { texture, boxes: selectors ? webSourceBoxes(seeked.boxes ?? activated?.boxes, selectors) : null, ...(wantsText ? { text: { ...textIdentity, samplerVersion: WEB_TEXT_SAMPLER_VERSION, results: unavailableWebText(textSelectors!, 'capture-path'), sampleMs: 0, serializationMs: 0, bytes: 0 } } : {}), unsettled }
    } finally {
      // 下一次 seek 尚未领取绘制锁，不能释放上一幅仍在等待的纹理。
      if (!this.snapshotFrames) await previousPaint.catch(() => undefined)
      if (!this.snapshotFrames || this.capturePath.captureMode !== 'html-in-canvas') this.releasePaints()
    }
  }

  private pageScript(code: string, timeout: string): Promise<unknown> {
    const signal = this.rendererLifetime.signal
    return withTimeout(new Promise((resolve, reject) => {
      const gone = (): void => reject(new Error('网页取帧链路已失效，下一次取帧时重新载入'))
      if (signal.aborted) { gone(); return }
      signal.addEventListener('abort', gone, { once: true })
      this.window!.webContents.executeJavaScript(code, false).then(resolve, reject).finally(() => signal.removeEventListener('abort', gone))
    }), SEEK_TIMEOUT_MS, timeout)
  }

  private async disableSnapshot(error: unknown, signal?: AbortSignal): Promise<boolean> {
    if (this.closed || !this.window || this.window.isDestroyed() || this.stale === 'gone') throw error
    const contents = this.window.webContents
    if (contents.isDestroyed()) throw error
    const reason = error instanceof Error ? error.message : String(error)
    this.snapshotFrames?.close(); this.snapshotFrames = undefined
    let disposed: { pageChanged?: boolean; automatic?: boolean; reloadRequired?: boolean } | undefined
    try {
      if (this.capturePath.automatic) await withTimeout(contents.executeJavaScript('window.__henjiWebSourceStopErrors?.()', false), PAINT_TIMEOUT_MS, '网页脚本错误监听清理超时')
      disposed = await withTimeout(contents.executeJavaScriptInIsolatedWorld(HOST_WORLD, [{ code: SNAPSHOT_DISPOSE_SCRIPT }], false) as Promise<typeof disposed>, PAINT_TIMEOUT_MS, '网页快照清理超时')
    } catch (cleanupError) {
      // 清理未完成时必须重新载入，避免隐藏的舞台或迟到的快照混进普通取帧。
      this.stale ??= 'reload'
      throw new Error(reason, { cause: cleanupError })
    }
    if (disposed?.pageChanged) await this.drainPaints()
    else this.releasePaints()
    if (this.closed || this.window.isDestroyed() || contents.isDestroyed() || this.stale) throw error
    this.capturePath = { captureMode: 'compositor', fallbackReason: reason }
    if (!this.snapshotWarned) { this.snapshotWarned = true; this.onSnapshotFallback(reason) }
    if (disposed?.reloadRequired) {
      this.snapshotFailure = reason
      await this.loadRecording(signal)
    }
    return disposed?.automatic === true
  }

  /**
   * 画一幅快照并领取它的纹理。能按身份对号时不等 `previousPaint`（前几幅可以仍在传输）；不能时先等前一幅领走，
   * 再取标记之后第一幅完整画面。两种方式切换前也先等前一幅，免得仍按旧方式等待的那幅被新方式截走。
   */
  private async takeSnapshot(selectors: readonly string[] | undefined, submitted?: () => void, textSelectors?: readonly string[], identity?: string, signal?: AbortSignal, previousPaint: Promise<unknown> = Promise.resolve()): Promise<{ measured: unknown; restore?: number[]; texture: OffscreenSharedTexture }> {
    const contents = this.window!.webContents
    let expected: ReturnType<WebSnapshotFrames['expect']> | undefined
    let taken = false
    let mark = this.seq
    try {
      const fits = this.pixelWidth >= 8 && this.pixelHeight >= 4
      if (this.snapshotFrames && !fits) { await previousPaint.catch(() => undefined); this.snapshotFrames.close(); this.snapshotFrames = undefined; this.drainBeforeSerial = true }
      const reader = snapshotIdentity.ready()
      if (reader && !this.snapshotFrames && fits) {
        await previousPaint.catch(() => undefined)
        if (this.closed) throw new Error('网页来源已关闭')
        const frames: WebSnapshotFrames = new WebSnapshotFrames(texture => reader.identifySnapshot(texture), error => {
          if (this.snapshotFrames === frames) { this.snapshotFrames = undefined; this.drainBeforeSerial = true }
          snapshotIdentity.fail(reader, error)
        })
        this.snapshotFrames ??= frames
      }
      if (this.snapshotFrames) {
        identity ??= crypto.randomBytes(16).toString('hex')
        expected = this.snapshotFrames.expect(identity, signal)
      } else {
        await previousPaint.catch(() => undefined)
        if (this.drainBeforeSerial) { this.drainBeforeSerial = false; await this.drainPaints() }
        mark = this.seq
        this.snapshotMark = mark
      }
      const measured: unknown = await withTimeout(contents.executeJavaScriptInIsolatedWorld(HOST_WORLD, [{ code: snapshotPaintScript(this.view, selectors, textSelectors, process.env.HENJI_WEB_TEXT_TRACE === '1', identity) }], false), SEEK_TIMEOUT_MS, '网页没有响应快照取帧')
      submitted?.()
      expected?.start()
      const restoring = identity ? withTimeout(contents.executeJavaScriptInIsolatedWorld(HOST_WORLD, [{ code: snapshotRestoreScript(identity) }], false) as Promise<number[]>, PAINT_TIMEOUT_MS, '网页快照原始像素没有返回') : undefined
      void restoring?.catch(() => undefined)
      const texture = await (expected?.frame ?? this.snapshotPaint(mark))
      taken = true
      let restore: number[] | undefined
      try { restore = await restoring } catch (error) { texture.release(); throw error }
      const { width, height } = texture.textureInfo.codedSize
      if (width < this.pixelWidth || height < this.pixelHeight) { texture.release(); throw new Error('网页快照纹理没有覆盖完整输出') }
      // 原生窗口的 DIP 换算可能让纹理分配多出边缘像素；只交付输出画布的有效区域，不缩放像素。
      const visibleRect = { x: 0, y: 0, width: this.pixelWidth, height: this.pixelHeight }
      // 带文字采样时 measured 整体交给调用方解析。
      return { measured: identity && !textSelectors?.length ? (measured as { boxes: unknown }).boxes : measured, restore,
        texture: { ...texture, textureInfo: { ...texture.textureInfo, visibleRect }, release: () => texture.release() } }
    } catch (error) {
      // 页面主线程卡住时清理脚本也无法执行，结束页面进程后由下一次取帧重新载入。
      if (error instanceof Error && error.message === '网页没有响应快照取帧' && !contents.isDestroyed()) {
        this.stale = 'gone'
        this.rendererLifetime.abort()
        contents.forcefullyCrashRenderer()
      }
      throw error
    } finally {
      expected?.cancel()
      // 脚本失败前纹理可能已对上号送到：没人领取也要还给浏览器的小纹理池。
      if (expected && !taken) void expected.frame.then(texture => texture.release(), () => undefined)
      if (!expected) this.snapshotMark = undefined
    }
  }

  private coversOutput(texture: OffscreenSharedTexture): boolean {
    const rect = updateRect(texture)
    return !rect || rect.x <= 0 && rect.y <= 0 && rect.x + rect.width >= this.pixelWidth && rect.y + rect.height >= this.pixelHeight
  }

  /** 已收到的序号无法识别传输中的启动画面；保持接收直到静默，再一次释放，隔开两种绘制链路。 */
  private async drainPaints(): Promise<void> {
    const started = Date.now()
    try {
      for (;;) {
        if (this.closed) throw new Error('网页来源已关闭')
        if (this.stale === 'gone') throw new Error('网页页面进程已退出，下一次取帧时重新载入')
        const now = Date.now()
        const remaining = Math.min(Math.max(started, this.lastPaintAt) + PREPARE_QUIET_MS - now, started + PREPARE_BUSY_MS - now)
        if (remaining <= 0) return
        await new Promise<void>(resolve => {
          const timer = setTimeout(resolve, remaining)
          this.wake = () => { clearTimeout(timer); resolve() }
        })
        this.wake = undefined
      }
    } finally {
      this.releasePaints()
    }
  }

  /** 快照更新会覆盖整个输出；局部更新可能属于准备或其他 DOM 变化，不能作为本次结果。 */
  private async snapshotPaint(mark: number): Promise<OffscreenSharedTexture> {
    const started = Date.now()
    for (;;) {
      if (this.closed) throw new Error('网页来源已关闭')
      if (this.stale === 'gone') throw new Error('网页页面进程已退出，下一次取帧时重新载入')
      const chosen = this.paints.find(paint => paint.seq > mark && this.coversOutput(paint.texture))
      if (chosen) { this.paints.splice(this.paints.indexOf(chosen), 1); return chosen.texture }
      const remaining = PAINT_TIMEOUT_MS - (Date.now() - started)
      if (remaining <= 0) throw new Error('网页取帧超时：页面没有画出完整快照')
      await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, remaining)
        this.wake = () => { clearTimeout(timer); resolve() }
      })
      this.wake = undefined
    }
  }

  /**
   * 标记之后的那一幅（`mark` 是发出标记前的 paint 序号）。只含标记的一幅最先认出；损坏区被上层滤镜扩大时，
   * 页面停住后标记帧就是最后一幅，画面安静 `MARK_QUIET_MS` 后取最新一幅盖住标记的；一直不安静（页面没停住）
   * 到 `MARK_BUSY_MS` 时也取最新一幅。
   */
  private async markedPaint(mark: number): Promise<{ texture: OffscreenSharedTexture; unsettled: boolean }> {
    const started = Date.now()
    const side = Math.ceil(this.view.scale) + 2
    const onlyMark = (rect: UpdateRect): boolean => !!rect && rect.x <= 1 && rect.y <= 1 && rect.x + rect.width >= 1 && rect.y + rect.height >= 1 && rect.width <= side && rect.height <= side
    const coversMark = (rect: UpdateRect): boolean => !rect || rect.x <= 0 && rect.y <= 0 && rect.x + rect.width >= 1 && rect.y + rect.height >= 1
    for (;;) {
      if (this.closed) throw new Error('网页来源已关闭')
      if (this.stale === 'gone') throw new Error('网页页面进程已退出，下一次取帧时重新载入')
      const now = Date.now(), elapsed = now - started
      const after = this.paints.filter(paint => paint.seq > mark)
      const exact = after.find(paint => onlyMark(updateRect(paint.texture)))
      const latest = after.filter(paint => coversMark(updateRect(paint.texture))).at(-1)
      const quiet = now - this.lastPaintAt >= MARK_QUIET_MS
      const chosen = exact ?? (latest && (quiet || elapsed >= MARK_BUSY_MS) ? latest : undefined)
      if (chosen) {
        this.paints.splice(this.paints.indexOf(chosen), 1)
        return { texture: chosen.texture, unsettled: !exact && !quiet }
      }
      if (elapsed >= PAINT_TIMEOUT_MS) throw new Error(`网页取帧超时：${this.untextured && !this.seq ? '这台机器的离屏共享纹理不可用' : '页面没有画出新画面'}`)
      const until = latest ? Math.min(this.lastPaintAt + MARK_QUIET_MS - now, MARK_BUSY_MS - elapsed) : PAINT_TIMEOUT_MS - elapsed
      await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, Math.max(1, until))
        this.wake = () => { clearTimeout(timer); resolve() }
      })
      this.wake = undefined
    }
  }

  /** 送到发起窗口的主 frame；纹理在全部引用释放后（渲染层关掉帧）才还给浏览器。 */
  private async deliver(texture: OffscreenSharedTexture, time: number, ticket: string, webRestore?: number[]): Promise<void> {
    if (this.target.isDestroyed()) { texture.release(); throw new Error('目标窗口已关闭') }
    const meta: VideoFrameMeta = { route: this.route, streamId: this.streamId, frameIndex: this.frameIndex++, timestampUs: Math.round(time * 1e6), request: { kind: 'frame_at', id: ticket },
      ...(this.capturePath.captureMode === 'html-in-canvas' ? { displaySize: { width: this.pixelWidth, height: this.pixelHeight } } : {}), ...(webRestore ? { webRestore } : {}) }
    let imported: ReturnType<typeof sharedTexture.importSharedTexture>
    try {
      imported = sharedTexture.importSharedTexture({ textureInfo: texture.textureInfo as unknown as Parameters<typeof sharedTexture.importSharedTexture>[0]['textureInfo'], allReferencesReleased: () => texture.release() })
    } catch (error) {
      texture.release()
      throw new Error(`网页画面导入共享纹理失败：${error instanceof Error ? error.message : String(error)}`)
    }
    try {
      await sharedTexture.sendSharedTexture({ frame: this.target.mainFrame, importedSharedTexture: imported }, meta)
    } finally {
      imported.release()
    }
  }

  private releasePaints(): void {
    for (const paint of this.paints.splice(0)) paint.texture.release()
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.pageLifetime.abort(new Error('网页来源已关闭'))
    this.rendererLifetime.abort()
    this.snapshotFrames?.close(); this.snapshotFrames = undefined
    if (this.identityHeld) { this.identityHeld = false; snapshotIdentity.release() }
    for (const job of this.jobs.values()) { job.cancelled = true; job.controller?.abort(new Error('网页来源已关闭')) }
    this.wake?.()
    this.releasePaints()
    if (this.window && !this.window.isDestroyed()) {
      webSourceSession(this.folder.root).release(this.window.webContents)
      this.window.destroy()
    }
  }
}
