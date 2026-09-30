const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync } = require('node:child_process')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope } = require('./uiInspectionMcpClient.cjs')
const button = (page, name) => page.getByRole('button', { name, exact: true })
async function dialogs(app, openPaths, savePath) {
  await app.evaluate(({ dialog }, values) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: values.openPaths })
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: values.savePath })
  }, { openPaths, savePath })
}
async function presented(page, frame) {
  await page.waitForFunction(frame => { const canvas = document.querySelector('canvas[aria-label="剪辑画面"]'); return canvas?.dataset.presentedFrame === String(frame) && canvas.dataset.scrubbing === 'false' }, frame, { timeout: 20000 })
}
async function seek(page, frame, fps) {
  await page.getByRole('slider', { name: '剪辑时间定位' }).click({ position: { x: frame * 60 / fps + 0.1, y: 12 } })
  await presented(page, frame)
}
function createVideoEditProbeScene() {
  return {
    id: 'video-edit-engine-probe', surface: '剪辑', name: '剪辑-工程与MCP合成导出闭环', writesUserData: true,
    setup: async (page, app, { capture }) => {
      const root = path.resolve('node_modules/.cache/video-edit-probe'); fs.mkdirSync(root, { recursive: true })
      const { ffmpegPath, ffprobePath } = require('ffmpeg-ffprobe-static')
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
      await button(page, '新建工程').click(); await button(page, '导入文件').click()
      await button(page, 'tone.wav').waitFor({ state: 'visible', timeout: 20000 })
      await page.evaluate(async picture => { await window.henjiNative.assetLibrary.createAsset({ filePath: picture, mediaType: 'image', source: 'external', displayName: '素材库图片' }) }, picture)
      await button(page, '素材库').click(); await button(page, '素材库图片').click()
      await page.locator('aside').getByRole('button', { name: 'card.png', exact: true }).waitFor({ state: 'visible' })
      for (const name of ['1920-30.mp4', '1920-30.mp4', 'card.png', 'tone.wav']) await page.locator('aside').getByRole('button', { name, exact: true }).click()
      await button(page, '文字').click()
      await button(page, '保存').click(); await page.waitForTimeout(300)
      const original = JSON.parse(fs.readFileSync(projectPath, 'utf8'))
      assert.deepEqual(original.media.map(item => item.path.toLowerCase()).sort(), [specs[0].source, picture, sound].map(value => value.toLowerCase()).sort()); assert.equal(original.clips.length, 5)
      const timeline = page.getByRole('slider', { name: '剪辑时间定位' }).locator('..')
      const drops = [
        { name: '1920-30.mp4', path: specs[0].source, kind: 'video', x: 120, track: 2 },
        { name: 'tone.wav', path: sound, kind: 'audio', x: 180, track: 0 },
        { name: '素材库图片', path: picture, kind: 'image', x: 240, track: 1 },
      ]
      for (const drop of drops) {
        if (drop.name === '素材库图片') await button(page, '素材库').click()
        await page.locator('aside').getByRole('button', { name: drop.name, exact: true }).dragTo(timeline, { targetPosition: { x: drop.x, y: 28 + drop.track * 32 + 16 } })
        await page.waitForTimeout(150); await button(page, '保存').click(); await page.waitForTimeout(150)
        const after = JSON.parse(fs.readFileSync(projectPath, 'utf8')); const last = after.clips.at(-1)
        assert.equal(after.clips.length, original.clips.length + 1)
        assert.equal(last.kind, drop.kind); assert.equal(last.start, drop.x / 2); assert.equal(last.track, drop.track)
        assert.equal(after.media.find(item => item.id === last.mediaId).path.toLowerCase(), drop.path.toLowerCase())
        assert.equal(after.media.length, original.media.length, '同一路径的大小写差异不应创建第二份素材')
        await button(page, '撤销').click(); await button(page, '保存').click(); await page.waitForTimeout(150)
        assert.equal(JSON.parse(fs.readFileSync(projectPath, 'utf8')).clips.length, original.clips.length)
      }
      await button(page, '收起素材库').click()
      evidence.materialDrag = drops.map(({ kind, track }) => ({ kind, track, originalPathPreserved: true, undoVerified: true }))
      const identity = await authorizeMcpConnection(page, { name: '剪辑真实回环', allowWrites: true, allowDestructive: true })
      const client = await connectMcpClient(identity.config, 'Henji video edit Reality')
      try {
        const projectRef = { kind: 'video_edit.project', id: original.id }
        const clips = original.clips.map(item => ({ kind: 'video_edit.clip', id: `${original.id}:${item.id}` }))
        const changes = [{ duration: 60, track: 1, volume: 0.5 }, { duration: 60, track: 2, scale: 0.35, x: 0.25, y: -0.25, volume: 0, brightness: 0.6 }, { duration: 60, track: 3, scale: 0.18, x: -0.3, y: -0.3 }, { duration: 60, track: 0, volume: 0.25 }, { duration: 60, track: 4, text: 'Henji · 本地剪辑', y: 0.3 }]
          .map((properties, index) => ({ kind: 'set_properties', entityType: 'video_edit.clip', target: clips[index], properties }))
        const baselines = []
        for (const ref of clips) baselines.push(await callTool(client, 'read_application_entity', { ref, propertyIds: ['video_edit.clip.duration', 'video_edit.clip.scale'] }))
        const changed = await callTool(client, 'change_application_entities', operationEnvelope(baselines, { summary: '双视频、图片、声音与文字合成', changes }))
        assert.equal(changed.executionState, 'completed', JSON.stringify(changed)); assert.equal(changed.verificationState, 'verified', JSON.stringify(changed))
        await presented(page, 0); await capture('video-edit-composition')
        await button(page, '撤销').click(); await button(page, '保存').click(); await page.waitForTimeout(150)
        assert.equal(JSON.parse(fs.readFileSync(projectPath, 'utf8')).clips[1].scale, 1)
        await button(page, '重做').click(); await button(page, '保存').click(); await page.waitForTimeout(150)
        assert.equal(JSON.parse(fs.readFileSync(projectPath, 'utf8')).clips[1].scale, 0.35)
        await seek(page, 30, 30); await page.getByTitle('1920-30.mp4', { exact: true }).first().click(); await button(page, '点标注').click()
        await page.getByLabel('标注文字', { exact: true }).fill('检查叠加边缘')
        await page.getByLabel('剪辑画面', { exact: true }).click({ position: { x: 100, y: 100 } })
        await button(page, '保存').click(); await page.waitForTimeout(150)
        const marks = await callTool(client, 'list_application_entities', { entityType: 'video_edit.annotation', propertyIds: ['video_edit.annotation.text', 'video_edit.annotation.frame', 'video_edit.annotation.space'] })
        assert.equal(marks.data.items[0].properties['video_edit.annotation.text'], '检查叠加边缘'); assert.equal(marks.data.items[0].properties['video_edit.annotation.frame'], 30)
        await button(page, '删除').click(); await button(page, '保存').click(); await page.waitForTimeout(150)
        assert.equal(JSON.parse(fs.readFileSync(projectPath, 'utf8')).annotations.length, 0)
        await button(page, '撤销').click()
        const clipButton = page.getByTitle('1920-30.mp4', { exact: true }).first()
        const clipBox = await clipButton.boundingBox()
        await page.mouse.move(clipBox.x + clipBox.width / 2, clipBox.y + clipBox.height / 2); await page.mouse.down()
        await page.mouse.move(clipBox.x + clipBox.width / 2 + 24, clipBox.y + clipBox.height / 2, { steps: 4 }); await page.mouse.up()
        await button(page, '保存').click(); await page.waitForTimeout(150)
        assert.equal(JSON.parse(fs.readFileSync(projectPath, 'utf8')).clips[0].start, 12)
        await button(page, '撤销').click()
        const trimBox = await page.getByTitle('裁剪出点', { exact: true }).first().boundingBox()
        await page.mouse.move(trimBox.x + trimBox.width / 2, trimBox.y + trimBox.height / 2); await page.mouse.down()
        await page.mouse.move(trimBox.x + trimBox.width / 2 - 20, trimBox.y + trimBox.height / 2, { steps: 4 }); await page.mouse.up()
        await button(page, '保存').click(); await page.waitForTimeout(150)
        assert.equal(JSON.parse(fs.readFileSync(projectPath, 'utf8')).clips[0].duration, 50)
        await button(page, '撤销').click()
        const splitBefore = await callTool(client, 'read_application_entity', { ref: projectRef, propertyIds: ['video_edit.project.name'] })
        const split = await callTool(client, 'split_video_edit', operationEnvelope([splitBefore], { projectRef, clipRef: clips[0], frame: 30 }))
        assert.equal(split.executionState, 'completed', JSON.stringify(split))
        const saved = JSON.parse(fs.readFileSync(projectPath, 'utf8'))
        assert.equal(saved.clips.length, 6); assert.equal(saved.clips[1].sourceInUs, 1000000)
        evidence.toolRoundTrip = { change: changed.executionState, verification: changed.verificationState, annotation: marks.data.items, split: split.executionState }
        await button(page, '选择').click()
        for (const spec of specs) {
          await button(page, '关闭工程').click()
          const document = structuredClone(saved)
          document.id = `reality-${spec.width}-${spec.fps}`; document.width = spec.width; document.height = spec.height; document.fps = spec.fps; document.name = `剪辑验收 ${spec.width} ${spec.fps}`
          Object.assign(document.media.find(item => item.kind === 'video'), { path: spec.source, width: spec.width, height: spec.height })
          document.clips.forEach(clip => { clip.start *= spec.fps / 30; clip.duration *= spec.fps / 30 }); document.annotations.forEach(mark => { mark.frame *= spec.fps / 30 })
          const file = path.join(root, `${spec.width}-${spec.fps}.henji-video`); fs.writeFileSync(file, JSON.stringify(document))
          await dialogs(app, [file], ''); await button(page, '打开工程').click(); await presented(page, 0)
          const seeks = []; const previewFrames = {}
          const canvas = page.getByLabel('剪辑画面', { exact: true })
          const pixel = () => canvas.evaluate(canvas => [...canvas.getContext('2d').getImageData(Math.floor(canvas.width * 0.2), Math.floor(canvas.height * 0.5), 1, 1).data].join(','))
          await page.getByTitle('1920-30.mp4', { exact: true }).first().click()
          const originalPixel = await pixel(); const effectStart = performance.now()
          await page.getByLabel('亮度效果', { exact: true }).fill('0.7')
          await page.waitForFunction(previous => { const canvas = document.querySelector('canvas[aria-label="剪辑画面"]'); return [...canvas.getContext('2d').getImageData(Math.floor(canvas.width * 0.2), Math.floor(canvas.height * 0.5), 1, 1).data].join(',') !== previous }, originalPixel)
          const effectMs = performance.now() - effectStart
          await page.getByLabel('亮度效果', { exact: true }).fill('1'); await presented(page, 0)
          for (const frame of [spec.fps + 3, 4, spec.fps - 1, spec.fps, 4]) { const start = performance.now(); await seek(page, frame, spec.fps); seeks.push({ frame, milliseconds: performance.now() - start }) }
          const rulerBox = await page.getByRole('slider', { name: '剪辑时间定位' }).boundingBox()
          await page.mouse.move(rulerBox.x + 1, rulerBox.y + 12); await page.mouse.down()
          const dragStart = performance.now()
          for (let step = 1; step <= 20; step++) await page.mouse.move(rulerBox.x + step * 3, rulerBox.y + 12)
          await page.mouse.up(); await presented(page, spec.fps)
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
          await button(page, '播放').click(); await button(page, '暂停').waitFor({ state: 'visible' }); await button(page, '播放').waitFor({ state: 'visible', timeout: 20000 })
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
          evidence.cases.push({ spec, input: probe(spec.source), effectMs, dragMs, seeks, frames, uniqueCompositedVideoFrames: unique, missedTimelineFrames: 2 * spec.fps - 1 - unique, exportMs, output, metadata, comparisons, audioRms: Math.sqrt(power / samples.length), audioSync: { lagMs: best.offset / 48, correlation: best.correlation } })
          fs.writeFileSync(path.join(root, 'evidence-final.json'), JSON.stringify(evidence, null, 2))
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
        fs.writeFileSync(path.join(root, 'evidence-final.json'), JSON.stringify(evidence, null, 2))
      } finally { await client.close(); await disableMcp(page) }
    },
  }
}
module.exports = { createVideoEditProbeScene }
