const assert = require('node:assert/strict')
const { VIDEO_EDIT_TRACK_HEADER_WIDTH } = require('./uiInspectionVideoEditGeometry.cjs')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const sharp = require('sharp')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope } = require('./uiInspectionMcpClient.cjs')
const { observeWorkers, workerSnapshot, waitReleased } = require('./uiInspectionSceneVideoEditLayout.cjs')
const button = (page, name) => page.getByRole('button', { name, exact: true })
async function dialogs(app, openPaths, savePath) {
  await app.evaluate(({ dialog }, values) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: values.openPaths })
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: values.savePath })
  }, { openPaths, savePath })
}
async function saved(page, file, condition) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const document = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (condition(document)) return document
    await page.waitForTimeout(50)
  }
  assert.fail(`工程未静默保存预期代码素材内容：${condition.toString()}`)
}
async function presented(page, frame) {
  await page.waitForFunction(frame => {
    const canvas = document.querySelector('canvas[aria-label="剪辑画面"]')
    return canvas?.dataset.presentedFrame === String(frame) && canvas.dataset.scrubbing === 'false'
  }, frame, { timeout: 20000 })
}
async function seek(page, frame) {
  const ruler = page.getByRole('slider', { name: '剪辑时间定位' })
  await ruler.click({ position: { x: Math.max(6, frame + .1), y: 12 } })
  for (let count = 0; count < 8; count++) {
    const actual = Number(await ruler.getAttribute('aria-valuenow'))
    if (actual === frame) break
    await ruler.press(actual > frame ? 'ArrowLeft' : 'ArrowRight')
  }
  assert.equal(Number(await ruler.getAttribute('aria-valuenow')), frame)
  await presented(page, frame)
}
function percentile(values, p) { return [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))] }
async function comparePng(actual, expected) {
  const raw = png => sharp(Buffer.from(png.split(',')[1], 'base64')).ensureAlpha().raw().toBuffer()
  const [a, b] = await Promise.all([raw(actual), raw(expected)])
  assert.equal(a.length, b.length)
  let different = 0; let max = 0; let square = 0; const channels = [0, 0, 0, 0]
  for (let index = 0; index < a.length; index++) {
    const delta = Math.abs(a[index] - b[index])
    if (delta) { different++; channels[index % 4]++; max = Math.max(max, delta); square += delta * delta }
  }
  return { equal: a.equals(b), actualHash: createHash('sha256').update(a).digest('hex'), expectedHash: createHash('sha256').update(b).digest('hex'), differentChannels: different, channels, maximumDelta: max, rms: Math.sqrt(square / a.length) }
}
const baseDynamicSource = `export default {
  apiVersion:1,name:"原创轨道标题",kind:"generator",mode:"dynamic",
  width:3840,height:2160,durationSeconds:10,seed:91,
  parameters:{speed:{type:"number",title:"移动速度",default:80,min:0,max:400,step:1},ink:{type:"color",title:"标题颜色",default:[0.2,1,1,0.8]}},
  render(ctx){const x=250+ctx.time*ctx.params.speed;
    return [ellipse({x:x,y:1100,width:260,height:260,fill:ctx.params.ink}),
      line({x1:x,y1:1420,x2:x+1800,y2:1420,width:14,color:ctx.params.ink}),
      text({x:x+150,y:1600,text:"原创代码 · 混合剪辑",fontSize:130,color:[1,1,1,1]})];}
}`
const baseStaticSource = `export default {apiVersion:1,name:"透明静态卡片",kind:"generator",mode:"static",width:3840,height:2160,durationSeconds:3,seed:12,parameters:{ink:{type:"color",title:"底色",default:[0.1,0.25,1,0.5]}},render(ctx){return [rect({x:130,y:130,width:980,height:600,radius:48,fill:ctx.params.ink}),text({x:210,y:420,text:"静态画面复用",fontSize:115,color:[1,1,1,1]})];}}`

