/* eslint-disable @typescript-eslint/no-var-requires -- CJS 巡检入口由 Node 直接加载。 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { ffmpegPath, ffprobePath } = require('./mediaBinaries.cjs')
const { loadTypeScript } = require('../check-persistence-compat.cjs')
const { openVideoEditFixture, readVideoEditFile } = require('./uiInspectionVideoEditDocuments.cjs')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope } = require('./uiInspectionMcpClient.cjs')

/**
 * 网页逐字样片：技能文档推荐的写法走一遍正式导出。每个字一个图层，用 pose 动，运动模糊和效果库的发光都由宿主处理。
 * 证据：.ui-tour/cache/video-edit-web-glyph-sample/ 里的 sample.mp4 与联系表 sheet.png。
 */
const ROOT = path.resolve('.ui-tour/cache/video-edit-web-glyph-sample')
const WIDTH = 1920, HEIGHT = 1080, FPS = 30, FRAMES = 150
const SOURCE = `import { glow } from "henji-effects"
const clamp = value => Math.min(1, Math.max(0, value))
const settle = value => { const p = clamp(value) - 1; return 1 + p * p * (2.4 * p + 1.4) }
/** 绕自身中心旋转缩放：pose 的变换绕画布原点，这里补回中心。 */
const around = (cx, cy, rotation, scale) => ({ rotation, scale, x: cx - scale * (cx * Math.cos(rotation) - cy * Math.sin(rotation)), y: cy - scale * (cx * Math.sin(rotation) + cy * Math.cos(rotation)) })
export default {
  name: "网页逐字样片", kind: "generator", mode: "dynamic", width: ${WIDTH}, height: ${HEIGHT},
  webText: { text: ["#title", "#body"] },
  params: [{ key: "clean", type: "image", title: "干净背景" }, { key: "text", type: "image", title: "文字层" }],
  layers(params, width, height, assets, info) {
    const layers = []
    if (assets.clean) layers.push({ id: "背景", bounds: [0, 0, width, height], draw(ctx) { ctx.drawImage(assets.clean, 0, 0, width, height) } })
    const web = info.web && info.web.text
    if (!assets.text) return layers
    const title = web && web.text && web.text["#title"], body = web && web.text && web.text["#body"]
    if (!title || title.status !== "ready" || !body || body.status !== "ready") {
      layers.push({ id: "文字", bounds: [0, 0, width, height], draw(ctx) { ctx.drawImage(assets.text, 0, 0, width, height) } })
      return layers
    }
    const map = web.imageMapping, kx = width / map.contentWidth, ky = height / map.contentHeight
    const [a, , , d, e, f] = map.viewportToImage
    const glyph = (result, name, index, pose, effects) => {
      const cell = result.geometry.cells[index], pivot = result.geometry.graphemes[index].pivot
      if (!cell || !pivot) return
      const [x, y, w, h] = cell, cx = (pivot[0] * a + e) * kx, cy = (pivot[1] * d + f) * ky
      layers.push({
        id: name + index, bounds: [x * kx, y * ky, (x + w) * kx, (y + h) * ky], effects,
        draw(ctx) { ctx.drawImage(assets.text, x, y, w, h, x * kx, y * ky, w * kx, h * ky) },
        pose: t => pose(t, cx, cy),
      })
    }
    title.geometry.graphemes.forEach((_, index) => glyph(title, "标题", index, (t, cx, cy) => {
      const enter = t - .25 - index * .08
      if (enter < 0) return null
      const p = settle(enter / .6), shape = around(cx, cy, (1 - p) * (index % 2 ? .5 : -.5), .6 + .4 * p)
      // 3 秒后一道波从左到右扫过标题
      const wave = Math.max(0, Math.sin(clamp((t - 3 - index * .09) / .5) * Math.PI))
      return { ...shape, y: shape.y + (1 - p) * 120 - wave * 34, opacity: clamp(enter / .25) }
    }, t => [glow({ strength: 30 * Math.max(0, Math.sin(clamp((t - 3 - index * .09) / .5) * Math.PI)) + 20 * (1 - clamp((t - .25 - index * .08) / .9)), radius: 22 })]))
    body.geometry.graphemes.forEach((_, index) => glyph(body, "正文", index, t => {
      const enter = t - 1.3 - index * .028
      return enter < 0 ? null : { x: 0, y: (1 - settle(enter / .4)) * 22, opacity: clamp(enter / .2) }
    }))
    return layers
  },
}
`

