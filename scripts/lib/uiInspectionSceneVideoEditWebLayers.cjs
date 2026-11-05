/* eslint-disable @typescript-eslint/no-var-requires -- CJS 巡检入口由 Node 直接加载。 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const sharp = require('sharp')
const { loadTypeScript } = require('../check-persistence-compat.cjs')
const { openVideoEditFixture, readVideoEditFile } = require('./uiInspectionVideoEditDocuments.cjs')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope, readAllMedia } = require('./uiInspectionMcpClient.cjs')

/**
 * 网页逐字：同一网页拆成“只留文字”和“藏文字”两层，按宿主给的字素格子把每个字切开单独摆。
 * 核对：所有字不动时与网页原画面一致；字移开后原位露出干净背景、没有残字；几种不同的效果用同一套写法。
 * 证据：.ui-tour/cache/video-edit-web-layers/evidence.json 与同目录 PNG。
 */
const ROOT = path.resolve('.ui-tour/cache/video-edit-web-layers')
const WIDTH = 1920, HEIGHT = 1080, FPS = 30, CLIP_FRAMES = 30
const MODES = ['still', 'move', 'spin', 'fade']
const SOURCE = `export default {
  name: '网页逐字验收', kind: 'generator', mode: 'dynamic', width: ${WIDTH}, height: ${HEIGHT},
  webText: { text: ['#title', '#body'] },
  params: [{ key: 'clean', type: 'image', title: '干净背景' }, { key: 'text', type: 'image', title: '文字层' }, { key: 'mode', type: 'number', title: '效果', default: 0, min: 0, max: 3, step: 1 }],
  draw(ctx, time, params, width, height, assets, info) {
    if (!assets.clean || !assets.text) return
    ctx.drawImage(assets.clean, 0, 0, width, height)
    const web = info.web && info.web.text
    for (const selector of ['#title', '#body']) {
      const result = web && web.text && web.text[selector]
      // 预览回退到上一幅时位置还没到：这一帧先把文字层整张画上，不留空。
      if (!result || result.status !== 'ready') { ctx.drawImage(assets.text, 0, 0, width, height); return }
      const map = web.imageMapping, [a, , , d, e, f] = map.viewportToImage
      result.geometry.cells.forEach((cell, index) => {
        if (!cell) return
        const [x, y, w, h] = cell, pivot = result.geometry.graphemes[index].pivot
        ctx.save()
        // 位移写在换算之前，是画布像素；格子是画面像素，监视器按显示档缩小网页时画面比画布小，这里换算。
        if (params.mode === 1) ctx.translate(0, index % 2 ? -90 : 90)
        ctx.scale(width / map.contentWidth, height / map.contentHeight)
        if (params.mode === 2) { const px = pivot[0] * a + e, py = pivot[1] * d + f; ctx.translate(px, py); ctx.rotate((index % 5 - 2) * .35); ctx.scale(1.3, 1.3); ctx.translate(-px, -py) }
        if (params.mode === 3) { ctx.globalAlpha = index % 3 ? 1 : .15 }
        ctx.drawImage(assets.text, x, y, w, h, x, y, w, h)
        ctx.restore()
      })
    }
  }
}
`
const PLAIN = `export default {
  name: '网页原样', kind: 'generator', mode: 'dynamic', width: ${WIDTH}, height: ${HEIGHT},
  params: [{ key: 'app', type: 'image', title: '网页' }],
  draw(ctx, time, params, width, height, assets) { if (assets.app) ctx.drawImage(assets.app, 0, 0, width, height) }
}
`

async function pixels(file) { return sharp(file).removeAlpha().raw().toBuffer() }
/** 区域 [x, y, w, h] 内两幅画面的最大通道差与差异像素占比。 */
async function compare(a, b, region = [0, 0, WIDTH, HEIGHT]) {
  const [left, right] = await Promise.all([pixels(a), pixels(b)])
  let maximum = 0, differing = 0, total = 0
  for (let y = region[1]; y < region[1] + region[3]; y++) for (let x = region[0]; x < region[0] + region[2]; x++) {
    const o = (y * WIDTH + x) * 3
    const delta = Math.max(Math.abs(left[o] - right[o]), Math.abs(left[o + 1] - right[o + 1]), Math.abs(left[o + 2] - right[o + 2]))
    total++
    if (delta > 2) differing++
    maximum = Math.max(maximum, delta)
  }
  return { maximum, differingPercent: 100 * differing / total }
}

