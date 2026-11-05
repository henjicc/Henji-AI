/* eslint-disable @typescript-eslint/no-var-requires -- CJS 巡检入口由 Node 直接加载。 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const net = require('node:net')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const sharp = require('sharp')
const { loadTypeScript } = require('../check-persistence-compat.cjs')
const { openVideoEditFixture, readVideoEditFile } = require('./uiInspectionVideoEditDocuments.cjs')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope, readAllMedia } = require('./uiInspectionMcpClient.cjs')

/**
 * 助手取帧的远跳闭环：标舞台的快照、自动舞台的快照、舞台页面滚动文档、普通绘制（背景图退回、文档滚动含延后、样式与脚本平滑滚动、4 倍大合成层、
 * 自己在动的 30fps 动画页）各放一页重内容，经正式 observe_video_edit_frame 跨段、远跳取帧，核对时间条码是这一刻、画面没有大片露出页面的黑底。
 * 动画页另外实测取帧时与空闲时的画面数量和 CPU、显卡占用，空闲时不应持续出画面。
 * 证据：.ui-tour/cache/video-edit-web-observe/evidence.json 与同目录 PNG。
 */
const ROOT = path.resolve('.ui-tour/cache/video-edit-web-observe')
const WIDTH = 1920, HEIGHT = 1080, FPS = 30, SECONDS = 60, SECTIONS = 60
/** 一段的帧数；每种页面占相邻两段，第二段的页面时刻接在第一段前面，跨剪点就是一次远跳。 */
const SEGMENT = SECONDS / 2 * FPS
/** 占用采样窗口。 */
const USAGE_WINDOW_MS = 5000
const BLACK_LUMA = 10, BLANK_FRACTION = 0.02
/** 联系表每格还盖着时间码的黑底标签。 */
const BLANK_CELL_FRACTION = 0.05

const SOURCE = `export default {
  name: '网页远跳验收', kind: 'generator', mode: 'dynamic', width: ${WIDTH}, height: ${HEIGHT},
  params: [{ key: 'app', type: 'image', title: '网页' }],
  draw(ctx, time, params, width, height, assets) {
    if (assets.app) ctx.drawImage(assets.app, 0, 0, width, height)
  }
}
`

/**
 * 黑底的长页：每一屏亮底铺满，seek 时当场重建这一屏的卡片（模糊、背景模糊、阴影、预先解码的大图），新内容都要重新栅格。
 * 任何没画完的块都露出黑底，画面右上角 16 格条码是页面时刻的毫秒数。
 */
