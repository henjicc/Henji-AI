const assert = require('node:assert/strict')
const fs = require('node:fs')
const net = require('node:net')
const path = require('node:path')
const sharp = require('sharp')
const { execFileSync } = require('node:child_process')
const { ffmpegPath, ffprobePath } = require('./mediaBinaries.cjs')
const { loadTypeScript } = require('../check-persistence-compat.cjs')
const { openVideoEditFixture, readVideoEditFile } = require('./uiInspectionVideoEditDocuments.cjs')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope } = require('./uiInspectionMcpClient.cjs')

/**
 * 网页画面（代码图片参数 kind:'web'）在真实 Electron 里的闭环：验收页（tests/fixtures/web-source）放进项目的
 * 素材/网页/验收页，经正式 MCP 写入代码素材与片段参数；节目监视器前后跳着取帧，按页面右上角的时间条码核对每一帧
 * 是这一刻、同一时刻两次取帧逐像素相同、作者代码按 info.web 的元素矩形画出的框跟着按钮走；第二个片段用取景
 * region 推近 3 倍、6 倍栅格；最后导出 4K，逐帧核对条码并留下画面供目视检查清晰度。
 * 证据：node_modules/.cache/video-edit-web-source/evidence.json 与同目录 PNG。
 */
const ROOT = path.resolve('node_modules/.cache/video-edit-web-source')
const WIDTH = 3840, HEIGHT = 2160, FPS = 30, SECONDS = 6
const FULL_FRAMES = SECONDS * FPS, ZOOM_FRAMES = 2 * FPS
const SOURCE = `export default {
  name: '网页画面验收', kind: 'generator', mode: 'dynamic', width: ${WIDTH}, height: ${HEIGHT},
  params: [{ key: 'app', type: 'image', title: '网页' }],
  draw(ctx, time, params, width, height, assets, info) {
    const page = assets.app
    if (!page) return
    ctx.drawImage(page, 0, 0, width, height)
    const web = info.web && info.web.app
    const box = web && web.boxes['#send']
    if (!box) return
    const sx = width / web.region[2], sy = height / web.region[3]
    ctx.strokeStyle = '#ff00ff'; ctx.lineWidth = 8
    ctx.strokeRect((box[0] - web.region[0]) * sx - 12, (box[1] - web.region[1]) * sy - 12, box[2] * sx + 24, box[3] * sy + 24)
  }
}
`

/** 右上角 16 格（每格 24 CSS 像素）黑白条码 → 毫秒；`scale` 是画面像素与页面 CSS 像素之比。 */
async function readTimeCode(file, scale = WIDTH / 1920) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  let ms = 0
  for (let bit = 0; bit < 16; bit++) {
    const x = Math.round((1920 - 384 + 12 + bit * 24) * scale * info.width / WIDTH), y = Math.round(12 * scale * info.height / HEIGHT)
    const offset = (y * info.width + x) * 3
    if ((data[offset] + data[offset + 1] + data[offset + 2]) / 3 > 128) ms |= 1 << (15 - bit)
  }
  return ms
}
/** 画面里品红框的外接范围（作者代码按 boxes 画的），没有时为 null。 */
async function magentaBounds(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const o = (y * info.width + x) * 3
    if (data[o] > 220 && data[o + 1] < 40 && data[o + 2] > 220) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
  }
  return x1 < 0 ? null : { x: x0 / info.width * WIDTH, y: y0 / info.height * HEIGHT, width: (x1 - x0 + 1) / info.width * WIDTH, height: (y1 - y0 + 1) / info.height * HEIGHT }
}
/** 两幅画面的最大通道差与相同像素比例。 */
async function difference(a, b) {
  const [left, right] = await Promise.all([a, b].map(file => sharp(file).removeAlpha().raw().toBuffer()))
  let maximumDelta = 0, differing = 0
  for (let index = 0; index < left.length; index += 3) {
    const delta = Math.max(Math.abs(left[index] - right[index]), Math.abs(left[index + 1] - right[index + 1]), Math.abs(left[index + 2] - right[index + 2]))
    if (delta) { differing++; maximumDelta = Math.max(maximumDelta, delta) }
  }
  return { maximumDelta, identicalPixelPercent: 100 - differing * 300 / left.length }
}