function createVideoEditWebGlyphSampleScene() {
  return {
    id: 'video-edit-web-glyph-sample', surface: '剪辑', name: '剪辑-网页逐字样片', writesUserData: true,
    async setup(page, app, { capture }) {
      assert.ok(await app.evaluate(() => Boolean(process.env.HENJI_ISOLATED_APP_DATA)), '网页逐字样片使用隔离资料目录')
      fs.rmSync(ROOT, { recursive: true, force: true }); fs.mkdirSync(ROOT, { recursive: true })
      const { createVideoEditTestDocument } = loadTypeScript('src/core/videoEdit/testFixtures.ts')
      const project = createVideoEditTestDocument('网页逐字样片')
      Object.assign(project.sequences[0], { width: WIDTH, height: HEIGHT, frameRate: { numerator: FPS, denominator: 1 } })
      const seeded = await openVideoEditFixture(page, project)
      const webFolder = path.join(seeded.projectPath, '素材', '网页', '逐字样片')
      fs.mkdirSync(webFolder, { recursive: true })
      fs.copyFileSync(path.resolve('tests/fixtures/web-source/glyph-sample/index.html'), path.join(webFolder, 'index.html'))
      const entry = path.join(webFolder, 'index.html')
      const documentRef = { kind: 'video_edit.document', id: seeded.documentId }
      const sequenceRef = { kind: 'video_edit.sequence', id: `${seeded.documentId}:${project.sequences[0].id}` }
      let client
      try {
        await disableMcp(page)
        const identity = await authorizeMcpConnection(page, { name: '网页逐字样片' })
        client = await connectMcpClient(identity.config, 'Henji glyph sample Reality')
        const change = async changes => {
          const refs = [...new Map(changes.map(item => { const ref = item.target ?? item.parent; return [`${ref.kind}:${ref.id}`, ref] })).values()]
          const baselines = await Promise.all(refs.map(ref => callTool(client, 'read_application_entity', { ref })))
          const result = await callTool(client, 'change_application_entities', operationEnvelope(baselines, { summary: '网页逐字样片', changes }))
          assert.equal(result.verificationState, 'verified', JSON.stringify(result))
        }
        await change([{ kind: 'create_items', entityType: 'video_edit.code_material', parent: documentRef, items: [{ properties: { 'video_edit.code_material.files': { 'web.js': SOURCE }, 'video_edit.code_material.entry': 'web.js' } }] }])
        const material = readVideoEditFile(seeded.file).items.find(item => item.kind === 'code')
        const view = { kind: 'web', path: entry, width: WIDTH, height: HEIGHT, scale: 1, time: 0 }, selectors = ['#title', '#body']
        await change([{ kind: 'create_items', entityType: 'video_edit.clip', parent: sequenceRef, items: [{ properties: {
          'video_edit.clip.item_id': material.id, 'video_edit.clip.name': material.name, 'video_edit.clip.kind': 'code', 'video_edit.clip.start': 0, 'video_edit.clip.duration': FRAMES, 'video_edit.clip.track': 1,
          'video_edit.clip.code_parameters': { clean: { ...view, layer: { hide: selectors } }, text: { ...view, layer: { only: selectors } } },
        } }] }])
        const baseline = await callTool(client, 'read_application_entity', { ref: documentRef })
        const exported = await callTool(client, 'export_video_edit', operationEnvelope([baseline], { documentRef, range: { startFrame: 0, endFrame: FRAMES }, settings: { format: 'mp4', width: WIDTH, height: HEIGHT, fps: FPS, videoBitrateMbps: 30, audioBitrateKbps: 192, fit: 'fit', loudness: null, encoderPreference: 'software', audioEnabled: false, addToLibrary: false } }))
        const jobId = (exported.data ?? exported.result?.data)?.queue?.[0]?.id
        assert.ok(jobId, JSON.stringify(exported))
        let job
        for (let attempt = 0; attempt < 1200; attempt++) {
          job = (await callTool(client, 'query_video_edit_export', { documentRef, taskId: jobId, detail: 'full' })).data.queue.find(value => value.id === jobId)
          if (job && ['completed', 'failed', 'cancelled'].includes(job.state)) break
          await page.waitForTimeout(500)
        }
        assert.equal(job?.state, 'completed', JSON.stringify(job))
        const output = path.join(ROOT, 'sample.mp4')
        fs.copyFileSync(job.path, output)
        const video = JSON.parse(execFileSync(ffprobePath, ['-v', 'error', '-show_streams', '-of', 'json', output], { encoding: 'utf8', windowsHide: true })).streams.find(stream => stream.codec_type === 'video')
        assert.equal(Number(video.nb_frames), FRAMES)
        execFileSync(ffmpegPath, ['-v', 'error', '-y', '-i', output, '-vf', 'select=not(mod(n\\,15)),scale=640:-1,tile=3x4', '-frames:v', '1', path.join(ROOT, 'sheet.png')], { windowsHide: true, timeout: 120000 })
        await capture('web-glyph-sample')
      } finally {
        await client?.close().catch(() => undefined)
        await disableMcp(page).catch(() => undefined)
      }
    },
  }
}

module.exports = { createVideoEditWebGlyphSampleScene }