function createVideoEditWebLayersScene() {
  return {
    id: 'video-edit-web-layers', surface: '剪辑', name: '剪辑-网页逐字', writesUserData: true,
    async setup(page, app, { capture }) {
      assert.ok(await app.evaluate(() => Boolean(process.env.HENJI_ISOLATED_APP_DATA)), '网页逐字验收使用隔离资料目录')
      fs.rmSync(ROOT, { recursive: true, force: true }); fs.mkdirSync(ROOT, { recursive: true })
      const evidence = { completed: false }
      const store = () => fs.writeFileSync(path.join(ROOT, 'evidence.json'), JSON.stringify(evidence, null, 2))
      const { createVideoEditTestDocument } = loadTypeScript('src/core/videoEdit/testFixtures.ts')
      const project = createVideoEditTestDocument('网页逐字验收')
      Object.assign(project.sequences[0], { width: WIDTH, height: HEIGHT, frameRate: { numerator: FPS, denominator: 1 } })
      const seeded = await openVideoEditFixture(page, project)
      const webFolder = path.join(seeded.projectPath, '素材', '网页', '逐字')
      fs.mkdirSync(webFolder, { recursive: true })
      fs.copyFileSync(path.resolve('tests/fixtures/web-source/layers/index.html'), path.join(webFolder, 'index.html'))
      const entry = path.join(webFolder, 'index.html')
      const documentRef = { kind: 'video_edit.document', id: seeded.documentId }
      const sequenceRef = { kind: 'video_edit.sequence', id: `${seeded.documentId}:${project.sequences[0].id}` }
      let client
      try {
        await disableMcp(page)
        const identity = await authorizeMcpConnection(page, { name: '网页逐字验收' })
        client = await connectMcpClient(identity.config, 'Henji web layers Reality')
        const change = async changes => {
          const refs = [...new Map(changes.map(item => { const ref = item.target ?? item.parent; return [`${ref.kind}:${ref.id}`, ref] })).values()]
          const baselines = await Promise.all(refs.map(ref => callTool(client, 'read_application_entity', { ref })))
          const result = await callTool(client, 'change_application_entities', operationEnvelope(baselines, { summary: '网页逐字验收', changes }))
          assert.equal(result.verificationState, 'verified', JSON.stringify(result))
          return result
        }
        const material = source => change([{ kind: 'create_items', entityType: 'video_edit.code_material', parent: documentRef, items: [{ properties: { 'video_edit.code_material.files': { 'web.js': source }, 'video_edit.code_material.entry': 'web.js' } }] }])
        await material(PLAIN); await material(SOURCE)
        const items = readVideoEditFile(seeded.file).items.filter(item => item.kind === 'code')
        assert.equal(items.length, 2, '正式创建未写入两个代码素材')
        const [plainItem, glyphItem] = items
        const view = { kind: 'web', path: entry, width: WIDTH, height: HEIGHT, scale: 1, time: 0 }
        const selectors = ['#title', '#body']
        const clip = (item, start, parameters) => ({ 'video_edit.clip.item_id': item.id, 'video_edit.clip.name': item.name, 'video_edit.clip.kind': 'code', 'video_edit.clip.start': start, 'video_edit.clip.duration': CLIP_FRAMES, 'video_edit.clip.track': 1, 'video_edit.clip.code_parameters': parameters })
        await change([{ kind: 'create_items', entityType: 'video_edit.clip', parent: sequenceRef, items: [
          { properties: clip(plainItem, 0, { app: view }) },
          ...MODES.map((_, index) => ({ properties: clip(glyphItem, CLIP_FRAMES * (index + 1), { clean: { ...view, layer: { hide: selectors } }, text: { ...view, layer: { only: selectors } }, mode: index }) })),
        ] }])
        evidence.storedLayer = readVideoEditFile(seeded.file).sequences[0].clips[1].code?.parameters?.text?.layer
        store()
        const shoot = async (frame, name) => {
          const started = Date.now()
          const observed = await callTool(client, 'observe_video_edit_frame', { documentRef, target: { kind: 'program', sequenceRef, frame }, maxWidth: WIDTH })
          assert.equal(observed.data?.verification?.verified, true, JSON.stringify(observed))
          const media = await readAllMedia(client, observed.data.resultRef, { chunkBytes: 65536 })
          const file = path.join(ROOT, `${name}.png`)
          fs.writeFileSync(file, media.bytes)
          evidence[`${name}Ms`] = Date.now() - started
          return file
        }
        const original = await shoot(0, 'original')
        const files = {}
        for (const [index, mode] of MODES.entries()) files[mode] = await shoot(CLIP_FRAMES * (index + 1), mode)
        await capture('web-layers')
        evidence.still = await compare(original, files.still); store()
        // 只有文字区域应该变：标题之上的空白区不受任何效果影响。
        evidence.moveOutside = await compare(original, files.move, [0, 0, WIDTH, 60]); store()
        evidence.moveTitle = await compare(original, files.move, [260, 230, 1400, 170])
        evidence.fadeTitle = await compare(original, files.fade, [260, 230, 1400, 170])
        evidence.spinTitle = await compare(original, files.spin, [260, 230, 1400, 170])
        store()
        assert.ok(evidence.still.differingPercent < .05, `所有字不动时与网页原画面不一致：${JSON.stringify(evidence.still)}`)
        assert.ok(evidence.moveOutside.maximum <= 2, `效果改到了文字以外：${JSON.stringify(evidence.moveOutside)}`)
        for (const key of ['moveTitle', 'fadeTitle', 'spinTitle']) assert.ok(evidence[key].differingPercent > 1, `${key} 没有改变文字：${JSON.stringify(evidence[key])}`)
        // 节目监视器也要出同样的画面，并记下实时播放拆层片段时实际上屏的帧数。
        const playback = state => change([{ kind: 'set_properties', entityType: documentRef.kind, target: documentRef, properties: { 'video_edit.document.program_playback': { playbackDirection: 1, ...state } } }])
        await playback({ frame: CLIP_FRAMES * 2 + 5, playing: false })
        await page.waitForFunction(frame => { const surface = document.querySelector('canvas[aria-label="剪辑画面"]'); return surface?.dataset.presentedFrame === String(frame) && surface.dataset.approximate !== 'true' }, CLIP_FRAMES * 2 + 5, { timeout: 120000 })
        await capture('web-layers-monitor')
        const shown = path.join(ROOT, 'monitor.png')
        const png = await page.locator('canvas[aria-label="剪辑画面"]').evaluate(element => element.toDataURL('image/png'))
        const shownBuffer = Buffer.from(png.split(',')[1], 'base64')
        fs.writeFileSync(shown, await sharp(shownBuffer).resize(WIDTH, HEIGHT).png().toBuffer())
        // 监视器按显示档缩小网页，边缘重采样后不可能逐像素相同：缩小到四分之一比大形状和位置。
        const small = async file => { const out = `${file}.small.png`; await sharp(file).resize(WIDTH / 4, HEIGHT / 4).png().toFile(out); return out }
        const quarter = async (a, b) => {
          const [left, right] = await Promise.all([a, b].map(async file => sharp(await small(file)).removeAlpha().raw().toBuffer()))
          let differing = 0
          for (let o = 0; o < left.length; o += 3) if (Math.max(Math.abs(left[o] - right[o]), Math.abs(left[o + 1] - right[o + 1]), Math.abs(left[o + 2] - right[o + 2])) > 32) differing++
          return { differingPercent: 300 * differing / left.length }
        }
        evidence.monitor = await quarter(files.move, shown); store()
        assert.ok(evidence.monitor.differingPercent < 2, `监视器与精确画面不一致：${JSON.stringify(evidence.monitor)}`)
        await playback({ frame: CLIP_FRAMES, playing: true })
        evidence.playback = await page.evaluate(async ({ from, seconds }) => {
          const surface = document.querySelector('canvas[aria-label="剪辑画面"]'), seen = new Set(), started = performance.now()
          while (performance.now() - started < seconds * 1000) { seen.add(surface.dataset.presentedFrame); await new Promise(requestAnimationFrame) }
          const frames = [...seen].map(Number).filter(frame => frame >= from)
          return { presented: frames.length, spanned: frames.length ? Math.max(...frames) - Math.min(...frames) + 1 : 0 }
        }, { from: CLIP_FRAMES, seconds: 3 })
        await playback({ frame: CLIP_FRAMES, playing: false })
        store()
        evidence.completed = true; store()
      } finally {
        await client?.close().catch(() => undefined)
        await disableMcp(page).catch(() => undefined)
      }
    },
  }
}

module.exports = { createVideoEditWebLayersScene }