function createVideoEditWebSourceScene() {
  return {
    id: 'video-edit-web-source', surface: '剪辑', name: '剪辑-网页画面', writesUserData: true,
    async setup(page, app, { capture }) {
      assert.ok(await app.evaluate(() => Boolean(process.env.HENJI_ISOLATED_APP_DATA)), '网页画面验收使用隔离资料目录')
      fs.rmSync(ROOT, { recursive: true, force: true }); fs.mkdirSync(ROOT, { recursive: true })
      const evidence = { completed: false, preview: [], zoom: [], export: null }
      const store = () => fs.writeFileSync(path.join(ROOT, 'evidence.json'), JSON.stringify(evidence, null, 2))
      const { createVideoEditTestDocument } = loadTypeScript('src/core/videoEdit/testFixtures.ts')
      const project = createVideoEditTestDocument('网页画面验收')
      Object.assign(project.sequences[0], { width: WIDTH, height: HEIGHT, frameRate: { numerator: FPS, denominator: 1 } })
      const seeded = await openVideoEditFixture(page, project)
      evidence.project = seeded
      const webFolder = path.join(seeded.projectPath, '素材', '网页', '验收页')
      fs.mkdirSync(webFolder, { recursive: true })
      fs.copyFileSync(path.resolve('tests/fixtures/web-source/index.html'), path.join(webFolder, 'index.html'))
      const entry = path.join(webFolder, 'index.html')
      const documentRef = { kind: 'video_edit.document', id: seeded.documentId }
      const sequenceRef = { kind: 'video_edit.sequence', id: `${seeded.documentId}:${project.sequences[0].id}` }
      let client
      try {
        // 本机可能有正在运行的痕迹占着默认端口：隔离实例换一个空闲端口。
        const port = await new Promise((resolve, reject) => { const server = net.createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)) }) })
        await disableMcp(page)
        await page.evaluate(value => window.henjiNative.mcp.configure({ enabled: true, port: value }), port)
        const identity = await authorizeMcpConnection(page, { name: '网页画面验收' })
        client = await connectMcpClient(identity.config, 'Henji web source Reality')
        const change = async changes => {
          const refs = [...new Map(changes.map(item => { const ref = item.target ?? item.parent; return [`${ref.kind}:${ref.id}`, ref] })).values()]
          const baselines = await Promise.all(refs.map(ref => callTool(client, 'read_application_entity', { ref })))
          const result = await callTool(client, 'change_application_entities', operationEnvelope(baselines, { summary: '网页画面验收', changes }))
          assert.equal(result.verificationState, 'verified', JSON.stringify(result))
          return result
        }
        await change([{ kind: 'create_items', entityType: 'video_edit.code_material', parent: documentRef, items: [{ properties: { 'video_edit.code_material.files': { 'web.js': SOURCE }, 'video_edit.code_material.entry': 'web.js' } }] }])
        const material = readVideoEditFile(seeded.file).items.find(item => item.kind === 'code')
        assert.ok(material, '正式创建未写入代码素材')
        const full = { kind: 'web', path: entry, width: 1920, height: 1080, scale: 2, boxes: ['#send', '#title'] }
        // 推近 3 倍：只渲染卡片一带 640×360 的取景，6 倍栅格，画面仍是 3840×2160；从页面第 1 秒起跟随片段。
        const zoom = { kind: 'web', path: entry, width: 1920, height: 1080, region: [1220, 180, 640, 360], scale: 6, spans: [{ from: 0, to: 2, src: 1 }], boxes: ['#card'] }
        const clip = (start, duration, app) => ({ 'video_edit.clip.item_id': material.id, 'video_edit.clip.name': material.name, 'video_edit.clip.kind': 'code', 'video_edit.clip.start': start, 'video_edit.clip.duration': duration, 'video_edit.clip.track': 1, 'video_edit.clip.code_parameters': { app } })
        await change([{ kind: 'create_items', entityType: 'video_edit.clip', parent: sequenceRef, items: [{ properties: clip(0, FULL_FRAMES, full) }, { properties: clip(FULL_FRAMES, ZOOM_FRAMES, zoom) }] }])
        const saved = readVideoEditFile(seeded.file)
        evidence.storedReference = saved.sequences[0].clips.map(item => item.code?.parameters?.app)
        store()

        const playback = frame => change([{ kind: 'set_properties', entityType: documentRef.kind, target: documentRef, properties: { 'video_edit.document.program_playback': { frame, playing: false, playbackDirection: 1 } } }])
        const canvas = page.locator('canvas[aria-label="剪辑画面"]')
        const shoot = async (frame, name) => {
          const started = Date.now()
          await playback(frame)
          await page.waitForFunction(value => document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame === String(value), frame, { timeout: 120000 })
          const png = await canvas.evaluate(element => element.toDataURL('image/png'))
          const file = path.join(ROOT, `${name}.png`)
          fs.writeFileSync(file, Buffer.from(png.split(',')[1], 'base64'))
          return { frame, file, elapsedMs: Date.now() - started }
        }
        // 前后跳：每一帧的条码都应是这一刻；同一帧两次取到的画面逐像素相同。
        const order = [90, 30, 150, 60, 30, 120, 90, 0, 179]
        for (const [index, frame] of order.entries()) {
          const shot = await shoot(frame, `preview-${index}-${frame}`)
          shot.timeCode = await readTimeCode(shot.file)
          shot.expected = Math.round(frame / FPS * 1000)
          shot.box = await magentaBounds(shot.file)
          evidence.preview.push(shot); store()
          assert.equal(shot.timeCode, shot.expected, `第 ${frame} 帧（第 ${index + 1} 次）取到的不是这一刻：${shot.timeCode}ms`)
        }
        await capture('web-source-preview')
        const twice = frame => evidence.preview.filter(shot => shot.frame === frame).map(shot => shot.file)
        // Chromium 给带 CSS 动画的元素栅格时与之前的状态有关：柔和阴影边缘可能差 1/255，其余逐像素相同。按内部一致性标准的最大差判定。
        evidence.repeat = { 90: await difference(...twice(90)), 30: await difference(...twice(30)) }
        store()
        assert.ok(evidence.repeat[90].maximumDelta <= 2 && evidence.repeat[30].maximumDelta <= 2, `同一时刻两次取帧超出内部一致性标准：${JSON.stringify(evidence.repeat)}`)
        // 发送按钮 2 秒时被按下：过渡把它左移 420 CSS 像素并放大，框跟着走（画面 2 倍于页面）。
        const before = evidence.preview.find(shot => shot.frame === 30).box, after = evidence.preview.find(shot => shot.frame === 150).box
        assert.ok(before && after, '没有画出元素矩形框')
        assert.ok(Math.abs(before.x - (980 * 2 - 12)) < 6 && Math.abs(before.y - (740 * 2 - 12)) < 6, `按下前的框位置不对：${JSON.stringify(before)}`)
        assert.ok(before.x - after.x > 700, `框没有跟着按钮左移：${JSON.stringify({ before, after })}`)

        // 页面进程崩溃后不永久失败：下一次取帧自动重新载入页面，取到的仍是这一刻。
        const webLogs = () => page.evaluate(async () => (await window.henjiNative.logging.queryLogEvents({ date: new Date().toISOString().slice(0, 10), domainPrefix: 'main.web_source', limit: 200 })).events.map(event => event.event))
        const goneBefore = (await webLogs()).filter(event => event === 'web_source.page.gone').length
        const crashed = await app.evaluate(({ webContents }) => {
          let count = 0
          for (const contents of webContents.getAllWebContents()) if (contents.isOffscreen() && contents.getURL().startsWith('https://web-source.henji.invalid')) { contents.forcefullyCrashRenderer(); count++ }
          return count
        })
        assert.ok(crashed > 0, '没有找到网页来源的离屏页面')
        for (let attempt = 0; attempt < 40 && (await webLogs()).filter(event => event === 'web_source.page.gone').length <= goneBefore; attempt++) await page.waitForTimeout(250)
        const recovered = await shoot(45, 'preview-after-crash')
        recovered.timeCode = await readTimeCode(recovered.file)
        evidence.crash = { crashed, ...recovered }
        store()
        assert.equal(recovered.timeCode, 1500, `页面进程崩溃后取到的不是这一刻：${recovered.timeCode}ms`)

        for (const frame of [FULL_FRAMES + 15, FULL_FRAMES + 45]) {
          const shot = await shoot(frame, `zoom-${frame}`)
          evidence.zoom.push(shot); store()
        }
        await capture('web-source-zoom')

        const baseline = await callTool(client, 'read_application_entity', { ref: documentRef })
        const exportStarted = Date.now()
        const total = FULL_FRAMES + ZOOM_FRAMES
        const exported = await callTool(client, 'export_video_edit', operationEnvelope([baseline], { documentRef, range: { startFrame: 0, endFrame: total }, settings: { format: 'mp4', width: WIDTH, height: HEIGHT, fps: FPS, videoBitrateMbps: 80, audioBitrateKbps: 192, fit: 'fit', loudness: null, encoderPreference: 'software', audioEnabled: false, addToLibrary: false } }))
        const jobId = (exported.data ?? exported.result?.data)?.queue?.[0]?.id
        assert.ok(jobId, JSON.stringify(exported))
        let job
        for (let attempt = 0; attempt < 1200; attempt++) {
          job = (await callTool(client, 'query_video_edit_export', { documentRef, taskId: jobId, detail: 'full' })).data.queue.find(value => value.id === jobId)
          if (job && ['completed', 'failed', 'cancelled'].includes(job.state)) break
          await page.waitForTimeout(500)
        }
        assert.equal(job?.state, 'completed', JSON.stringify(job))
        const output = path.join(ROOT, 'export.mp4')
        fs.copyFileSync(job.path, output)
        const video = JSON.parse(execFileSync(ffprobePath, ['-v', 'error', '-show_streams', '-of', 'json', output], { encoding: 'utf8', windowsHide: true })).streams.find(stream => stream.codec_type === 'video')
        evidence.export = { elapsedMs: Date.now() - exportStarted, msPerFrame: (Date.now() - exportStarted) / total, width: video.width, height: video.height, frames: Number(video.nb_frames), checks: [] }
        assert.equal(video.width, WIDTH); assert.equal(video.height, HEIGHT); assert.equal(Number(video.nb_frames), total)
        for (const frame of [0, 1, 59, 60, 61, 119, 150, 179]) {
          const file = path.join(ROOT, `export-${frame}.png`)
          execFileSync(ffmpegPath, ['-v', 'error', '-y', '-i', output, '-vf', `select=eq(n\\,${frame})`, '-frames:v', '1', file], { windowsHide: true, timeout: 120000 })
          const timeCode = await readTimeCode(file)
          evidence.export.checks.push({ frame, timeCode, expected: Math.round(frame / FPS * 1000) })
          store()
          assert.equal(timeCode, Math.round(frame / FPS * 1000), `导出第 ${frame} 帧不是这一刻`)
        }
        execFileSync(ffmpegPath, ['-v', 'error', '-y', '-i', output, '-vf', `select=eq(n\\,${FULL_FRAMES + 45})`, '-frames:v', '1', path.join(ROOT, `export-zoom-${FULL_FRAMES + 45}.png`)], { windowsHide: true, timeout: 120000 })
        const logs = await page.evaluate(async () => (await window.henjiNative.logging.queryLogEvents({ date: new Date().toISOString().slice(0, 10), domainPrefix: 'main.web_source', limit: 200 })).events.map(event => ({ event: event.event, level: event.level, context: event.context })))
        evidence.logs = logs
        evidence.completed = true; store()
      } finally { store(); await client?.close(); await disableMcp(page) }
    },
  }
}
module.exports = { createVideoEditWebSourceScene }
