'use strict'

/**
 * 画布大规模基准：几千到上万个节点时的打开、快速缩放、远景平移与内存。
 *
 * 与 `electron-canvas-pan-bench.cjs` 的分工：那个用真实工程量“近景连续平移”的绘制成本；
 * 这个量节点数量本身带来的成本（挂载、布局、合成、内存），并在快速缩放期间连续截屏，
 * 供逐帧检查节点有没有空白、闪烁或跳变。
 *
 * 一律在隔离资料目录里运行；每个节点引用一张独立图片文件，避免全部命中同一份解码缓存。
 *
 * 环境变量：
 *   SCALE_NODES      逗号分隔的节点数（默认 2000,5000,10000）
 *   SCALE_BUILD_DIR  构建产物目录（默认 out）
 *   SCALE_OUT        结果目录（默认 .canvas-scale-bench）
 *   SCALE_PROFILE    设 1 时各阶段附带主线程 CPU 采样的自耗时排行
 *   SCALE_TRACE      设 1 时先录 2 秒静止时间线并按事件名汇总
 *   SCALE_HOLD_PORT  给一个端口号时，量完后保持窗口并开放该调试端口
 *   SCALE_FRAMES     设 1 时在快速缩放期间、近景平移期间各录一段屏并存成逐帧图片
 *   SCALE_INTERACT   设 1 时不量帧率，改为逐项核对远景下的交互（点选、右键、拖进素材组、批量连线、文件拖放、连线落点）
 *   SCALE_UI_ZOOM    界面缩放比例（如 1.25）：核对正文截图在界面缩放不是 100% 时仍然对得上
 *   SCALE_CSS        打开画布后注入的一段样式：做对照实验用（例如藏掉小地图看它占多少）
 *   SCALE_IMAGE_DIR  测试图片缓存目录（默认系统临时目录下 henji-canvas-scale-images）
 *   SCALE_DISPLAY_POINT 窗口所在显示器内的桌面坐标（默认 2561,1）
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const sharp = require('sharp')
const { launchElectronApp, waitForApp } = require('./lib/electronLaunch.cjs')
const { formatScaleResult } = require('./lib/canvasScaleReport.cjs')
const { findPanePoint } = require('./lib/canvasPanInput.cjs')
const { runInteractionChecks } = require('./lib/canvasScaleInteract.cjs')

const ROOT = path.resolve(__dirname, '..')
// 正式实例正在用 out/ 时不能重新打包：另建一份产物（electron-vite build --outDir <目录>）并用 SCALE_BUILD_DIR 指过去
const MAIN_ENTRY = path.join(path.resolve(ROOT, process.env.SCALE_BUILD_DIR || 'out'), 'main', 'index.cjs')
const SCALES = (process.env.SCALE_NODES || '2000,5000,10000').split(',').map(Number).filter(Boolean)
const OUT_DIR = path.resolve(ROOT, process.env.SCALE_OUT || '.canvas-scale-bench')
const CAPTURE_FRAMES = process.env.SCALE_FRAMES === '1'
const INTERACT = process.env.SCALE_INTERACT === '1'
const INTERACT_GROUP_ID = 'scale-asset-group'
const INTERACT_EMPTY_PROMPT_ID = 'scale-empty-prompt'
const PROFILE = process.env.SCALE_PROFILE === '1'
const TRACE = process.env.SCALE_TRACE === '1'
const HOLD_PORT = Number(process.env.SCALE_HOLD_PORT || 0)
const IMAGE_DIR = process.env.SCALE_IMAGE_DIR || path.join(os.tmpdir(), 'henji-canvas-scale-images')
const DISPLAY_POINT = process.env.SCALE_DISPLAY_POINT || '2561,1'
const SAMPLE_VIDEO = path.join(ROOT, 'scripts/fixtures/plain_video.mp4')

const SPACING_X = 460
const SPACING_Y = 500
const PROMPT = '主体：年轻女性，长黑发，仰头看向头顶透过花枝的光。镜头：极低机位仰拍，24mm 广角，随后机位一边后拉一边缓慢升高。质感：写实电影摄影，柔和逆光，浅景深。'

/**
 * 各类节点在应用里量得的尺寸。正式保存的画布都带量得尺寸，夹具照着写，测的才是“打开一份已有画布”；
 * SCALE_UNMEASURED=1 时不写，测“节点从没量过”的路径。
 */
