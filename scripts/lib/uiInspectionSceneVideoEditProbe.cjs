const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync } = require('node:child_process')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope } = require('./uiInspectionMcpClient.cjs')
const button = (page, name) => page.getByRole('button', { name, exact: true })
const menuItem = (page, name) => page.getByRole('menuitem', { name, exact: true })
const entry = (page, id) => page.locator(`[data-video-edit-project-entry="${id}"]`)
// Track rows span the 208px track header and the lanes; one frame is 2px at 30fps and zoom 1.
const trackRow = (page, index) => page.locator(`[data-video-edit-track][data-track-index="${index}"]`)
const TRACK_HEADER = 208
async function savedProject(page, file, matches, label) {
  const deadline = performance.now() + 5000
  let document
  do {
    document = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (matches(document)) return document
    await page.waitForTimeout(50)
  } while (performance.now() < deadline)
  assert.fail(`${label}：静默保存未到达预期内容，${JSON.stringify(document)}`)
}
async function dialogs(app, openPaths, savePath) {
  await app.evaluate(({ dialog }, values) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: values.openPaths })
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: values.savePath })
  }, { openPaths, savePath })
}
async function presented(page, frame) {
  try { await page.waitForFunction(frame => { const canvas = document.querySelector('canvas[aria-label="剪辑画面"]'); return canvas?.dataset.presentedFrame === String(frame) && canvas.dataset.scrubbing === 'false' }, frame, { timeout: 20000 }) }
  catch (error) {
    console.error('等待剪辑帧失败', frame, await page.getByLabel('剪辑画面', { exact: true }).evaluate(canvas => ({ ...canvas.dataset })), await page.getByRole('slider', { name: '剪辑时间定位' }).getAttribute('aria-valuenow'), (await page.locator('body').innerText()).slice(-1200))
    throw error
  }
}
async function seek(page, frame, fps) {
  const ruler = page.getByRole('slider', { name: '剪辑时间定位' })
  // Dockview's separator overlaps the outermost pixels. Reach boundary frames
  // through the ruler's real keyboard transport after clicking inside its body.
  await ruler.click({ position: { x: Math.max(6, frame * 60 / fps + 0.1), y: 12 } })
  let actual = Number(await ruler.getAttribute('aria-valuenow'))
  for (let remaining = Math.ceil(fps / 10) + 1; actual !== frame && remaining > 0; remaining--) {
    await ruler.press(actual > frame ? 'ArrowLeft' : 'ArrowRight')
    actual = Number(await ruler.getAttribute('aria-valuenow'))
  }
  assert.equal(actual, frame, '实际标尺与逐帧定位必须到达请求帧')
  await presented(page, frame)
}
function createVideoEditProbeScene() {
  return {
    id: 'video-edit-engine-probe', surface: '剪辑', name: '剪辑-工程与MCP合成导出闭环', writesUserData: true,
    // The fault phase denies writes on purpose; every other application error still fails the scene.
    expectedLogEvents: ['video_edit.save.failed'],
    setup: async (page, app, { capture }) => {
      const root = path.resolve('node_modules/.cache/video-edit-probe'); fs.mkdirSync(root, { recursive: true })
      const { ffmpegPath, ffprobePath } = require('./mediaBinaries.cjs')
      const ffmpeg = args => execFileSync(ffmpegPath, ['-v', 'error', '-y', ...args], { windowsHide: true, stdio: 'pipe' })
      const probe = file => JSON.parse(execFileSync(ffprobePath, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { windowsHide: true, encoding: 'utf8' }))
      const specs = [{ width: 1920, height: 1080, fps: 30 }, { width: 1920, height: 1080, fps: 60 }, { width: 3840, height: 2160, fps: 30 }, { width: 3840, height: 2160, fps: 60 }]
      for (const spec of specs) {
        spec.source = path.join(root, `${spec.width}-${spec.fps}.mp4`)
        if (!fs.existsSync(spec.source)) ffmpeg(['-f', 'lavfi', '-i', `testsrc2=size=${spec.width}x${spec.height}:rate=${spec.fps}`, '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '3', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20', '-g', String(spec.fps), '-pix_fmt', 'yuv420p', '-c:a', 'aac', spec.source])
      }
      const picture = path.join(root, 'card.png'); const sound = path.join(root, 'tone.wav')
      ffmpeg(['-f', 'lavfi', '-i', 'color=c=orange:size=320x180', '-frames:v', '1', picture])
      ffmpeg(['-f', 'lavfi', '-i', 'aevalsrc=0.125*sin(2*PI*(600*t+137*t*t)):s=48000:d=3', sound])
      const evidence = { machine: { cpu: os.cpus()[0].model, memoryBytes: os.totalmem(), os: os.version() }, cases: [] }
      evidence.runtime = await app.evaluate(async ({ app }) => ({ versions: process.versions, gpu: await app.getGPUInfo('basic'), memory: app.getAppMetrics() }))
      await button(page, '剪辑').click()
      const projectPath = path.join(root, 'closure.henji-video')
      await dialogs(app, [specs[0].source, sound], projectPath)
      // Import only creates project items (original paths); the asset-library image joins by drag.
      await button(page, '新建工程').click(); await button(page, '导入').click()
      let imported = await savedProject(page, projectPath, document => document.media.length === 2, '导入项目项保存')
      assert.equal(imported.sequences[0].clips.length, 0, '导入只创建项目项')
      await page.evaluate(async picture => { await window.henjiNative.assetLibrary.createAsset({ filePath: picture, mediaType: 'image', source: 'external', displayName: '素材库图片' }) }, picture)
      const list = page.getByLabel('项目项列表', { exact: true }); const listRect = await list.boundingBox()
      await button(page, '资产库').click()
      const card = page.locator('[data-asset-card]').filter({ hasText: '素材库图片' })
      await card.waitFor({ state: 'visible', timeout: 10000 }); await card.dragTo(list, { targetPosition: { x: 12, y: listRect.height - 30 } })
      imported = await savedProject(page, projectPath, document => document.media.length === 3, '资产库图片加入工程保存')
      await list.click({ position: { x: 12, y: listRect.height - 30 } }); await page.locator('[data-asset-floating-panel]').waitFor({ state: 'hidden' })
      const itemOf = kind => imported.items.find(item => imported.media.find(media => media.id === item.mediaId)?.kind === kind)
      const items = { video: itemOf('video'), image: itemOf('image'), audio: itemOf('audio') }
      // Menu edits: each item appended at the playhead in order, then a native text clip.
      for (const item of [items.video, items.video, items.image, items.audio]) {
        await entry(page, item.id).click(); await entry(page, item.id).click({ button: 'right' }); await menuItem(page, '添加到当前序列').click()
      }
      await button(page, '文字').click()
      try { await page.waitForFunction(() => ![...document.querySelectorAll('[role=alert]')].some(alert => alert.getClientRects().length && alert.textContent?.trim())) }
      catch (error) { await capture('video-edit-import-error'); throw new Error(`导入后界面报错：${await page.getByRole('alert').allTextContents()}`, { cause: error }) }
      await page.waitForTimeout(300)
      assert.equal(await button(page, '保存').count(), 0, '编辑后静默保存，无需保存按钮')
      // A video with sound places its picture plus a linked sound clip (task 2.6, as Premiere).
      const original = await savedProject(page, projectPath, document => document.sequences[0].clips.length === 7, '初始合成保存')
      assert.deepEqual(original.media.map(item => item.path.toLowerCase()).sort(), [specs[0].source, picture, sound].map(value => value.toLowerCase()).sort()); assert.equal(original.sequences[0].clips.length, 7)
      assert.deepEqual(original.sequences[0].clips.map(clip => [clip.kind, clip.sourceComponent ?? null]), [['video', 'video'], ['audio', 'audio'], ['video', 'video'], ['audio', 'audio'], ['image', null], ['audio', null], ['text', null]])
      for (const [picture, sound] of [[0, 1], [2, 3]]) assert.ok(original.sequences[0].clips[picture].linkId && original.sequences[0].clips[picture].linkId === original.sequences[0].clips[sound].linkId, '视频的画面与声音片段应链接')
      const drops = [
        { item: items.video, path: specs[0].source, kind: 'video', x: 120, track: 2 },
        { item: items.audio, path: sound, kind: 'audio', x: 180, track: 0 },
        { item: items.image, path: picture, kind: 'image', x: 240, track: 3, asset: true },
      ]
      for (const drop of drops) {
        const source = drop.asset ? page.locator('[data-asset-card]').filter({ hasText: '素材库图片' }) : entry(page, drop.item.id)
        if (drop.asset) { await button(page, '资产库').click(); await source.waitFor({ state: 'visible' }) }
        await source.dragTo(trackRow(page, drop.track), { targetPosition: { x: TRACK_HEADER + drop.x, y: 16 }, timeout: 10000 })
        if (drop.asset) await list.click({ position: { x: 12, y: listRect.height - 30 } })
        const count = drop.kind === 'video' ? 2 : 1
        const after = await savedProject(page, projectPath, document => document.sequences[0].clips.length === original.sequences[0].clips.length + count, `拖入 ${drop.kind} 保存`)
        const added = after.sequences[0].clips.slice(original.sequences[0].clips.length); const last = added.find(clip => clip.kind === drop.kind)
        assert.equal(last.kind, drop.kind); assert.equal(last.start, drop.x / 2); assert.equal(last.track, drop.track)
        if (drop.kind === 'video') { const voice = added.find(clip => clip.kind === 'audio'); assert.equal(voice.sourceComponent, 'audio'); assert.equal(voice.start, last.start); assert.equal(voice.track, 0); assert.ok(last.linkId && voice.linkId === last.linkId) }
        assert.equal(after.media.find(item => item.id === after.items.find(item => item.id === last.itemId).mediaId).path.toLowerCase(), drop.path.toLowerCase())
        assert.equal(after.media.length, original.media.length, '同一原路径或同一资产不应创建第二份素材')
        await button(page, '撤销').click(); await page.waitForTimeout(150)
        assert.equal((await savedProject(page, projectPath, document => document.sequences[0].clips.length === original.sequences[0].clips.length, `撤销拖入 ${drop.kind} 保存`)).sequences[0].clips.length, original.sequences[0].clips.length)
      }
      evidence.materialDrag = drops.map(({ kind, track }) => ({ kind, track, originalPathPreserved: true, undoVerified: true }))
      const identity = await authorizeMcpConnection(page, { name: '剪辑真实回环', allowWrites: true, allowDestructive: true })
      const client = await connectMcpClient(identity.config, 'Henji video edit Reality')
      try {
        const projectRef = { kind: 'video_edit.project', id: original.id }
        const clips = original.sequences[0].clips.map(item => ({ kind: 'video_edit.clip', id: `${original.id}:${item.id}` }))
        // Stack the appended clips at frame 0 in one public transaction: pictures on their own tracks, the first
        // video's sound at half volume, the second video's sound silent, the tone at a quarter.
        const changes = [{ duration: 60, track: 1 }, { duration: 60, track: 0, volume: 0.5 }, { duration: 60, track: 2, scale: 0.35, x: 0.25, y: -0.25, brightness: 0.6 }, { duration: 60, track: 0, volume: 0 }, { duration: 60, track: 3, scale: 0.18, x: -0.3, y: -0.3 }, { duration: 60, track: 0, volume: 0.25 }, { duration: 60, track: 4, text: 'Henji · 本地剪辑', y: 0.3 }]
          .map((values, index) => ({ kind: 'set_properties', entityType: 'video_edit.clip', target: clips[index], properties: Object.fromEntries(Object.entries({ start: 0, ...values }).map(([key, value]) => [`video_edit.clip.${key}`, value])) }))
        const baselines = []
        for (const ref of clips) baselines.push(await callTool(client, 'read_application_entity', { ref, propertyIds: ['video_edit.clip.start', 'video_edit.clip.duration', 'video_edit.clip.scale'] }))
        const changed = await callTool(client, 'change_application_entities', operationEnvelope(baselines, { summary: '双视频、图片、声音与文字合成', changes }))
        assert.equal(changed.executionState, 'completed', JSON.stringify(changed)); assert.equal(changed.verificationState, 'verified', JSON.stringify(changed))
        await presented(page, 0); await capture('video-edit-composition')
        await button(page, '撤销').click(); await page.waitForTimeout(150)
        assert.equal((await savedProject(page, projectPath, document => document.sequences[0].clips[2].scale === 1, '撤销 MCP 合成保存')).sequences[0].clips[2].scale, 1)
        await button(page, '重做').click(); await page.waitForTimeout(150)
        assert.equal((await savedProject(page, projectPath, document => document.sequences[0].clips[2].scale === 0.35, '重做 MCP 合成保存')).sequences[0].clips[2].scale, 0.35)
        await seek(page, 30, 30); await page.getByTitle('1920-30.mp4', { exact: true }).first().click(); await button(page, '点标注').click()
        await page.getByLabel('标注文字', { exact: true }).fill('检查叠加边缘')
        await page.getByLabel('剪辑画面', { exact: true }).click({ position: { x: 100, y: 100 } })
        await page.waitForTimeout(150)
        const marks = await callTool(client, 'list_application_entities', { entityType: 'video_edit.annotation', propertyIds: ['video_edit.annotation.text', 'video_edit.annotation.frame', 'video_edit.annotation.space'] })
        assert.equal(marks.data.items[0].properties['video_edit.annotation.text'], '检查叠加边缘'); assert.equal(marks.data.items[0].properties['video_edit.annotation.frame'], 30)
        await button(page, '删除').click(); await page.waitForTimeout(150)
        assert.equal((await savedProject(page, projectPath, document => document.sequences[0].annotations.length === 0, '删除标注保存')).sequences[0].annotations.length, 0)
        await button(page, '撤销').click()
        // Move and trim the text clip: the stacked sounds share the one audio track, so moving the linked
        // picture-and-sound pair would move its sound onto the others (the timeline refuses moves into occupied ranges).
        const textClip = original.sequences[0].clips[6]; assert.equal(textClip.kind, 'text')
        await page.locator(`[data-video-edit-clip="${textClip.id}"]`).scrollIntoViewIfNeeded()
        const clipButton = page.locator(`[data-video-edit-clip="${textClip.id}"]`).getByRole('button', { name: `选择片段 ${textClip.name}`, exact: true })
        const clipBox = await clipButton.boundingBox()
        await page.mouse.move(clipBox.x + clipBox.width / 2, clipBox.y + clipBox.height / 2); await page.mouse.down()
        await page.mouse.move(clipBox.x + clipBox.width / 2 + 24, clipBox.y + clipBox.height / 2, { steps: 4 }); await page.mouse.up()
        await page.waitForTimeout(150)
        assert.equal((await savedProject(page, projectPath, document => document.sequences[0].clips[6].start === 12, '移动片段保存')).sequences[0].clips[6].start, 12)
        await button(page, '撤销').click()
        const trimBox = await page.locator(`[data-video-edit-clip="${textClip.id}"] [data-video-edit-trim="out"]`).boundingBox()
        await page.mouse.move(trimBox.x + trimBox.width / 2, trimBox.y + trimBox.height / 2); await page.mouse.down()
        await page.mouse.move(trimBox.x + trimBox.width / 2 - 20, trimBox.y + trimBox.height / 2, { steps: 4 }); await page.mouse.up()
        await page.waitForTimeout(150)
        assert.equal((await savedProject(page, projectPath, document => document.sequences[0].clips[6].duration === 50, '修剪片段保存')).sequences[0].clips[6].duration, 50)
        await button(page, '撤销').click()
        const splitBefore = await callTool(client, 'read_application_entity', { ref: projectRef, propertyIds: ['video_edit.project.name'] })
        const split = await callTool(client, 'split_video_edit', operationEnvelope([splitBefore], { projectRef, clipRef: clips[0], frame: 30 }))
        assert.equal(split.executionState, 'completed', JSON.stringify(split))
        const saved = JSON.parse(fs.readFileSync(projectPath, 'utf8'))
        // Linked Selection splits the picture and its linked sound together.
        assert.equal(saved.sequences[0].clips.length, 9); assert.equal(saved.sequences[0].clips[1].sourceInUs, 1000000)
        evidence.toolRoundTrip = { change: changed.executionState, verification: changed.verificationState, annotation: marks.data.items, split: split.executionState }
        await button(page, '选择').click()
        for (const spec of specs) {
          await button(page, '关闭工程').click()
          const document = structuredClone(saved)
          document.id = `reality-${spec.width}-${spec.fps}`; document.sequences[0].width = spec.width; document.sequences[0].height = spec.height; document.sequences[0].frameRate = { numerator: spec.fps, denominator: 1 }; document.name = `剪辑验收 ${spec.width} ${spec.fps}`
          Object.assign(document.media.find(item => item.kind === 'video'), { path: spec.source, width: spec.width, height: spec.height })
          document.sequences[0].clips.forEach(clip => { clip.start *= spec.fps / 30; clip.duration *= spec.fps / 30 }); document.sequences[0].annotations.forEach(mark => { mark.frame *= spec.fps / 30 })
          const file = path.join(root, `${spec.width}-${spec.fps}.henji-video`); fs.writeFileSync(file, JSON.stringify(document))
          await dialogs(app, [file], ''); await button(page, '打开工程').click(); await presented(page, 0)
          const seeks = []; const previewFrames = {}
          const canvas = page.getByLabel('剪辑画面', { exact: true })
          const pixel = () => canvas.evaluate(canvas => canvas.toDataURL('image/png'))
          await page.getByTitle('1920-30.mp4', { exact: true }).first().click()
          const originalPixel = await pixel(); const effectStart = performance.now()
          await page.getByLabel('亮度效果', { exact: true }).fill('0.7')
          await page.waitForFunction(previous => { const canvas = document.querySelector('canvas[aria-label="剪辑画面"]'); return canvas.toDataURL('image/png') !== previous }, originalPixel)
          const effectMs = performance.now() - effectStart
          await page.getByLabel('亮度效果', { exact: true }).fill('1'); await presented(page, 0)
          for (const frame of [spec.fps + 3, 4, spec.fps - 1, spec.fps, 4]) { const start = performance.now(); await seek(page, frame, spec.fps); seeks.push({ frame, milliseconds: performance.now() - start }) }
          const rulerBox = await page.getByRole('slider', { name: '剪辑时间定位' }).boundingBox()
          await page.mouse.move(rulerBox.x + 6, rulerBox.y + 12); await page.mouse.down()
          const dragStart = performance.now()
          for (let step = 1; step <= 20; step++) await page.mouse.move(rulerBox.x + step * 3, rulerBox.y + 12)
          await page.mouse.up()
          try { await presented(page, spec.fps) }
          catch (error) {
            console.error('连续拖动落点诊断', rulerBox, await page.evaluate(({ x, y }) => ({ hit: document.elementFromPoint(x, y)?.outerHTML.slice(0, 600), ruler: document.querySelector('[aria-label="剪辑时间定位"]')?.getBoundingClientRect().toJSON() }), { x: rulerBox.x + 60, y: rulerBox.y + 12 }))
            await capture('video-edit-ruler-drag-error'); throw error
          }
          const dragMs = performance.now() - dragStart
          for (const frame of [0, spec.fps - 1, spec.fps, spec.fps + 1]) {
            await seek(page, frame, spec.fps)
            const data = await page.getByLabel('剪辑画面', { exact: true }).evaluate(canvas => canvas.toDataURL('image/png').split(',')[1])
            const png = path.join(root, `preview-${spec.width}-${spec.fps}-${frame}.png`); fs.writeFileSync(png, Buffer.from(data, 'base64')); previewFrames[frame] = png
          }
          await seek(page, 0, spec.fps)
          await page.getByLabel('剪辑画面', { exact: true }).evaluate(canvas => {
            window.__videoEvidence = []
            window.__videoObserver = new MutationObserver(() => window.__videoEvidence.push({ at: performance.now(), frame: Number(canvas.dataset.presentedFrame), timestamps: canvas.dataset.sourceTimestamps }))
            window.__videoObserver.observe(canvas, { attributes: true, attributeFilter: ['data-presented-frame'] })
          })
          await button(page, '播放／暂停').click(); await page.waitForFunction(last => document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame === String(last), 2 * spec.fps - 1, { timeout: 20000 })
          const frames = await page.evaluate(() => { window.__videoObserver.disconnect(); return window.__videoEvidence })
          const output = path.join(root, `${spec.width}-${spec.fps}-export-${Date.now()}.mp4`); await dialogs(app, [file], output)
          const exportStart = performance.now(); await button(page, '导出视频').click()
          await page.getByRole('button', { name: /^取消导出/ }).waitFor({ state: 'visible', timeout: 10000 }); await button(page, '导出视频').waitFor({ state: 'visible', timeout: 120000 })
          const exportMs = performance.now() - exportStart; const metadata = probe(output)
          assert.ok(metadata.streams.some(track => track.codec_type === 'audio')); assert.ok(Math.abs(Number(metadata.format.duration) - 2) < 0.1)
          assert.equal(Number(metadata.streams.find(track => track.codec_type === 'video').nb_frames), 2 * spec.fps)
          const comparisons = []; const sharp = require('sharp')
          for (const [frame, preview] of Object.entries(previewFrames)) {
            const png = path.join(root, `export-${spec.width}-${spec.fps}-${frame}.png`)
            ffmpeg(['-i', output, '-vf', `select=eq(n\\,${frame})`, '-frames:v', '1', png])
            const previewSize = await sharp(preview).metadata()
            const [a, b] = await Promise.all([sharp(preview).removeAlpha().raw().toBuffer(), sharp(png).resize(previewSize.width, previewSize.height).removeAlpha().raw().toBuffer()])
            let square = 0; for (let index = 0; index < a.length; index++) square += (a[index] - b[index]) ** 2
            const psnr = 10 * Math.log10(255 ** 2 / (square / a.length)); comparisons.push({ frame: Number(frame), psnr }); assert.ok(psnr > 24, `预览导出画面不一致：${psnr}`)
          }
          const pcm = execFileSync(ffmpegPath, ['-v', 'error', '-i', output, '-vn', '-f', 'f32le', '-ac', '1', '-ar', '48000', '-'], { windowsHide: true, maxBuffer: 4e6 })
          const samples = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 4); let power = 0; for (const sample of samples) power += sample * sample
          assert.ok(Math.sqrt(power / samples.length) > 0.01, '导出音轨不应静音')
          const referencePcm = execFileSync(ffmpegPath, ['-v', 'error', '-i', spec.source, '-i', sound, '-filter_complex', '[0:a]volume=0.5[a];[1:a]volume=0.25[b];[a][b]amix=inputs=2:normalize=0,atrim=duration=2', '-f', 'f32le', '-ac', '1', '-ar', '48000', '-'], { windowsHide: true, maxBuffer: 4e6 })
          const reference = new Float32Array(referencePcm.buffer, referencePcm.byteOffset, referencePcm.byteLength / 4)
          let best = { offset: 0, correlation: -1 }
          for (let offset = -1600; offset <= 1600; offset += 8) {
            let cross = 0; let leftPower = 0; let rightPower = 0
            for (let index = 2048; index < Math.min(reference.length, samples.length) - 2048; index += 16) {
              const a = reference[index]; const b = samples[index + offset]; cross += a * b; leftPower += a * a; rightPower += b * b
            }
            const correlation = cross / Math.sqrt(leftPower * rightPower)
            if (correlation > best.correlation) best = { offset, correlation }
          }
          assert.ok(best.correlation > 0.98 && Math.abs(best.offset) < 480, `导出混音与源时间不同步：${JSON.stringify(best)}`)
          const unique = new Set(frames.map(item => item.frame)).size
          assert.deepEqual(Array.from({ length: 2 * spec.fps - 1 }, (_, i) => i + 1).filter(frame => !frames.some(item => item.frame === frame)), [], '合成预览不能跳过视频帧')
          evidence.cases.push({ spec, input: probe(spec.source), effectMs, dragMs, seeks, frames, uniqueCompositedVideoFrames: unique, missedTimelineFrames: Array.from({ length: 2 * spec.fps - 1 }, (_, i) => i + 1).filter(frame => !frames.some(item => item.frame === frame)).length, exportMs, output, metadata, comparisons, audioRms: Math.sqrt(power / samples.length), audioSync: { lagMs: best.offset / 48, correlation: best.correlation } })
          fs.writeFileSync(path.join(root, 'evidence-final.json'), JSON.stringify(evidence, null, 2))
        }
        // Sequence In/Out (I/O keys, Out exclusive) select the exported half-open range on the open 4K60 project.
        {
          const fps = specs.at(-1).fps; const ruler = page.getByRole('slider', { name: '剪辑时间定位' })
          await seek(page, 30, fps); const rangeStart = await page.getByLabel('剪辑画面', { exact: true }).evaluate(canvas => canvas.toDataURL('image/png').split(',')[1])
          await ruler.press('i'); await seek(page, 90, fps); await ruler.press('o')
          await page.locator('[data-video-edit-export-range]').waitFor({ state: 'visible' })
          const rangeLabel = await page.locator('[data-video-edit-export-range]').textContent()
          const rangeOutput = path.join(root, `range-${Date.now()}.mp4`); await dialogs(app, [], rangeOutput)
          const startedAt = performance.now(); await button(page, '导出视频').click()
          await page.getByRole('button', { name: /^取消导出/ }).waitFor({ state: 'visible', timeout: 10000 }); await button(page, '导出视频').waitFor({ state: 'visible', timeout: 120000 })
          const rangeMs = performance.now() - startedAt; const metadata = probe(rangeOutput); const video = metadata.streams.find(track => track.codec_type === 'video')
          assert.equal(Number(video.nb_frames), 61, '入点30到出点90（含）共61帧'); assert.ok(Math.abs(Number(metadata.format.duration) - 61 / fps) < 0.05, `范围导出时长：${metadata.format.duration}`)
          const preview = path.join(root, 'range-preview-30.png'); fs.writeFileSync(preview, Buffer.from(rangeStart, 'base64'))
          const exported = path.join(root, 'range-export-0.png'); ffmpeg(['-i', rangeOutput, '-vf', 'select=eq(n\\,0)', '-frames:v', '1', exported])
          const sharp = require('sharp'); const size = await sharp(preview).metadata()
          const [a, b] = await Promise.all([sharp(preview).removeAlpha().raw().toBuffer(), sharp(exported).resize(size.width, size.height).removeAlpha().raw().toBuffer()])
          let square = 0; for (let index = 0; index < a.length; index++) square += (a[index] - b[index]) ** 2
          const psnr = 10 * Math.log10(255 ** 2 / (square / a.length)); assert.ok(psnr > 24, `范围首帧应等于预览入点帧：${psnr}`)
          evidence.rangeExport = { inFrame: 30, outFrameExclusive: 91, label: rangeLabel, frames: Number(video.nb_frames), duration: Number(metadata.format.duration), exportMs: rangeMs, firstFramePsnr: psnr, output: rangeOutput }
          fs.writeFileSync(path.join(root, 'evidence-final.json'), JSON.stringify(evidence, null, 2))
          await seek(page, 2 * fps - 1, fps)
        }
        evidence.pageCycles = []
        for (let index = 0; index < 4; index++) {
          await button(page, '画布').click(); await page.waitForTimeout(400); evidence.pageCycles.push(await app.evaluate(({ app }) => app.getAppMetrics()))
          await button(page, '剪辑').click(); await presented(page, 2 * specs.at(-1).fps - 1)
        }
        await capture('video-edit-final'); evidence.afterMemory = await app.evaluate(({ app }) => app.getAppMetrics())
        evidence.afterGpu = await app.evaluate(({ app }) => app.getGPUInfo('basic'))
        const lastRef = { kind: 'video_edit.project', id: `reality-${specs.at(-1).width}-${specs.at(-1).fps}` }
        const cancellationPath = path.join(root, `cancel-${Date.now()}.mp4`)
        await dialogs(app, [], cancellationPath)
        const cancellationBaseline = await callTool(client, 'read_application_entity', { ref: lastRef, propertyIds: ['video_edit.project.name'] })
        const submitted = await callTool(client, 'export_video_edit', operationEnvelope([cancellationBaseline], { projectRef: lastRef }))
        assert.equal(submitted.executionState, 'completed', JSON.stringify(submitted))
        await callTool(client, 'cancel_video_edit_export', operationEnvelope([cancellationBaseline], { projectRef: lastRef }))
        await button(page, '导出视频').waitFor({ state: 'visible', timeout: 20000 })
        const cancelled = await callTool(client, 'query_video_edit_export', { projectRef: lastRef })
        assert.equal(cancelled.data.task.state, 'cancelled'); assert.equal(fs.existsSync(cancellationPath), false)
        evidence.cancellation = { state: cancelled.data.task.state, partialFileRemoved: true }
        // Exercise sequence-specific output settings and disk reopening in the real host.
        await button(page, '关闭工程').click()
        const multi = structuredClone(saved); multi.id = 'reality-multi-sequence'; multi.name = '多序列保存导出验收'
        const portrait = structuredClone(multi.sequences[0]); portrait.id = 'portrait-2997'; portrait.name = '竖屏 29.97 单声道'
        portrait.width = 1080; portrait.height = 1920; portrait.frameRate = { numerator: 30000, denominator: 1001 }; portrait.sampleRate = 44100; portrait.channels = 1
        portrait.tracks.forEach(track => { track.id = `portrait-${track.id}` })
        const portraitClipIds = new Map(portrait.clips.map(clip => [clip.id, `portrait-${clip.id}`]))
        portrait.clips.forEach(clip => { clip.id = portraitClipIds.get(clip.id) })
        portrait.annotations.forEach(mark => { mark.id = `portrait-${mark.id}`; mark.clipId = portraitClipIds.get(mark.clipId) })
        multi.sequences.push(portrait)
        // Its own folder: the save-failure ACL must not touch media files (asset identity includes ctime).
        const multiPath = path.join(root, 'projects', 'multi-sequence.henji-video'); fs.mkdirSync(path.dirname(multiPath), { recursive: true }); fs.writeFileSync(multiPath, JSON.stringify(multi))
        const fractionalOutput = path.join(root, `portrait-2997-mono-${Date.now()}.mp4`)
        await dialogs(app, [multiPath], fractionalOutput); await button(page, '打开工程').click(); await presented(page, 0)
        const portraitRef = { kind: 'video_edit.sequence', id: `${multi.id}:${portrait.id}` }
        const portraitRead = await callTool(client, 'read_application_entity', { ref: portraitRef, propertyIds: ['video_edit.sequence.name', 'video_edit.sequence.frame_rate', 'video_edit.sequence.sample_rate', 'video_edit.sequence.channels'] })
        const named = await callTool(client, 'change_application_entities', operationEnvelope([portraitRead], { summary: '修改后台竖屏序列名称', changes: [{ kind: 'set_properties', entityType: portraitRef.kind, target: portraitRef, properties: { 'video_edit.sequence.name': '已保存的竖屏序列' } }] }))
        assert.equal(named.verificationState, 'verified', JSON.stringify(named))
        const multiSaved = JSON.parse(fs.readFileSync(multiPath, 'utf8'))
        assert.equal(multiSaved.sequences[1].name, '已保存的竖屏序列'); assert.deepEqual(multiSaved.media, multi.media)
        await button(page, '关闭工程').click(); await button(page, '打开工程').click(); await presented(page, 0)
        const restored = await callTool(client, 'read_application_entity', { ref: portraitRef, propertyIds: ['video_edit.sequence.name', 'video_edit.sequence.frame_rate', 'video_edit.sequence.sample_rate', 'video_edit.sequence.channels'] })
        assert.deepEqual(restored.data.properties, { 'video_edit.sequence.name': '已保存的竖屏序列', 'video_edit.sequence.frame_rate': { numerator: 30000, denominator: 1001 }, 'video_edit.sequence.sample_rate': 44100, 'video_edit.sequence.channels': 1 })
        const focused = await callTool(client, 'focus_application_entity', operationEnvelope([], { ref: portraitRef }))
        assert.equal(focused.executionState, 'completed', JSON.stringify(focused)); await presented(page, 0)
        await page.waitForFunction(() => { const canvas = document.querySelector('canvas[aria-label="剪辑画面"]'); return canvas?.width === 1080 && canvas.height === 1920 })
        await capture('video-edit-portrait-sequence')
        await button(page, '导出视频').click(); await page.getByRole('button', { name: /^取消导出/ }).waitFor({ state: 'visible' }); await button(page, '导出视频').waitFor({ state: 'visible', timeout: 120000 })
        const fractionalMetadata = probe(fractionalOutput)
        const fractionalVideo = fractionalMetadata.streams.find(track => track.codec_type === 'video'); const monoAudio = fractionalMetadata.streams.find(track => track.codec_type === 'audio')
        assert.equal(fractionalVideo.width, 1080); assert.equal(fractionalVideo.height, 1920); assert.equal(fractionalVideo.avg_frame_rate, '30000/1001'); assert.equal(Number(fractionalVideo.nb_frames), 60)
        assert.equal(Number(monoAudio.sample_rate), 44100); assert.equal(monoAudio.channels, 1); assert.ok(Math.abs(Number(fractionalMetadata.format.duration) - 2.002) < 0.1)
        evidence.multiSequence = { project: multiPath, originalPathsPreserved: true, reopenedSettings: restored.data.properties, output: fractionalOutput, metadata: fractionalMetadata }
        fs.writeFileSync(path.join(root, 'evidence-final.json'), JSON.stringify(evidence, null, 2))
        // Fault injection on the open multi-sequence project: each failure keeps the editable content.
        const alerts = async () => (await page.getByRole('alert').allTextContents()).map(text => text.trim()).filter(Boolean)
        const projectText = () => fs.readFileSync(multiPath, 'utf8')
        evidence.faults = {}
        // 1) Edits during an export are allowed and never reach the frozen export snapshot; opening another project does not disturb it.
        {
          const output = path.join(root, `during-export-${Date.now()}.mp4`); await dialogs(app, [path.join(root, `${specs[0].width}-${specs[0].fps}.henji-video`)], output)
          const before = JSON.parse(projectText()).sequences[1].clips.length
          await button(page, '导出视频').click(); await page.getByRole('button', { name: /^取消导出/ }).waitFor({ state: 'visible', timeout: 10000 })
          // The command band comes first; the project panel also lists a text item named 文字.
          await button(page, '文字').first().click()
          await savedProject(page, multiPath, document => document.sequences[1].clips.length === before + 1, '导出期间编辑保存')
          // Leaving the project is refused while its export runs; the export keeps going.
          await button(page, '关闭工程').click(); await page.waitForTimeout(300)
          const closeRefused = { stillOpen: await button(page, '关闭工程').count(), alerts: await alerts() }
          const multiRef = { kind: 'video_edit.project', id: multi.id }
          for (let state = 'running'; state === 'running';) { await page.waitForTimeout(250); state = (await callTool(client, 'query_video_edit_export', { projectRef: multiRef })).data.task.state }
          const metadata = probe(output); const video = metadata.streams.find(track => track.codec_type === 'video')
          evidence.faults.editDuringExport = { frames: Number(video.nb_frames), duration: Number(metadata.format.duration), clipsBefore: before, closeRefused, task: (await callTool(client, 'query_video_edit_export', { projectRef: multiRef })).data.task, alerts: await alerts() }
          assert.equal(evidence.faults.editDuringExport.frames, 60, '导出期间的编辑不能进入已固定的导出快照')
          assert.equal(closeRefused.stillOpen, 1); assert.ok(closeRefused.alerts.some(text => text.includes('请等待导出完成或取消导出')), JSON.stringify(closeRefused))
          assert.equal(evidence.faults.editDuringExport.task.state, 'completed')
          await capture('video-edit-fault-edit-during-export')
          fs.writeFileSync(path.join(root, 'evidence-final.json'), JSON.stringify(evidence, null, 2))
        }
        // 2) Save failure: deny creating files in the project's folder, so the atomic staged write cannot start.
        {
          const before = JSON.parse(projectText()).sequences[1].clips.length
          const account = os.userInfo().username; const acl = args => execFileSync('icacls', [path.dirname(multiPath), ...args], { windowsHide: true, stdio: 'pipe' })
          acl(['/deny', `${account}:(W)`])
          try {
            await button(page, '撤销').click()
            await page.getByText(/工程未能保存到磁盘/).first().waitFor({ state: 'visible', timeout: 10000 })
            evidence.faults.saveFailure = { alerts: await alerts() }
            assert.ok(!evidence.faults.saveFailure.alerts.some(text => /EISDIR|EPERM|ENOENT|illegal operation/i.test(text)), `保存失败提示不得暴露原始系统错误：${evidence.faults.saveFailure.alerts}`)
            await capture('video-edit-fault-save-failed')
            await button(page, '关闭工程').click(); await page.waitForTimeout(800)
            assert.equal(await button(page, '关闭工程').count(), 1, '未保存成功前关闭须保留工程与修改')
            evidence.faults.saveFailure.alertsAfterClose = await alerts()
          } finally { acl(['/remove:d', account]) }
          const deadline = performance.now() + 45000; let recovered
          do { await page.waitForTimeout(250); recovered = JSON.parse(projectText()) } while (recovered.sequences[1].clips.length !== before - 1 && performance.now() < deadline)
          assert.equal(recovered.sequences[1].clips.length, before - 1, '恢复写入后自动重试须保存失败期间的修改')
          await page.waitForFunction(() => ![...document.querySelectorAll('[role=alert]')].some(alert => /工程未能保存到磁盘/.test(alert.textContent ?? '')), null, { timeout: 5000 })
          evidence.faults.saveFailure.recovered = true; evidence.faults.saveFailure.alertsAfterRecovery = await alerts()
          fs.writeFileSync(path.join(root, 'evidence-final.json'), JSON.stringify(evidence, null, 2))
        }
        // 3) Missing source file on open, then explicit relink to the original path.
        {
          if (await button(page, '关闭工程').count()) await button(page, '关闭工程').click()
          const missing = structuredClone(saved); missing.id = 'reality-missing-source'; missing.name = '缺失源文件验收'
          const missingPath = path.join(root, 'missing-source-does-not-exist.mp4'); fs.rmSync(missingPath, { force: true })
          missing.media.find(item => item.kind === 'video').path = missingPath
          const missingProject = path.join(root, 'missing-source.henji-video'); fs.writeFileSync(missingProject, JSON.stringify(missing))
          await dialogs(app, [missingProject], ''); await button(page, '打开工程').click(); await page.waitForTimeout(3000)
          evidence.faults.missingSource = { alerts: await alerts(), canvas: await page.getByLabel('剪辑画面', { exact: true }).evaluate(canvas => ({ ...canvas.dataset })).catch(error => String(error)), body: (await page.locator('body').innerText()).slice(-800) }
          assert.ok(evidence.faults.missingSource.alerts.some(text => text.includes('找不到素材「1920-30.mp4」的源文件') && text.includes('重新定位源文件')), JSON.stringify(evidence.faults.missingSource.alerts))
          assert.ok(!evidence.faults.missingSource.alerts.some(text => text.includes('henji-media')), '缺失提示不得暴露内部地址')
          await capture('video-edit-fault-missing-source')
          const videoItem = missing.items.find(item => missing.media.find(media => media.id === item.mediaId)?.kind === 'video')
          await dialogs(app, [specs[0].source], ''); await entry(page, videoItem.id).click({ button: 'right' }); await menuItem(page, '重新定位源文件').click()
          const relinked = await savedProject(page, missingProject, document => document.media.find(item => item.kind === 'video').path.toLowerCase() === specs[0].source.toLowerCase(), '重新定位后保存').catch(error => ({ error: String(error) }))
          await presented(page, 0)
          evidence.faults.missingSource.relinked = !relinked.error; evidence.faults.missingSource.alertsAfterRelink = await alerts()
          evidence.faults.missingSource.canvasAfterRelink = await page.getByLabel('剪辑画面', { exact: true }).evaluate(canvas => ({ ...canvas.dataset }))
          assert.ok(evidence.faults.missingSource.relinked); assert.deepEqual(evidence.faults.missingSource.alertsAfterRelink, [], '重新定位后节目画面须自动恢复并清除提示')
          await capture('video-edit-fault-relinked')
          fs.writeFileSync(path.join(root, 'evidence-final.json'), JSON.stringify(evidence, null, 2))
        }
      } finally { await client.close(); await disableMcp(page) }
    },
  }
}
/** Fixture construction only; production rejects the old flat document format. */
function videoEditFixtureProject({ id, name, revision, width, height, fps, media, clips, annotations }) {
  const items = media.map(item => ({ id: `item-${item.id}`, name: item.name, kind: item.kind, mediaId: item.id }))
  const mappedClips = clips.map(({ mediaId, ...clip }) => {
    const itemId = mediaId ? `item-${mediaId}` : `item-${clip.id}`
    if (!mediaId) items.push({ id: itemId, name: clip.name, kind: clip.kind })
    return { ...clip, itemId, sourceRemainder: { numerator: 0, denominator: 1 } }
  })
  return { format: 'henji-video-project', version: 2, id, name, revision, media, bins: [], items,
    sequences: [{ id: `sequence-${id}`, name: '序列 1', width, height, frameRate: { numerator: fps, denominator: 1 }, pixelAspectRatio: { numerator: 1, denominator: 1 }, sampleRate: 48000, channels: 2,
      tracks: Array.from({ length: 8 }, (_, index) => ({ id: `${id}-track-${index}`, name: index ? `视频 ${index}` : '音频 1', index, kind: index ? 'video' : 'audio', locked: false, enabled: true, muted: false, solo: false })), clips: mappedClips, annotations }] }
}
module.exports = { createVideoEditProbeScene, videoEditFixtureProject }