function pageHtml(kind) {
  const stage = kind.startsWith('stage') ? 'data-henji-stage' : ''
  const compositor = kind.startsWith('compositor-scroll')
  const animated = kind === 'animated'
  const scroll = kind === 'compositor-scroll-late' ? 'requestAnimationFrame(() => window.scrollTo(0, top))' : kind === 'compositor-scroll-script' ? "window.scrollTo({ top, behavior: 'smooth' })" : compositor ? 'window.scrollTo(0, top)' : kind === 'stage-scroll' ? 'document.getElementById("scroller").scrollTop = top; window.scrollTo(0, top)' : 'document.getElementById("scroller").scrollTop = top'
  const sheet = compositor
    ? `#scroller { height: ${SECTIONS * HEIGHT}px }`
    : `${kind === 'stage-scroll' ? '' : `html, body { height: ${HEIGHT}px; overflow: hidden }`} #scroller { position: absolute; inset: 0; overflow: hidden }`
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${kind}</title>
<style>
  html, body { margin: 0; background: black; }
  html::-webkit-scrollbar { display: none; }
  ${kind === 'compositor' || kind === 'compositor-big' || kind === 'compositor-heavy' || animated ? 'html { background-image: linear-gradient(black, black); }' : ''}
  ${kind === 'compositor-scroll-smooth' ? 'html { scroll-behavior: smooth; }' : ''}
  #ticker { position: fixed; left: 40px; bottom: 40px; width: 240px; height: 240px; z-index: 5; background: white; }
  ${sheet}
  .section { position: relative; width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; }
  .card { position: absolute; width: 300px; height: 160px; border-radius: 28px; color: white; font: 700 42px sans-serif; box-shadow: 0 24px 80px rgb(255 240 160 / .55); }
  .glass { backdrop-filter: blur(24px) saturate(1.4); background: rgb(255 255 255 / .18); }
  .soft { filter: blur(3px) drop-shadow(0 0 30px rgb(255 255 255 / .6)); }
  .layer { position: absolute; left: 0; top: 0; width: ${WIDTH}px; height: ${HEIGHT}px; will-change: transform; pointer-events: none; background: linear-gradient(rgb(255 255 255 / .02), rgb(0 0 0 / .02)); }
  .art { position: absolute; left: 0; width: ${WIDTH}px; height: ${HEIGHT / 2}px; }
  #code { position: fixed; left: ${WIDTH - 384}px; top: 0; width: 384px; height: 48px; display: flex; z-index: 10; }
  #code i { display: block; width: 24px; height: 48px; }
</style>
<body><div ${stage} style="position:${kind === 'stage-scroll' ? 'fixed' : 'absolute'};left:0;top:0;width:${WIDTH}px;background:black;${compositor ? '' : `height:${HEIGHT}px;overflow:hidden`}">
<div id="scroller"></div><div id="code"></div>${animated ? '<div id="ticker"></div>' : ''}</div>${kind === 'stage-scroll' ? `<div style="position:absolute;top:0;width:1px;height:${SECTIONS * HEIGHT}px"></div>` : ''}
<script>
  const scroller = document.getElementById('scroller'), code = document.getElementById('code')
  const sections = Array.from({ length: ${SECTIONS} }, (_, i) => {
    const section = document.createElement('div'); section.className = 'section'
    section.style.background = 'linear-gradient(135deg, hsl(' + (i * 37 % 360) + ' 70% 58%), hsl(' + ((i * 37 + 90) % 360) + ' 70% 42%))'
    scroller.appendChild(section); return section
  })
  const bits = Array.from({ length: 16 }, () => code.appendChild(document.createElement('i')))
  const arts = []
  async function makeArt(index) {
    const canvas = document.createElement('canvas'); canvas.width = ${WIDTH * 2}; canvas.height = ${HEIGHT}
    const context = canvas.getContext('2d')
    const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height)
    gradient.addColorStop(0, 'hsl(' + index * 60 + ' 80% 60%)'); gradient.addColorStop(1, 'hsl(' + (index * 60 + 120) + ' 80% 45%)')
    context.fillStyle = gradient; context.fillRect(0, 0, canvas.width, canvas.height)
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
    const image = new Image(); image.src = URL.createObjectURL(blob); await image.decode()
    arts.push(image)
  }
  function fill(i) {
    const section = sections[i], children = []
    const art = arts[i % arts.length].cloneNode(); art.className = 'art'; art.style.top = (i % 2 ? 0 : ${HEIGHT / 2}) + 'px'; children.push(art)
    for (let n = 0; n < ${kind.startsWith('compositor') && kind !== 'compositor-heavy' ? 24 : 90}; n++) {
      const card = document.createElement('div'); card.className = 'card ' + (n % 3 === 0 ? 'glass' : n % 3 === 1 ? 'soft' : '')
      card.style.left = (n * 211 % ${WIDTH - 200}) + 'px'; card.style.top = (n * 127 % ${HEIGHT - 120}) + 'px'
      if (n % 3) card.style.background = 'radial-gradient(circle at 30% 30%, hsl(' + ((i * 37 + n * 11) % 360) + ' 85% 70%), hsl(' + ((i * 37 + n * 23) % 360) + ' 75% 45%))'
      card.textContent = i + '-' + n
      children.push(card)
    }
    for (let n = 0; n < ${kind === 'compositor-big' ? 12 : 0}; n++) { const layer = document.createElement('div'); layer.className = 'layer'; children.push(layer) }
    section.replaceChildren(...children)
  }
  ${animated ? "let turn = 0; setInterval(() => { document.getElementById('ticker').style.transform = 'rotate(' + (turn += 7) + 'deg)' }, 33)" : ''}
  window.henjiWeb = { duration: ${SECONDS}, ready: Promise.all([0, 1, 2, 3, 4, 5].map(makeArt)), seek(t) {
    const index = Math.min(${SECTIONS - 1}, Math.floor(t))
    for (const section of sections) if (section.firstChild && section !== sections[index]) section.replaceChildren()
    fill(index)
    const top = index * ${HEIGHT}
    ${scroll}
    const ms = Math.round(t * 1000)
    bits.forEach((bit, n) => { bit.style.background = ms >> (15 - n) & 1 ? 'white' : 'black' })
  } }