const MEASURED = process.env.SCALE_UNMEASURED === '1' ? {} : JSON.parse(process.env.SCALE_MEASURED || 'null') || {
  uploadNode: { width: 392, height: 261 },
  exportImageNode: { width: 252, height: 168 },
  videoUploadNode: { width: 427, height: 240 },
  textAnnotationNode: { width: 300, height: 180 },
  imageNode: { width: 320, height: 301 },
  videoGenNode: { width: 320, height: 343 },
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }

/** 每张图内容不同（底色、色块、编号），尺寸接近真实缩略负载。 */
async function ensureImages(count) {
  fs.mkdirSync(IMAGE_DIR, { recursive: true })
  const paths = []
  const pending = []
  for (let i = 0; i < count; i += 1) {
    const file = path.join(IMAGE_DIR, `scale-${i}.jpg`)
    paths.push(file)
    if (fs.existsSync(file)) continue
    const hue = (i * 47) % 360
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="768" height="512">
      <rect width="768" height="512" fill="hsl(${hue} 45% 32%)"/>
      <circle cx="${150 + (i * 31) % 460}" cy="${120 + (i * 17) % 260}" r="${60 + (i % 5) * 18}" fill="hsl(${(hue + 140) % 360} 60% 60%)"/>
      <rect x="${40 + (i * 13) % 300}" y="${300 + (i * 7) % 120}" width="260" height="70" fill="hsl(${(hue + 220) % 360} 50% 75%)"/>
      <text x="40" y="90" font-size="72" font-family="sans-serif" fill="white">${i}</text>
    </svg>`
    pending.push(() => sharp(Buffer.from(svg)).jpeg({ quality: 72 }).toFile(file))
  }
  // 限并行：sharp 自带线程池，不把 CPU 吃满
  for (let i = 0; i < pending.length; i += 4) await Promise.all(pending.slice(i, i + 4).map(run => run()))
  return paths
}

function promptDocument(text) {
  return { version: 1, type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}

/** 混合图片、生成结果、视频、文字与生成节点；每 20 个一组的比例固定。 */
function buildGraph(count, images, videoPath) {
  const columns = Math.ceil(Math.sqrt(count * 1.8))
  const nodes = []
  const edges = []
  for (let i = 0; i < count; i += 1) {
    const kind = i % 20
    const base = { id: `scale-${i}`, position: { x: (i % columns) * SPACING_X, y: Math.floor(i / columns) * SPACING_Y } }
    if (kind < 9) {
      nodes.push({ ...base, type: 'uploadNode', data: { displayName: `图片 ${i}`, imageUrl: images[i], previewImageUrl: null, aspectRatio: '3:2', isSizeManuallyAdjusted: false, sourceFileName: `scale-${i}.jpg` } })
    } else if (kind < 12) {
      nodes.push({ ...base, type: 'exportImageNode', data: { displayName: `结果 ${i}`, imageUrl: images[i], previewImageUrl: null, aspectRatio: '3:2' } })
    } else if (kind === 12) {
      nodes.push({ ...base, type: 'videoUploadNode', data: { displayName: `视频 ${i}`, videoUrl: videoPath, previewImageUrl: null, aspectRatio: '16:9', durationSec: null, sourceFileName: 'plain_video.mp4', isSizeManuallyAdjusted: false } })
    } else if (kind < 15) {
      nodes.push({ ...base, type: 'textAnnotationNode', data: { content: `备注 ${i}：${PROMPT.slice(0, 48)}` } })
    } else {
      const prompt = `${PROMPT}#${i}`
      nodes.push({ ...base, type: kind < 18 ? 'imageNode' : 'videoGenNode', data: { displayName: `镜头 ${i}`, prompt, promptDocument: promptDocument(prompt) } })
      for (const source of [i - 15, i - 6]) {
        if (source < 0 || source % 20 >= 12) continue
        edges.push({ id: `scale-edge-${edges.length}`, source: `scale-${source}`, target: `scale-${i}`, sourceHandle: 'source', targetHandle: 'target', type: 'disconnectableEdge' })
      }
    }
  }
  for (const node of nodes) if (MEASURED[node.type]) node.measured = { ...MEASURED[node.type] }
  if (INTERACT && count > columns + 2) {
    // 交互核对要一个素材组：占第二行第三格，不写量得尺寸，顺带走一遍“没量过的节点”的路径
    const slot = columns + 2
    const replaced = nodes[slot].id
    nodes[slot] = { id: INTERACT_GROUP_ID, type: 'assetGroupNode', position: nodes[slot].position, data: { displayName: '素材组', memberOrder: [], coverMemberId: null, bindings: [] } }
    // 再要一个没填提示词的生成节点（第二行第五格）：从工具栏运行它会在提交前被拒
    const emptySlot = columns + 4
    const emptyReplaced = nodes[emptySlot].id
    nodes[emptySlot] = { id: INTERACT_EMPTY_PROMPT_ID, type: 'imageNode', position: nodes[emptySlot].position, measured: MEASURED.imageNode && { ...MEASURED.imageNode }, data: { displayName: '没填提示词', prompt: '' } }
    for (let index = edges.length - 1; index >= 0; index -= 1) if ([replaced, emptyReplaced].includes(edges[index].source) || [replaced, emptyReplaced].includes(edges[index].target)) edges.splice(index, 1)
  }
  return { nodes, edges, columns, width: columns * SPACING_X, height: Math.ceil(count / columns) * SPACING_Y }
}