function createVideoEditCodeProjectScene({ controls = false } = {}) {
  const control = controls ? require('./uiInspectionVideoEditCodeControls.cjs') : undefined
  const dynamicSource = control?.dynamicSource ?? baseDynamicSource; const staticSource = control?.staticSource ?? baseStaticSource
  return { id: controls ? 'video-edit-code-controls' : 'video-edit-code-project', surface: '剪辑', name: controls ? '剪辑-参数曲线源码与透明图片4K60回环' : '剪辑-原创代码素材混合保存与4K60导出', writesUserData: true,
    setup: async (page, app, { capture }) => {
      const root = path.resolve(`node_modules/.cache/video-edit-code-${controls ? 'controls' : 'project'}`); fs.mkdirSync(root, { recursive: true })
      const video = path.resolve('node_modules/.cache/video-edit-probe/3840-60.mp4')
      const picture = control ? await control.makePicture(root) : path.resolve('node_modules/.cache/video-edit-project-source/picture.png')
      const audio = path.resolve('node_modules/.cache/video-edit-project-source/audio.wav')
      for (const source of [video, picture, audio]) assert.ok(fs.existsSync(source), `复用真实前置媒体：${source}`)
      const originals = [video, picture, audio].map(file => ({ file, size: fs.statSync(file).size, mtime: fs.statSync(file).mtimeMs }))
      const file = path.join(root, 'code-project.henji-video')
      const output = path.join(root, `4k60-code-${Date.now()}.mp4`)
      const evidence = { originalPaths: originals, phases: [] }
      const saveEvidence = () => fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
      let client
      await observeWorkers(page)
      try {
        await button(page, '剪辑').click(); await dialogs(app, [video, picture, audio], file); await button(page, '新建工程').click()
        await button(page, '导入').click()
        let document = await saved(page, file, document => document.media.length === 3)
        const projectRef = { kind: 'video_edit.project', id: document.id }
        const sequenceRef = { kind: 'video_edit.sequence', id: `${document.id}:${document.sequences[0].id}` }
        const identity = await authorizeMcpConnection(page, { name: '原创代码素材回环', allowWrites: true, allowDestructive: true })
        client = await connectMcpClient(identity.config, 'Henji native code Reality')
        const change = async changes => {
          const refs = [...new Map(changes.map(change => { const ref = change.target ?? change.parent; return [`${ref.kind}:${ref.id}`, ref] })).values()]
          const baselines = []
          for (const ref of refs) baselines.push(await callTool(client, 'read_application_entity', { ref, propertyIds: [`${ref.kind}.name`] }))
          const result = await callTool(client, 'change_application_entities', operationEnvelope(baselines, { summary: '原创代码素材工程编辑', changes }))
          assert.equal(result.executionState, 'completed', JSON.stringify(result)); assert.equal(result.verificationState, 'verified', JSON.stringify(result)); return result
        }
        await change([{ kind: 'set_properties', entityType: sequenceRef.kind, target: sequenceRef, properties: { 'video_edit.sequence.width': 3840, 'video_edit.sequence.height': 2160, 'video_edit.sequence.frame_rate': { numerator: 60, denominator: 1 } } }])
        const createdAt = performance.now()
        const created = await change([{ kind: 'create_items', entityType: 'video_edit.code_material', parent: projectRef, items: [{ properties: { 'video_edit.code_material.source': dynamicSource } }] }])
        evidence.originalSourceCreation = { milliseconds: performance.now() - createdAt, result: created }
        document = await saved(page, file, value => value.items.some(item => item.kind === 'code'))
        const dynamicItem = document.items.find(item => item.kind === 'code')
        const materialRef = { kind: 'video_edit.code_material', id: `${document.id}:${dynamicItem.code.definitionId}` }
        const read = await callTool(client, 'read_application_entity', { ref: materialRef, propertyIds: ['video_edit.code_material.source'] })
        assert.equal(read.data.properties['video_edit.code_material.source'], dynamicSource)
        await button(page, '新建项目项').click(); await button(page, '新建代码素材').click()
        await page.getByLabel('作者源码', { exact: true }).fill(staticSource)
        await capture('code-source-authoring')
        await button(page, '检查并创建').click()
        await page.getByRole('dialog', { name: '新建代码素材', exact: true }).waitFor({ state: 'hidden', timeout: 15000 })
        document = await saved(page, file, value => value.items.filter(item => item.kind === 'code').length === 2)
        const staticItem = document.items.find(item => item.kind === 'code' && item.id !== dynamicItem.id)
        evidence.phases.push('原创MCP源码与手动静态源码已入库')
        await change(document.items.filter(item => item.id !== staticItem.id).map(item => ({ kind: 'create_items', entityType: 'video_edit.clip', parent: sequenceRef, items: [{ properties: {
            'video_edit.clip.item_id': item.id, 'video_edit.clip.name': item.name, 'video_edit.clip.kind': item.kind,
            'video_edit.clip.start': 0, 'video_edit.clip.duration': 180, 'video_edit.clip.track': item.kind === 'audio' ? 0 : item.kind === 'video' ? 1 : item.kind === 'image' ? 2 : 4,
            ...(item.kind === 'image' ? { 'video_edit.clip.scale': .18, 'video_edit.clip.x': .32, 'video_edit.clip.y': -.3 } : {}),
            ...(item.kind === 'video' ? { 'video_edit.clip.volume': 0 } : {}),
          } }] })))
        document = await saved(page, file, value => value.sequences[0].clips.length === 4)
        // An empty timeline deliberately creates a matching new sequence (1.3).
        // Drag onto the populated 4K60 sequence to verify insertion into this target.
        // Free video track 3 (code clips occupy 4; the monitor scene reuses this project and keeps 6/7 free).
        const freeTrack = page.locator('[data-track-kind="video"][data-track-index="3"]')
        await page.locator(`[data-video-edit-project-entry="${staticItem.id}"]`).dragTo(freeTrack, { targetPosition: { x: VIDEO_EDIT_TRACK_HEADER_WIDTH + 6, y: 16 } })
        document = await saved(page, file, value => value.sequences[0].clips.length === 5)
        const staticClip = document.sequences[0].clips.find(clip => clip.itemId === staticItem.id)
        await change([{ kind: 'set_properties', entityType: 'video_edit.clip', target: { kind: 'video_edit.clip', id: `${document.id}:${staticClip.id}` }, properties: { 'video_edit.clip.start': 0, 'video_edit.clip.duration': 180 } }])
        evidence.phases.push('真实拖放和原路径四种素材混剪已接通')
        const dynamicClip = document.sequences[0].clips.find(clip => clip.itemId === dynamicItem.id)
        const dynamicRef = { kind: 'video_edit.clip', id: `${document.id}:${dynamicClip.id}` }
        await presented(page, 0); await capture('code-mixed-4k-frame0')
        const snapshots = {}; const seeks = []; evidence.seeks = seeks
        for (const frame of [120, 0, 60, 120]) {
          const began = performance.now(); await seek(page, frame)
          const png = await page.getByLabel('剪辑画面', { exact: true }).evaluate(canvas => canvas.toDataURL('image/png'))
          seeks.push({ frame, elapsedMs: performance.now() - began, ...(await page.getByLabel('剪辑画面', { exact: true }).evaluate(canvas => ({ ...canvas.dataset }))) })
          fs.writeFileSync(path.join(root, `seek-${seeks.length}-${frame}.png`), Buffer.from(png.split(',')[1], 'base64'))
          if (snapshots[frame]) {
            const comparison = await comparePng(png, snapshots[frame]); evidence.repeatedFrame = comparison; saveEvidence()
            assert.ok(comparison.equal, `倒拖和重复指定帧必须得到一致像素：${JSON.stringify(comparison)}`)
          }
          snapshots[frame] = png
        }
        evidence.seeks = seeks
        if (control) await control.inspectCodeControls({ page, app, capture, evidence, change, file, root, document, dynamicClip, staticClip, dynamicSource, snapshots, saved, seek, comparePng })
        const beforeSource = document.codeMaterials.map(definition => definition.versions)
        const parameterAt = performance.now()
        await change([{ kind: 'set_properties', entityType: 'video_edit.clip', target: dynamicRef, properties: { 'video_edit.clip.code_parameters': { speed: 200, ink: [.9, .2, .1, .7] } } }])
        await page.waitForFunction(previous => document.querySelector('canvas[aria-label="剪辑画面"]').toDataURL('image/png') !== previous, snapshots[120], { timeout: 10000 })
        evidence.parameterResponseMs = performance.now() - parameterAt
        document = await saved(page, file, value => value.sequences[0].clips.find(clip => clip.id === dynamicClip.id).code.parameters.speed === 200)
        assert.deepEqual(document.codeMaterials.map(definition => definition.versions), beforeSource, '参数更新不改源码版本')
        assert.equal(document.items.find(item => item.id === dynamicItem.id).code.parameters.speed, 80, '实例参数不改项目默认值')
        await button(page, '撤销').click(); await saved(page, file, value => value.sequences[0].clips.find(clip => clip.id === dynamicClip.id).code.parameters.speed === 80)
        await page.waitForFunction(previous => document.querySelector('canvas[aria-label="剪辑画面"]').toDataURL('image/png') === previous, snapshots[120], { timeout: 10000 })
        const beforeRejected = JSON.parse(fs.readFileSync(file, 'utf8'))
        await button(page, '新建项目项').click(); await button(page, '新建代码素材').click()
        await page.getByLabel('作者源码', { exact: true }).fill(dynamicSource.replace('const x=', 'while(true){} const x='))
        await button(page, '检查并创建').click()
        const rejection = page.getByText(/render 中仅允许 const 和最后一个 return/)
        await rejection.waitFor({ state: 'visible' }); evidence.refusedSource = await rejection.innerText()
        assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), beforeRejected, '非法候选不得改变有效工程')
        await capture('code-invalid-source-preserved'); await button(page, '取消').click()
        const split = await callTool(client, 'split_video_edit', operationEnvelope([await callTool(client, 'read_application_entity', { ref: projectRef, propertyIds: ['video_edit.project.name'] })], { projectRef, clipRef: dynamicRef, frame: 90 }))
        assert.equal(split.executionState, 'completed')
        document = await saved(page, file, value => value.sequences[0].clips.length === 6)
        const tail = document.sequences[0].clips.find(clip => clip.itemId === dynamicItem.id && clip.start === 90)
        assert.equal(tail.sourceInUs, 1500000); assert.equal(tail.code.versionId, dynamicClip.code.versionId)
        await seek(page, 120)
        assert.equal(await page.getByLabel('剪辑画面', { exact: true }).evaluate(canvas => canvas.toDataURL('image/png')), snapshots[120], '拆分保持同一源时间画面')
        await seek(page, 0)
        const playResourceStart = (await workerSnapshot(page)).events.length
        await page.getByLabel('剪辑画面', { exact: true }).evaluate(canvas => {
          window.__codePlayFrames = []
          window.__codePlayObserver = new MutationObserver(() => window.__codePlayFrames.push({ at: performance.now(), frame: Number(canvas.dataset.presentedFrame), decodeMs: Number(canvas.dataset.decodeMs), gpuMs: Number(canvas.dataset.gpuMs), renderMs: Number(canvas.dataset.renderMs) }))
          window.__codePlayObserver.observe(canvas, { attributes: true, attributeFilter: ['data-presented-frame'] })
        })
        // The timeline transport toggles play; playback stops on the last frame.
        await button(page, '播放／暂停').click(); await page.waitForFunction(() => document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame === '179', null, { timeout: 20000 })
        const frames = await page.evaluate(() => { window.__codePlayObserver.disconnect(); return window.__codePlayFrames })
        const unique = [...new Map(frames.filter(frame => frame.frame > 0).map(frame => [frame.frame, frame])).values()]
        assert.deepEqual(Array.from({ length: 179 }, (_, index) => index + 1).filter(frame => !unique.some(value => value.frame === frame)), [], '混合预览不能省略视频帧')
        const elapsed = unique.at(-1).at - unique[0].at; const rate = (unique.length - 1) * 1000 / elapsed
        evidence.playback = { resolution: [3840, 2160], frames: unique, actualCompositedFrames: unique.length, elapsedMs: elapsed, actualFrameRate: rate, completedGpuP95Ms: percentile(unique.map(frame => frame.gpuMs), .95), resources: (await workerSnapshot(page)).events.slice(playResourceStart) }
        assert.ok(rate >= 57, `4K60 混合画面实际更新不足：${rate}`)
        const finalPlayingFrame = await page.getByLabel('剪辑画面', { exact: true }).evaluate(canvas => canvas.toDataURL('image/png'))
        await seek(page, 120)
        await seek(page, 179)
        evidence.playback.pauseComparison = await comparePng(await page.getByLabel('剪辑画面', { exact: true }).evaluate(canvas => canvas.toDataURL('image/png')), finalPlayingFrame)
        assert.ok(evidence.playback.pauseComparison.equal, `播放与暂停同帧不一致：${JSON.stringify(evidence.playback.pauseComparison)}`)
        await seek(page, 120)
        const rulerBox = await page.getByRole('slider', { name: '剪辑时间定位' }).boundingBox()
        await page.getByLabel('剪辑画面', { exact: true }).evaluate(canvas => {
          const ruler = document.querySelector('[role="slider"][aria-label="剪辑时间定位"]')
          const state = { inputs: [], updates: [] }
          const input = event => state.inputs.push({ at: performance.now(), x: event.clientX })
          const observer = new MutationObserver(() => {
            const at = performance.now(); const last = state.inputs.at(-1)
            if (last) state.updates.push({ at, frame: Number(canvas.dataset.presentedFrame), pointerToFrameMs: at - last.at, decodeMs: Number(canvas.dataset.decodeMs), gpuMs: Number(canvas.dataset.gpuMs) })
          })
          observer.observe(canvas, { attributes: true, attributeFilter: ['data-presented-frame'] })
          ruler.addEventListener('pointermove', input)
          window.__codeDrag = { state, stop() { observer.disconnect(); ruler.removeEventListener('pointermove', input); return state } }
        })
        const dragAt = performance.now(); await page.mouse.move(rulerBox.x + 120, rulerBox.y + 12); await page.mouse.down()
        for (let index = 20; index >= 1; index--) await page.mouse.move(rulerBox.x + index * 6, rulerBox.y + 12)
        await page.mouse.up(); await presented(page, 6)
        const drag = await page.evaluate(() => window.__codeDrag.stop())
        const lastInput = drag.inputs.at(-1); const finalUpdate = drag.updates.findLast(update => update.frame === 6)
        assert.ok(lastInput && finalUpdate && finalUpdate.at >= lastInput.at, '最后一次拖动输入需有对应的实际画面')
        evidence.drag = { ...drag, gestureMs: performance.now() - dragAt, finalPointerToCorrectFrameMs: finalUpdate.at - lastInput.at, pointerToActualFrameP95Ms: percentile(drag.updates.map(update => update.pointerToFrameMs), .95) }
        for (const frame of [0, 60, 89, 90, 120]) {
          await seek(page, frame)
          fs.writeFileSync(path.join(root, `preview-${frame}.png`), Buffer.from(await page.getByLabel('剪辑画面', { exact: true }).evaluate(canvas => canvas.toDataURL('image/png').split(',')[1]), 'base64'))
        }
        await dialogs(app, [file], output); const exportAt = performance.now(); await button(page, '导出视频').click()
        await page.getByRole('button', { name: /^取消导出/ }).waitFor({ state: 'visible', timeout: 10000 }); await button(page, '导出视频').waitFor({ state: 'visible', timeout: 120000 })
        const { ffprobePath, ffmpegPath } = require('./mediaBinaries.cjs')
        const metadata = JSON.parse(execFileSync(ffprobePath, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output], { encoding: 'utf8', windowsHide: true }))
        const videoStream = metadata.streams.find(stream => stream.codec_type === 'video')
        assert.equal(videoStream.width, 3840); assert.equal(videoStream.height, 2160); assert.equal(videoStream.nb_frames, '180'); assert.equal(videoStream.avg_frame_rate, '60/1')
        assert.ok(metadata.streams.some(stream => stream.codec_type === 'audio'))
        evidence.export = { output, elapsedMs: performance.now() - exportAt, metadata, comparisons: [] }
        for (const frame of [0, 60, 89, 90, 120]) {
          const png = path.join(root, `export-${frame}.png`)
          execFileSync(ffmpegPath, ['-v', 'error', '-y', '-i', output, '-vf', `select=eq(n\\,${frame})`, '-frames:v', '1', png], { windowsHide: true })
          const [a, b] = await Promise.all([sharp(path.join(root, `preview-${frame}.png`)).removeAlpha().raw().toBuffer(), sharp(png).removeAlpha().raw().toBuffer()])
          let square = 0; for (let index = 0; index < a.length; index++) square += (a[index] - b[index]) ** 2
          const psnr = 10 * Math.log10(255 ** 2 / (square / a.length)); evidence.export.comparisons.push({ frame, psnr }); assert.ok(psnr > 24, `代码混剪预览/导出不一致：${psnr}`)
        }
        const pcm = execFileSync(ffmpegPath, ['-v', 'error', '-i', output, '-vn', '-f', 'f32le', '-ac', '1', '-ar', '48000', '-'], { windowsHide: true, maxBuffer: 4e6 })
        const samples = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 4)
        evidence.export.audioRms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length); assert.ok(evidence.export.audioRms > .01)
        const savedContent = JSON.parse(fs.readFileSync(file, 'utf8'))
        assert.ok(!/"(program|shader|instructions)"/.test(JSON.stringify(savedContent))); assert.deepEqual(savedContent.codeMaterials.map(definition => definition.versions[0].source), [dynamicSource, staticSource])
        await button(page, '关闭工程').click(); await waitReleased(page)
        evidence.released = await workerSnapshot(page)
        const releases = evidence.released.events.filter(event => event.kind === 'dispose.completed' && event.codeResources?.gpu)
        assert.ok(releases.length >= 3, '试渲染、预览、导出都需释放代码GPU')
        for (const release of releases) {
          const { gpu, sources } = release.codeResources
          assert.equal(gpu.residentBytes, 0); assert.equal(gpu.surfaces, 0); assert.equal(gpu.glyphs, 0); assert.equal(gpu.pipelines, 0)
          assert.equal(sources.programs, 0); assert.equal(sources.compiler.activeWorkers, 0); assert.equal(sources.compiler.pending, 0)
          if (release.codeResources.images) { assert.equal(release.codeResources.images.textures, 0); assert.equal(release.codeResources.images.bytes, 0); assert.equal(release.codeResources.decodedImages, 0) }
        }
        const hot = evidence.playback.resources.filter(event => event.kind === 'render.completed' && event.presented && event.codeResources?.gpu && event.frame > 2 && event.frame < 89)
        const byWorker = new Map(); for (const event of hot) { const items = byWorker.get(event.worker) ?? []; items.push(event); byWorker.set(event.worker, items) }
        const largest = [...byWorker.values()].sort((a, b) => b.length - a.length)[0]
        const first = largest[0].codeResources; const last = largest.at(-1).codeResources
        assert.equal(first.sources.compiler.workerStarts, last.sources.compiler.workerStarts); assert.equal(first.gpu.pipelineCompiles, last.gpu.pipelineCompiles)
        assert.equal(first.gpu.externalCopies, last.gpu.externalCopies, '热帧不能重复上传字形'); assert.equal(first.gpu.textureAllocations, last.gpu.textureAllocations)
        if (control) { assert.equal(first.images.uploads, last.images.uploads, '同图代码/普通片段热帧不能重复上传'); assert.equal(first.decodedImages, 1); assert.equal(last.decodedImages, 1) }
        evidence.codeHotResources = { first, last }
        await dialogs(app, [file], output); await button(page, '打开工程').click(); await presented(page, 0); await seek(page, 120)
        const reopened = JSON.parse(fs.readFileSync(file, 'utf8')); assert.deepEqual(reopened, savedContent)
        assert.equal(await page.getByLabel('剪辑画面', { exact: true }).evaluate(canvas => canvas.toDataURL('image/png')), snapshots[120], '保存重开后固定代码画面保持一致')
        await capture('code-mixed-reopened')
        for (const original of originals) { assert.equal(fs.statSync(original.file).size, original.size); assert.equal(fs.statSync(original.file).mtimeMs, original.mtime) }
        evidence.savedReopened = true; evidence.originalFilesUnchanged = true; evidence.completed = true; saveEvidence()
      } catch (error) { evidence.failed = String(error); saveEvidence(); await capture('code-project-failed').catch(() => {}); throw error }
      finally { await client?.close(); await disableMcp(page).catch(() => {}); await button(page, '关闭工程').click().catch(() => {}); await waitReleased(page).catch(() => {}) }
    },
  }
}
module.exports = { createVideoEditCodeProjectScene }