</script>
</body></html>
`
}

/** 16 格条码 → 毫秒，按格子中心偏上取样。 */
function timeCodeOf(data, info, x0 = 0, y0 = 0, width = info.width) {
  const unit = width / WIDTH
  let ms = 0
  for (let bit = 0; bit < 16; bit++) {
    const x = x0 + Math.round((WIDTH - 384 + 12 + bit * 24) * unit), y = y0 + Math.round(12 * unit)
    const offset = (y * info.width + x) * info.channels
    if ((data[offset] + data[offset + 1] + data[offset + 2]) / 3 > 128) ms |= 1 << (15 - bit)
  }
  return ms
}

function blankFraction(data, info, x0 = 0, y0 = 0, x1 = info.width, y1 = info.height) {
  let black = 0, total = 0
  for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
    const offset = (y * info.width + x) * info.channels
    if (0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2] < BLACK_LUMA) black++
    total++
  }
  return black / total
}

/**
 * 一段时间内这一页的画面数量与进程占用。percentCPUUsage 是两次取样之间的值；显卡占用读 nvidia-smi 的进程采样，
 * 没有这个工具时为 null。
 */
async function usageOver(app, title, ms) {
  const usage = await app.evaluate(async ({ app: electronApp, webContents }, { title, ms }) => {
    const contents = webContents.getAllWebContents().filter(item => item.isOffscreen() && item.getTitle() === title)
    const pages = await Promise.all(contents.map(async item => ({ item, pid: item.getOSProcessId(), paints: 0, snapshot: await item.executeJavaScriptInIsolatedWorld(1001, [{ code: '!!window.__henjiWebSourceSnapshot' }], false) })))
    for (const page of pages) { page.count = () => { page.paints++ }; page.item.on('paint', page.count) }
    electronApp.getAppMetrics()
    await new Promise(resolve => setTimeout(resolve, ms))
    const metrics = electronApp.getAppMetrics()
    for (const page of pages) if (!page.item.isDestroyed()) page.item.off('paint', page.count)
    const pids = new Set(pages.map(page => page.pid))
    const cpu = filter => Number(metrics.filter(filter).reduce((sum, row) => sum + row.cpu.percentCPUUsage, 0).toFixed(1))
    return { pages: pages.map(page => ({ paints: page.paints, snapshot: page.snapshot })), paints: pages.reduce((sum, page) => sum + page.paints, 0), pageCpu: cpu(row => pids.has(row.pid)), gpuProcessCpu: cpu(row => row.type === 'GPU'), mainCpu: cpu(row => row.type === 'Browser'), pids: metrics.map(row => row.pid) }
  }, { title, ms })
  let gpuUtil = null
  try {
    const table = execFileSync('nvidia-smi', ['pmon', '-c', '2', '-s', 'u'], { encoding: 'utf8', windowsHide: true, timeout: 15000 })
    const rows = table.split(/\r?\n/).filter(line => !line.startsWith('#')).map(line => line.trim().split(/\s+/))
    gpuUtil = rows.filter(row => usage.pids.includes(Number(row[1]))).reduce((sum, row) => sum + (Number(row[3]) || 0), 0) / 2
  } catch { /* 没有 NVIDIA 工具时只留进程占用。 */ }
  const { pids: _pids, ...rest } = usage
  return { ...rest, gpuUtil }
}

function createVideoEditWebObserveScene() {
  return {
    id: 'video-edit-web-observe', surface: '剪辑', name: '剪辑-网页远跳取帧', writesUserData: true,
    async setup(page, app) {
      assert.ok(await app.evaluate(() => Boolean(process.env.HENJI_ISOLATED_APP_DATA)), '远跳取帧验收使用隔离资料目录')
      fs.rmSync(ROOT, { recursive: true, force: true }); fs.mkdirSync(ROOT, { recursive: true })
      const evidence = { completed: false, program: [], grid: [], snapshot: {}, usage: {} }
      const store = () => fs.writeFileSync(path.join(ROOT, 'evidence.json'), JSON.stringify(evidence, null, 2))
      const { createVideoEditTestDocument } = loadTypeScript('src/core/videoEdit/testFixtures.ts')
      const project = createVideoEditTestDocument('网页远跳验收')
      Object.assign(project.sequences[0], { width: WIDTH, height: HEIGHT, frameRate: { numerator: FPS, denominator: 1 } })
      const seeded = await openVideoEditFixture(page, project)
      const documentRef = { kind: 'video_edit.document', id: seeded.documentId }
      const sequenceRef = { kind: 'video_edit.sequence', id: `${seeded.documentId}:${project.sequences[0].id}` }
      const kinds = ['stage', 'automatic', 'stage-scroll', 'compositor', 'compositor-heavy', 'compositor-scroll', 'compositor-scroll-late', 'compositor-scroll-smooth', 'compositor-scroll-script', 'compositor-big', 'animated']
      const entries = kinds.map(kind => {
        const folder = path.join(seeded.projectPath, '素材', '网页', kind)
        fs.mkdirSync(folder, { recursive: true })
        const entry = path.join(folder, 'index.html')
        fs.writeFileSync(entry, pageHtml(kind))
        return entry
      })
      let client
      try {
        const port = await new Promise((resolve, reject) => { const server = net.createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)) }) })
        await disableMcp(page)
        await page.evaluate(value => window.henjiNative.mcp.configure({ enabled: true, port: value }), port)
        const identity = await authorizeMcpConnection(page, { name: '网页远跳验收' })
        client = await connectMcpClient(identity.config, 'Henji web observe Reality')
        const change = async changes => {
          const refs = [...new Map(changes.map(item => { const ref = item.target ?? item.parent; return [`${ref.kind}:${ref.id}`, ref] })).values()]
          const baselines = await Promise.all(refs.map(ref => callTool(client, 'read_application_entity', { ref })))
          const result = await callTool(client, 'change_application_entities', operationEnvelope(baselines, { summary: '网页远跳验收', changes }))
          assert.equal(result.verificationState, 'verified', JSON.stringify(result))
          return result
        }
        await change([{ kind: 'create_items', entityType: 'video_edit.code_material', parent: documentRef, items: [{ properties: { 'video_edit.code_material.files': { 'web.js': SOURCE }, 'video_edit.code_material.entry': 'web.js' } }] }])
        const material = readVideoEditFile(seeded.file).items.find(item => item.kind === 'code')
        assert.ok(material, '正式创建未写入代码素材')
        const half = SECONDS / 2
        const reference = (entry, src) => ({ kind: 'web', path: entry, width: WIDTH, height: HEIGHT, scale: entry.includes('compositor-big') ? 4 : 2, spans: [{ from: 0, to: half, src }] })
        const clip = (start, app) => ({ 'video_edit.clip.item_id': material.id, 'video_edit.clip.name': material.name, 'video_edit.clip.kind': 'code', 'video_edit.clip.start': start, 'video_edit.clip.duration': SEGMENT, 'video_edit.clip.track': 1, 'video_edit.clip.code_parameters': { app } })
        const items = entries.flatMap((entry, index) => [clip(index * 2 * SEGMENT, reference(entry, half)), clip((index * 2 + 1) * SEGMENT, reference(entry, 0))])
        await change([{ kind: 'create_items', entityType: 'video_edit.clip', parent: sequenceRef, items: items.map(properties => ({ properties })) }])
        /** 第一段放页面后半，第二段放前半：跨剪点就是往回跳半个页面。 */
        const expectedMs = local => Math.round((local < SEGMENT ? half + local / FPS : (local - SEGMENT) / FPS) * 1000)
        // 确定性的远跳次序：相邻两次相差很多屏，覆盖两段。
        const hops = Array.from({ length: 24 }, (_, n) => (n * 677 + 41) % (2 * SEGMENT))
        const observe = async target => {
          const started = Date.now()
          const observed = await callTool(client, 'observe_video_edit_frame', { documentRef, target: { ...target, sequenceRef }, maxWidth: WIDTH })
          assert.equal(observed.data?.verification?.verified, true, JSON.stringify(observed))
          const media = await readAllMedia(client, observed.data.resultRef, { chunkBytes: 65536 })
          return { bytes: media.bytes, data: observed.data, elapsedMs: Date.now() - started }
        }
        evidence.usage.noPage = await usageOver(app, 'animated', USAGE_WINDOW_MS)
        for (const [index, kind] of kinds.entries()) {
          const base = index * 2 * SEGMENT
          if (kind === 'animated') {
            const shot = await observe({ kind: 'program', frame: base + hops[0] })
            assert.ok(shot.bytes.length)
            evidence.usage.afterOpen = await usageOver(app, kind, USAGE_WINDOW_MS)
            const during = usageOver(app, kind, USAGE_WINDOW_MS)
            const until = Date.now() + USAGE_WINDOW_MS
            store()
            let frames = 0
            while (Date.now() < until) { await observe({ kind: 'program', frame: base + hops[++frames % hops.length] }) }
            evidence.usage.capturing = { ...await during, observed: frames }
            await new Promise(resolve => setTimeout(resolve, 1000))
            evidence.usage.idle = await usageOver(app, kind, USAGE_WINDOW_MS)
            store()
          }
          for (const local of hops) {
            const frame = base + local
            const shot = await observe({ kind: 'program', frame })
            const { data, info } = await sharp(shot.bytes).raw().toBuffer({ resolveWithObject: true })
            const row = { kind, frame, blank: blankFraction(data, info), timeCode: timeCodeOf(data, info), expected: expectedMs(local), elapsedMs: shot.elapsedMs }
            if (row.blank > BLANK_FRACTION) fs.writeFileSync(path.join(ROOT, `${kind}-${frame}.png`), shot.bytes)
            evidence.program.push(row); store()
          }
          // 一次取跨段的多帧：与实战记录里出现问题的调用同形。
          const frames = hops.slice(0, 12).map(local => base + local)
          const sheet = await observe({ kind: 'frames', frames })
          const { data, info } = await sharp(sheet.bytes).raw().toBuffer({ resolveWithObject: true })
          const { columns, rows } = sheet.data.contactSheet
          const cellWidth = Math.floor(info.width / columns), cellHeight = Math.floor(info.height / rows)
          const cells = sheet.data.contactSheet.frames.map((frame, cell) => {
            const x = cell % columns * cellWidth, y = Math.floor(cell / columns) * cellHeight
            return { frame, blank: blankFraction(data, info, x, y, x + cellWidth, y + cellHeight), timeCode: timeCodeOf(data, info, x, y, cellWidth), expected: expectedMs(frame - base) }
          })
          if (cells.some(cell => cell.blank > BLANK_CELL_FRACTION)) fs.writeFileSync(path.join(ROOT, `${kind}-sheet.png`), sheet.bytes)
          evidence.grid.push({ kind, elapsedMs: sheet.elapsedMs, cells })
          evidence.snapshot[kind] = await app.evaluate(async ({ webContents }, title) => {
            for (const contents of webContents.getAllWebContents()) {
              if (contents.isOffscreen() && contents.getTitle() === title) return contents.executeJavaScriptInIsolatedWorld(1001, [{ code: '!!window.__henjiWebSourceSnapshot' }], false)
            }
            return null
          }, kind)
          store()
        }
        evidence.summary = Object.fromEntries(kinds.map(kind => {
          const rows = evidence.program.filter(row => row.kind === kind)
          const cells = evidence.grid.filter(row => row.kind === kind).flatMap(row => row.cells)
          return [kind, { blankPrograms: rows.filter(row => row.blank > BLANK_FRACTION).length, wrongTimeCodes: rows.filter(row => row.timeCode !== row.expected).length, programs: rows.length, blankCells: cells.filter(cell => cell.blank > BLANK_CELL_FRACTION).length, wrongCellCodes: cells.filter(cell => cell.timeCode !== cell.expected).length, cells: cells.length }]
        }))
        evidence.completed = true; store()
        for (const [kind, row] of Object.entries(evidence.summary)) assert.deepEqual([row.blankPrograms, row.wrongTimeCodes, row.blankCells, row.wrongCellCodes], [0, 0, 0, 0], `${kind} 取到了没画好的画面：${JSON.stringify(row)}`)
        // 页面按标题认：stage 与 automatic 走快照，其余（含舞台页面滚动文档后降级，粘到页面重载）走普通绘制。
        assert.deepEqual(evidence.snapshot, Object.fromEntries(kinds.map(kind => [kind, kind === 'stage' || kind === 'automatic'])))
        if (evidence.usage.idle) assert.ok(evidence.usage.idle.paints < USAGE_WINDOW_MS / 1000, `动画页空闲时还在持续出画面：${JSON.stringify(evidence.usage.idle)}`)
      } finally {
        store(); await client?.close(); await disableMcp(page)
      }
    },
  }
}

module.exports = { createVideoEditWebObserveScene }