function summarize(intervals) {
  const sorted = [...intervals].sort((a, b) => a - b)
  const at = ratio => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] : 0
  const total = sorted.reduce((sum, value) => sum + value, 0)
  return {
    frames: sorted.length,
    fps: total > 0 ? Number((sorted.length * 1000 / total).toFixed(1)) : 0,
    p50: Number(at(0.5).toFixed(1)), p95: Number(at(0.95).toFixed(1)), max: Number((sorted.at(-1) || 0).toFixed(1)),
    over50: sorted.filter(value => value > 50).length, over100: sorted.filter(value => value > 100).length,
  }
}

async function startSampler(page) {
  await page.evaluate(() => {
    const state = { intervals: [], loaf: [], running: true, previous: performance.now() }
    if (PerformanceObserver.supportedEntryTypes?.includes('long-animation-frame')) {
      state.observer = new PerformanceObserver(list => { for (const entry of list.getEntries()) state.loaf.push(entry.duration) })
      state.observer.observe({ type: 'long-animation-frame' })
    }
    const tick = () => {
      if (!state.running) return
      const now = performance.now()
      state.intervals.push(now - state.previous)
      state.previous = now
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    window.__scaleBenchSampler = state
  })
}

async function stopSampler(page) {
  const sample = await page.evaluate(() => {
    const state = window.__scaleBenchSampler
    state.running = false
    state.observer?.disconnect()
    return { intervals: state.intervals.slice(1), loaf: state.loaf }
  })
  return { ...summarize(sample.intervals), longFrames: sample.loaf.length, longFrameMaxMs: Math.round(Math.max(0, ...sample.loaf)) }
}

const CPU_METRICS = ['ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'TaskDuration']

async function readCpuMetrics(session) {
  const { metrics } = await session.send('Performance.getMetrics')
  return Object.fromEntries(CPU_METRICS.map(name => [name, metrics.find(metric => metric.name === name)?.value ?? 0]))
}

/** 采样帧间隔，同时记录这段时间主线程在脚本、布局、样式上各花了多少毫秒。 */
async function measure(page, drive, { profile = false } = {}) {
  const session = await page.context().newCDPSession(page)
  await session.send('Performance.enable')
  if (profile) { await session.send('Profiler.enable'); await session.send('Profiler.start') }
  const before = await readCpuMetrics(session)
  const started = Date.now()
  await startSampler(page)
  await drive()
  const sample = await stopSampler(page)
  const after = await readCpuMetrics(session)
  const elapsed = Date.now() - started
  sample.mainThread = Object.fromEntries(CPU_METRICS.map(name => [name.replace('Duration', 'Ms'), Math.round((after[name] - before[name]) * 1000)]))
  sample.elapsedMs = elapsed
  if (profile) {
    const { profile: cpu } = await session.send('Profiler.stop')
    const self = new Map()
    const interval = (cpu.endTime - cpu.startTime) / Math.max(1, cpu.samples.length) / 1000
    const byId = new Map(cpu.nodes.map(node => [node.id, node]))
    for (const id of cpu.samples) {
      const frame = byId.get(id).callFrame
      const key = `${frame.functionName || '(anonymous)'} ${path.basename(frame.url)}:${frame.lineNumber}`
      self.set(key, (self.get(key) ?? 0) + interval)
    }
    sample.topSelfMs = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([key, ms]) => `${Math.round(ms)} ${key}`)
  }
  await session.detach().catch(() => undefined)
  return sample
}

async function readViewport(page) {
  return await page.evaluate(() => {
    const transform = getComputedStyle(document.querySelector('.react-flow__viewport')).transform
    const matrix = new DOMMatrixReadOnly(transform)
    return { x: matrix.e, y: matrix.f, zoom: matrix.a }
  })
}

/** 以画布中心为锚连续滚轮：先拉到最远，再推到近景，再拉回最远。 */
async function driveFastZoom(page, center, { steps = 26, delta = 160, interval = 16 } = {}) {
  await page.mouse.move(center.x, center.y)
  for (const direction of [1, -1, 1, -1, 1]) {
    for (let i = 0; i < steps; i += 1) {
      await page.mouse.wheel(0, direction * delta)
      await sleep(interval)
    }
  }
}

async function drivePan(page, center, durationMs = 2500) {
  await page.mouse.move(center.x + 500, center.y)
  await page.mouse.down({ button: 'middle' })
  const steps = Math.floor(durationMs / 12)
  for (let i = 0; i < steps; i += 1) {
    // 来回扫两趟，保证路径一直压在内容上
    const phase = (i / steps) * 4
    const offset = phase < 1 ? phase : phase < 3 ? 2 - phase : phase - 4
    await page.mouse.move(center.x + 500 - (offset + 1) * 500, center.y + Math.sin(i / 20) * 120)
    await sleep(12)
  }
  await page.mouse.up({ button: 'middle' })
}

/** 录一段时间线，按事件名汇总渲染进程各线程的耗时（事件有嵌套，数字只用来看谁占大头）。 */
async function traceSummary(page, drive) {
  const session = await page.context().newCDPSession(page)
  const events = []
  session.on('Tracing.dataCollected', payload => { events.push(...payload.value) })
  await session.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'cc', 'gpu', 'blink'] } })
  await drive()
  const done = new Promise(resolve => session.once('Tracing.tracingComplete', resolve))
  await session.send('Tracing.end')
  await done
  await session.detach().catch(() => undefined)
  const threads = new Map()
  for (const event of events) if (event.ph === 'M' && event.name === 'thread_name') threads.set(`${event.pid}:${event.tid}`, event.args.name)
  const totals = new Map()
  for (const event of events) {
    if (event.ph !== 'X' || !event.dur) continue
    const thread = threads.get(`${event.pid}:${event.tid}`) ?? 'unknown'
    const key = `${thread} | ${event.name}`
    const entry = totals.get(key) ?? { ms: 0, count: 0 }
    entry.ms += event.dur / 1000; entry.count += 1
    totals.set(key, entry)
  }
  return [...totals.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, 40).map(([key, entry]) => `${Math.round(entry.ms)}ms x${entry.count} ${key}`)
}

/** 远景下按住视口中间附近的一个节点拖两秒，量拖动跟不跟手。 */
async function dragNodeNearCenter(page, box) {
  const view = await readViewport(page)
  const column = Math.round(((box.width / 2 - view.x) / view.zoom) / SPACING_X)
  const row = Math.round(((box.height / 2 - view.y) / view.zoom) / SPACING_Y)
  const x = box.x + (column * SPACING_X + 80) * view.zoom + view.x
  const y = box.y + (row * SPACING_Y + 80) * view.zoom + view.y
  await page.mouse.move(x - 2, y - 2)
  await page.mouse.move(x, y)
  await sleep(120)
  await page.mouse.down()
  for (let i = 1; i <= 120; i += 1) {
    await page.mouse.move(x + Math.sin(i / 19) * 160, y + Math.cos(i / 23) * 90 - 90)
    await sleep(14)
  }
  await page.mouse.up()
}

async function processMemory(app) {
  const metrics = await app.evaluate(({ app: electronApp }) => electronApp.getAppMetrics().map(metric => ({
    type: metric.type, name: metric.name ?? '', workingSetMB: Math.round(metric.memory.workingSetSize / 1024), privateMB: Math.round((metric.memory.privateBytes ?? 0) / 1024),
  })))
  const pick = type => metrics.filter(metric => metric.type === type).reduce((sum, metric) => sum + metric.privateMB, 0)
  return { rendererPrivateMB: pick('Tab'), gpuPrivateMB: pick('GPU'), browserPrivateMB: pick('Browser') }
}

async function captureFrames(page, directory, drive) {
  fs.mkdirSync(directory, { recursive: true })
  const session = await page.context().newCDPSession(page)
  const frames = []
  session.on('Page.screencastFrame', event => {
    frames.push({ data: event.data, timestamp: event.metadata.timestamp })
    void session.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => undefined)
  })
  await session.send('Page.startScreencast', { format: 'jpeg', quality: 80, everyNthFrame: 1 })
  await drive()
  await sleep(600)
  await session.send('Page.stopScreencast')
  await session.detach().catch(() => undefined)
  const first = frames[0]?.timestamp ?? 0
  frames.forEach((frame, index) => {
    const name = `${String(index).padStart(4, '0')}-${String(Math.round((frame.timestamp - first) * 1000)).padStart(6, '0')}ms.jpg`
    fs.writeFileSync(path.join(directory, name), Buffer.from(frame.data, 'base64'))
  })
  return frames.length
}

async function runScale(app, page, count, images) {
  const graph = buildGraph(count, images, SAMPLE_VIDEO)
  const id = `scale-bench-${count}-${Date.now()}`
  const name = `规模基准 ${count}`
  const created = await page.evaluate(value => window.henjiNative.testFixtures.createCanvas(value), {
    id, name, nodes: graph.nodes, edges: graph.edges, viewport: { x: 40, y: 40, zoom: 0.1 },
  })
  if (!created?.created) throw new Error(`夹具画布没有建成：${JSON.stringify(created)}`)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await waitForApp(page)
  await page.getByRole('button', { name: /画布|Canvas/ }).first().click()
  await page.locator(`[data-project-id="${id}"]:visible`).waitFor({ timeout: 30000 })

  const openStarted = Date.now()
  await page.locator(`[data-project-id="${id}"]:visible`).click()
  await page.waitForSelector('.react-flow', { timeout: 120000 })
  const firstPaintMs = Date.now() - openStarted
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const interactiveMs = Date.now() - openStarted
  // 首帧之后的后台工作（图片解码、缩略图排队、测量）还在跑，等它安静下来再量交互
  await sleep(Math.min(20000, 4000 + count * 1.5))
  const mounted = await page.evaluate(() => ({
    domNodes: document.querySelectorAll('.react-flow__node').length,
    elements: document.querySelectorAll('*').length,
    loadedImages: Array.from(document.querySelectorAll('.react-flow__node img')).filter(image => image.naturalWidth > 0).length,
    canvases: document.querySelectorAll('.react-flow canvas').length,
    bodies: Array.from(document.querySelectorAll('.react-flow__node')).filter(node => node.querySelector('.canvas-node-paint-frame')).length,
  }))
  if (process.env.SCALE_PRINT_SIZES === '1') {
    const sizes = await page.evaluate(async (docId) => {
      const doc = await window.henjiNative.testFixtures.readCanvas(docId)
      const byType = {}
      for (const node of doc.nodes) if (node.measured && !byType[node.type]) byType[node.type] = node.measured
      return byType
    }, id)
    console.log('sizes', JSON.stringify(sizes))
  }

  if (process.env.SCALE_CSS) await page.addStyleTag({ content: process.env.SCALE_CSS })
  const box = await page.locator('.react-flow').boundingBox()
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const result = { count, edges: graph.edges.length, firstPaintMs, interactiveMs, mounted, viewportSize: { width: Math.round(box.width), height: Math.round(box.height) } }

  if (INTERACT) {
    result.interaction = await runInteractionChecks(page, { docId: id, graph, sizes: MEASURED, outDir: OUT_DIR, groupId: INTERACT_GROUP_ID, emptyPromptId: INTERACT_EMPTY_PROMPT_ID })
    return result
  }

  result.memoryAfterOpen = await processMemory(app)
  if (TRACE) result.traceIdle = await traceSummary(page, () => sleep(2000))
  if (process.env.SCALE_TRACE === 'pan' || process.env.SCALE_TRACE === 'near') result.tracePan = await traceSummary(page, () => drivePan(page, center, 800))
  result.idleFar = await measure(page, () => sleep(1500), { profile: PROFILE })
  result.panFar = await measure(page, () => drivePan(page, center), { profile: PROFILE })
  result.dragFar = await measure(page, () => dragNodeNearCenter(page, box), { profile: PROFILE })
  // 近景：推到约 60% 停一会儿让正文挂上，再连续平移
  await page.mouse.move(center.x, center.y)
  for (let i = 0; i < 8; i += 1) { await page.mouse.wheel(0, -160); await sleep(30) }
  await sleep(2500)
  result.nearZoom = (await readViewport(page)).zoom
  result.nearBodies = await page.evaluate(() => document.querySelectorAll('.react-flow__node .canvas-node-paint-frame').length)
  result.panNear = await measure(page, () => drivePan(page, center), { profile: PROFILE })
  // 截一次画布区域要多久（主进程截图、编码、传回渲染层）：近景里有正文还没存过画面时，停稳后会做这件事
  result.captureMs = await page.evaluate(async (rect) => {
    const started = performance.now()
    for (let round = 0; round < 3; round += 1) await createImageBitmap(new Blob([(await window.henjiNative.media.captureWindowRegion(rect)).jpeg], { type: 'image/jpeg' }))
    return Math.round((performance.now() - started) / 3)
  }, { x: box.x, y: box.y, width: box.width, height: box.height }).catch(() => null)
  if (process.env.SCALE_TRACE === 'near') result.traceNear = await traceSummary(page, () => drivePan(page, center, 800))
  if (CAPTURE_FRAMES) {
    // 近景平移逐帧：起步（正文换成远景层代画）、途中、停稳（正文盖回来）都在里面
    const directory = path.join(OUT_DIR, `frames-near-${count}`)
    fs.rmSync(directory, { recursive: true, force: true })
    await sleep(2500)
    result.capturedNearFrames = await captureFrames(page, directory, async () => { await sleep(300); await drivePan(page, center, 1200); await sleep(900) })
  }
  await sleep(600)
  await page.screenshot({ path: path.join(OUT_DIR, `near-${count}.png`) })
  // 之后的滚轮都落在节点之间的空白处：正文里的输入区不响应画布缩放，停在上面会量成“缩放没动”。
  // 空白处要在平移结束之后找：平移不回到原位，之前找的点这时可能已经压在节点上
  const gap = await findPanePoint(page, { preferRatioX: 0.5, preferRatioY: 0.5 })
  if (!gap) throw new Error('近景下没找到节点之间的空白处，滚轮缩放量不了')
  await page.mouse.move(gap.x, gap.y)
  for (let i = 0; i < 12; i += 1) { await page.mouse.wheel(0, 160); await sleep(30) }
  await sleep(500)
  const zoomedOut = (await readViewport(page)).zoom
  if (!(zoomedOut < result.nearZoom * 0.5)) throw new Error(`滚轮没有改变缩放（${result.nearZoom} → ${zoomedOut}），快速缩放量不了`)
  result.zoomFast = await measure(page, () => driveFastZoom(page, gap), { profile: PROFILE })
  await sleep(800)
  result.viewportAfterZoom = await readViewport(page)
  result.memory = await processMemory(app)
  result.jsHeapMB = await page.evaluate(() => Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576))

  if (CAPTURE_FRAMES) {
    const directory = path.join(OUT_DIR, `frames-${count}`)
    fs.rmSync(directory, { recursive: true, force: true })
    result.capturedFrames = await captureFrames(page, directory, () => driveFastZoom(page, gap, { steps: 26, delta: 160, interval: 16 }))
    result.framesDirectory = directory
  }

  await page.screenshot({ path: path.join(OUT_DIR, `far-${count}.png`) })
  return result
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const images = await ensureImages(Math.max(...SCALES))
  const results = []
  // 每个规模单独启动一次：互不带着上一档的内存与缓存
  for (const count of SCALES) {
    const app = await launchElectronApp({
      mainEntry: MAIN_ENTRY, cwd: ROOT, useElectronApi: true, skipOnboarding: true,
      extraEnv: { HENJI_DEV_DISPLAY_POINT: DISPLAY_POINT },
      extraArgs: HOLD_PORT ? [`--remote-debugging-port=${HOLD_PORT}`] : [],
    })
    try {
      const page = app.page
      await waitForApp(page)
      await app.app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.maximize() })
      if (process.env.SCALE_UI_ZOOM) await app.app.evaluate(({ BrowserWindow }, zoom) => { BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(zoom) }, Number(process.env.SCALE_UI_ZOOM))
      await sleep(500)
      const result = await runScale(app.app, page, count, images)
      results.push(result)
      console.log(JSON.stringify(result))
      if (!INTERACT) console.log(formatScaleResult(result))
      fs.writeFileSync(path.join(OUT_DIR, 'result.json'), JSON.stringify(results, null, 2))
      if (HOLD_PORT) {
        // 留着窗口供别的脚本经调试端口接入；在结果目录里放一个名为 stop 的文件即退出
        const stopFile = path.join(OUT_DIR, 'stop')
        fs.rmSync(stopFile, { force: true })
        console.log(`holding on port ${HOLD_PORT}; touch ${stopFile} to exit`)
        while (!fs.existsSync(stopFile)) await sleep(1000)
        fs.rmSync(stopFile, { force: true })
      }
    } finally {
      await app.close()
    }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
