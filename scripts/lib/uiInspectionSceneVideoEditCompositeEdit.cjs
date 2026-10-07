const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope } = require('./uiInspectionMcpClient.cjs')
const { observeWorkers, workerSnapshot, waitReleased } = require('./uiInspectionSceneVideoEditLayout.cjs')
const { dialogs, saved, presented, png, pixelDifference, mediaProbe, trackBanks, quantile } = require('./uiInspectionSceneVideoEditMonitor.cjs')
const { adoptNewVideoEditProject, closeVideoEditDockPanel, leaveVideoEditProject, openVideoEditFile, readVideoEditFile } = require('./uiInspectionVideoEditDocuments.cjs')
const button = (page, name) => page.getByRole('button', { name, exact: true })
// 3.1：剪辑是项目里的文档文件，按旧工程形状读出（夹具路径读它对应的实际剪辑）
const readFile = readVideoEditFile
const filterSource = 'export default {apiVersion:1,name:"原创红色处理",kind:"filter",mode:"static",width:3840,height:2160,durationSeconds:10,seed:21,parameters:{gain:{type:"number",title:"红色增益",default:.8,min:0,max:1,step:.01,animatable:true}},render(ctx){const c=sample(ctx.u,ctx.v);return rgba(c.r*ctx.params.gain,c.g,c.b,c.a);}}'

/** Uses the formal Electron host, actual UI actions, and the same public Modern MCP registry. */
function createVideoEditCompositeEditScene({ pressureOnly = false } = {}) {
  return { id: pressureOnly ? 'video-edit-composite-pressure' : 'video-edit-composite-edit', surface: '剪辑', name: pressureOnly ? '剪辑-完整原4K60代码滤镜压力与释放' : '剪辑-原生图形滤镜转场公共回环与原4K60导出', writesUserData: true,
    setup: async (page, app, { capture }) => {
      const root = path.resolve('node_modules/.cache/video-edit-composite-edit'); fs.mkdirSync(root, { recursive: true })
      const file = path.join(root, 'mixed.henji-video'); const pressureFile = path.join(root, 'pressure.henji-video')
      const mixed = readFile(path.resolve('node_modules/.cache/video-edit-monitor/monitor.henji-video'))
      const pressure = readFile(path.resolve('node_modules/.cache/video-edit-monitor/pressure.henji-video'))
      mixed.id = 'composite-mixed'; mixed.name = '原生图形滤镜转场真实混剪'; mixed.revision = 0
      mixed.sequences[0].sampleRate = 48000; mixed.sequences[0].channels = 2
      pressure.id = 'composite-pressure'; pressure.name = '原4K60完整500片段受控代码滤镜'; pressure.revision = 0
      const sequence = mixed.sequences[0]; const pressureSequence = pressure.sequences[0]
      assert.equal(sequence.width, 3840); assert.equal(sequence.height, 2160)
      assert.deepEqual(sequence.frameRate, { numerator: 60, denominator: 1 })
      assert.equal(pressureSequence.tracks.length, 32); assert.equal(pressureSequence.clips.length, 500); assert.equal(pressureSequence.captions.length, 500)
      const originals = [...new Set([...mixed.media, ...pressure.media].map(media => media.path))].map(file => ({ file, size: fs.statSync(file).size, mtimeMs: fs.statSync(file).mtimeMs }))
      if (!pressureOnly) fs.writeFileSync(file, JSON.stringify(mixed))
      fs.writeFileSync(pressureFile, JSON.stringify(pressure))
      const originalCode = sequence.clips.find(clip => clip.kind === 'code' && clip.track === 5).code
      const dynamicSource = mixed.codeMaterials.find(definition => definition.id === originalCode.definitionId).versions.find(version => version.id === originalCode.versionId).source
      const evidence = { completed: false, phases: [], originals, captures: [], trackBanks: {} }
      const store = () => fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
      const phase = name => { evidence.currentPhase = name; store() }
      const shot = async name => { evidence.captures.push({ name, result: await capture(name) }); store() }
      let client; let previousLayout; let observed = false
      try {
        evidence.display = await app.evaluate(({ BrowserWindow, screen }, { point, hostContentsId }) => {
          const host = (BrowserWindow.getAllWindows().find(window => window.webContents.id === hostContentsId) ?? BrowserWindow.getAllWindows()[0])
          const bounds = host.getBounds(); const current = screen.getDisplayMatching(bounds); const coordinates = point?.split(',').map(Number)
          const selected = coordinates ? screen.getAllDisplays().find(display => coordinates[0] >= display.bounds.x && coordinates[0] < display.bounds.x + display.bounds.width && coordinates[1] >= display.bounds.y && coordinates[1] < display.bounds.y + display.bounds.height) : undefined
          return { windowBounds: bounds, id: current.id, primary: current.id === screen.getPrimaryDisplay().id, bounds: current.bounds, scaleFactor: current.scaleFactor, preferredId: selected?.id }
        }, { point: process.env.HENJI_DEV_DISPLAY_POINT, hostContentsId: await (await app.browserWindow(page)).evaluate((window) => window.webContents.id) })
        if (process.env.HENJI_DEV_DISPLAY_POINT) { assert.ok(evidence.display.preferredId !== undefined); assert.equal(evidence.display.id, evidence.display.preferredId); assert.equal(evidence.display.primary, false) }
        await button(page, '剪辑').click()
        if (await button(page, '关闭项目').isVisible()) await button(page, '关闭项目').click()
        await button(page, '生成').click()
        previousLayout = await page.evaluate(() => localStorage.getItem('henji.videoEdit.dockLayout.v1'))
        await page.evaluate(() => localStorage.removeItem('henji.videoEdit.dockLayout.v1'))
        await observeWorkers(page); observed = true; await button(page, '剪辑').click()
        const open = async target => { await dialogs(app, [target], target); await openVideoEditFile(page, target); await presented(page, 0) }
        if (!pressureOnly) await open(file)
        const identity = await authorizeMcpConnection(page, { name: '原生图形滤镜转场验收', allowWrites: true, allowDestructive: true })
        client = await connectMcpClient(identity.config, 'Henji composite Reality')
        const read = (ref, propertyIds) => callTool(client, 'read_application_entity', { ref, propertyIds })
        const ref = (kind, projectId, id) => ({ kind, id: id ? `${projectId}:${id}` : projectId })
        const projectRef = ref('video_edit.document', mixed.id); const sequenceRef = ref('video_edit.sequence', mixed.id, sequence.id)
        const change = async changes => {
          const owners = [...new Map(changes.flatMap(change => [change.target ?? change.parent, ...(change.targets ?? [])]).map(owner => [`${owner.kind}:${owner.id}`, owner])).values()]
          const baselines = []
          for (const owner of owners) baselines.push(await read(owner))
          const result = await callTool(client, 'change_application_entities', operationEnvelope(baselines, { summary: '真实原生图形与效果编辑', changes }))
          assert.equal(result.executionState, 'completed', JSON.stringify(result)); assert.equal(result.verificationState, 'verified', JSON.stringify(result)); return result
        }
        const set = (target, properties) => change([{ kind: 'set_properties', entityType: target.kind, target, properties }])
        const create = (entityType, parent, properties) => change([{ kind: 'create_items', entityType, parent, items: properties.map(properties => ({ properties })) }])
        const focus = async target => { const result = await callTool(client, 'focus_application_entity', operationEnvelope([], { ref: target })); assert.equal(result.executionState, 'completed', JSON.stringify(result)) }
        const seek = async (target, frame, playing = false, playbackDirection = 1) => {
          await set(target, { 'video_edit.document.program_playback': { frame, playing, playbackDirection } })
          if (!playing) {
            await presented(page, frame)
            const revision = readFile(target.id === mixed.id ? file : pressureFile).revision
            await page.waitForFunction(revision => document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedRevision === String(revision), revision, { timeout: 90000 })
          }
        }
        const pixels = async name => {
          const revision = readFile(file).revision
          await page.waitForFunction(revision => document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedRevision === String(revision), revision, { timeout: 90000 })
          return png(page, path.join(root, name))
        }
        const selected = async clip => { await focus(ref('video_edit.clip', mixed.id, clip.id)); await page.locator('[data-video-edit-panel="effects"]').first().waitFor({ state: 'visible' }) }
        const list = async entityType => (await callTool(client, 'list_application_entities', { entityType, propertyIds: [`${entityType}.name`], limit: 100 })).data.items
        let document
        if (!pressureOnly) {
        const baseVideo = sequence.clips.find(clip => clip.kind === 'video')
        phase('真实界面创建五种原生素材与片段对象树')
        const newItems = []
        for (const label of ['新建纯色', '新建矩形', '新建椭圆', '新建原生文字', '新建调整图层']) {
          const oldIds = new Set(readFile(file).items.map(item => item.id))
          await button(page, '新建素材项').click(); await button(page, label).click()
          const doc = await saved(page, file, value => value.items.some(item => !oldIds.has(item.id)))
          const item = doc.items.find(item => !oldIds.has(item.id)); newItems.push(item)
          assert.equal(item.kind, label === '新建调整图层' ? 'adjustment' : 'graphic')
          if (item.graphic) { assert.equal(item.graphic.width, 3840); assert.equal(item.graphic.height, 2160); assert.equal(item.graphic.objects.length, 1) }
        }
        const rectangle = newItems.find(item => item.name === '矩形'); const adjustment = newItems.find(item => item.kind === 'adjustment')
        assert.ok(rectangle && adjustment)
        await create('video_edit.clip', sequenceRef, [{ 'video_edit.clip.item_id': rectangle.id, 'video_edit.clip.kind': 'graphic', 'video_edit.clip.name': '可编辑原生矩形', 'video_edit.clip.track': 4, 'video_edit.clip.start': 0, 'video_edit.clip.duration': 180 }, { 'video_edit.clip.item_id': adjustment.id, 'video_edit.clip.kind': 'adjustment', 'video_edit.clip.name': '下方画面调整', 'video_edit.clip.track': 6, 'video_edit.clip.start': 0, 'video_edit.clip.duration': 180 }])
        document = await saved(page, file, value => value.sequences[0].clips.some(clip => clip.itemId === rectangle.id))
        const graphicClip = document.sequences[0].clips.find(clip => clip.itemId === rectangle.id); const adjustmentClip = document.sequences[0].clips.find(clip => clip.itemId === adjustment.id)
        const graphicRef = ref('video_edit.clip', mixed.id, graphicClip.id); const adjustmentRef = ref('video_edit.clip', mixed.id, adjustmentClip.id)
        await selected(graphicClip); await seek(projectRef, 60)
        await page.getByLabel('图形对象名称', { exact: true }).fill('底层矩形 · 手动'); await page.getByLabel('图形对象名称', { exact: true }).press('Enter')
        const object = graphicClip.graphic.objects[0]
        document = await saved(page, file, value => value.sequences[0].clips.find(clip => clip.id === graphicClip.id).graphic.objects[0].name === '底层矩形 · 手动')
        const objectEntity = (await list('video_edit.graphic_object')).find(item => item.properties['video_edit.graphic_object.name'] === '底层矩形 · 手动')
        assert.ok(objectEntity?.ref)
        const originalPixels = await pixels('graphic-before.png')
        const objectControls = page.locator(`[data-video-edit-code-parameters="${graphicClip.id}"]`)
        await objectControls.getByLabel('旋转', { exact: true }).fill('25'); await objectControls.getByLabel('旋转', { exact: true }).press('Tab')
        await saved(page, file, value => value.sequences[0].clips.find(clip => clip.id === graphicClip.id).graphic.objects[0].parameters.rotation === 25)
        assert.equal((await read(objectEntity.ref, ['video_edit.graphic_object.parameters'])).data.properties['video_edit.graphic_object.parameters'].rotation, 25)
        await set(objectEntity.ref, { 'video_edit.graphic_object.parameters': { ...document.sequences[0].clips.find(clip => clip.id === graphicClip.id).graphic.objects[0].parameters, rotation: 15, opacity: .65, width: 800, height: 600, x: 1500, y: 500 } })
        assert.equal(Number(await objectControls.getByLabel('旋转', { exact: true }).inputValue()), 15)
        await create('video_edit.graphic_object', graphicRef, [{ 'video_edit.graphic_object.name': '上层椭圆 · Agent', 'video_edit.graphic_object.kind': 'ellipse', 'video_edit.graphic_object.parameters': { x: 1800, y: 700, width: 500, height: 300, fill: [.1, .9, .2, .7] } }, { 'video_edit.graphic_object.name': '原生文字 · Agent', 'video_edit.graphic_object.kind': 'text', 'video_edit.graphic_object.parameters': { text: '原生对象 · 可编辑', x: 1950, y: 600, fontSize: 100 } }])
        document = await saved(page, file, value => value.sequences[0].clips.find(clip => clip.id === graphicClip.id).graphic.objects.length === 3)
        const objects = document.sequences[0].clips.find(clip => clip.id === graphicClip.id).graphic.objects
        const textEntity = (await list('video_edit.graphic_object')).find(item => item.properties['video_edit.graphic_object.name'] === '原生文字 · Agent')
        assert.ok(textEntity?.ref)
        const beforeUnsafe = readFile(file)
        // The archived public rejection proves the MCP boundary. Exercise the
        // same guard through the actual UI here; a deliberate capability failure
        // is logged as an application error by the formal nominal-tour collector.
        await button(page, '选择图形对象原生文字 · Agent').click()
        await objectControls.getByLabel('文字', { exact: true }).fill('W'.repeat(2000))
        await page.getByText(/标题字形超出8192宽或四百万像素/).waitFor({ state: 'visible' })
        await objectControls.getByLabel('文字', { exact: true }).blur()
        assert.deepEqual(readFile(file), beforeUnsafe)
        assert.equal(await objectControls.getByLabel('文字', { exact: true }).inputValue(), objects.find(object => object.kind === 'text').parameters.text)
        evidence.nativeBudgetRefusal = { textRef: textEntity.ref, channel: 'real UI shared publication guard', preservedDocument: true }
        const objectRows = await page.locator('[data-video-edit-graphic-object]').evaluateAll(nodes => nodes.map(node => node.dataset.videoEditGraphicObject))
        assert.deepEqual(objectRows, objects.map(object => object.id).reverse())
        await set(graphicRef, { 'video_edit.clip.graphic_object_ids': [objects[1].id, objects[0].id, objects[2].id] })
        await seek(projectRef, 60)
        const graphicPixels = await pixels('graphic-after.png')
        assert.ok((await pixelDifference(originalPixels.file, graphicPixels.file)).changedChannels > 1000)
        evidence.native = { newItemIds: newItems.map(item => item.id), graphicRef, objectRef: objectEntity.ref, objectIds: objects.map(object => object.id), templateUnaffected: readFile(file).items.find(item => item.id === rectangle.id).graphic.objects[0].parameters.rotation === 0 }
        assert.ok(evidence.native.templateUnaffected)
        await shot('composite-native-objects-agent-loop')
        phase('任意新滤镜源码、效果链与固定版本候选真实试渲染')
        await selected(baseVideo)
        await button(page, '编写新滤镜源码').click(); await page.getByLabel('作者源码', { exact: true }).fill(filterSource)
        await button(page, '检查并创建滤镜源码').click(); await page.getByRole('dialog', { name: '编写新滤镜源码', exact: true }).waitFor({ state: 'hidden', timeout: 45000 })
        document = await saved(page, file, value => value.codeMaterials.some(definition => definition.name === '原创红色处理'))
        const definition = document.codeMaterials.find(definition => definition.name === '原创红色处理')
        assert.equal(document.items.filter(item => item.code?.definitionId === definition.id).length, 0)
        await button(page, '添加到片段').click()
        document = await saved(page, file, value => value.sequences[0].clips.find(clip => clip.id === baseVideo.id).effects?.length === 1)
        const effect = document.sequences[0].clips.find(clip => clip.id === baseVideo.id).effects[0]; const effectRef = ref('video_edit.effect', mixed.id, effect.id)
        await seek(projectRef, 60)
        const beforeGain = await pixels('filter-before-gain.png')
        await page.getByLabel('红色增益', { exact: true }).evaluate(input => {
          window.__compositeParameter = { inputs: [], frames: [] }
          const state = window.__compositeParameter; input.addEventListener('input', () => state.inputs.push(performance.now()), { once: true })
          const canvas = document.querySelector('canvas[aria-label="剪辑画面"]')
          window.__compositeParameterObserver = new MutationObserver(() => state.frames.push({ at: performance.now(), requestedAt: Number(canvas.dataset.requestedAt), frame: Number(canvas.dataset.presentedFrame), gpuMs: Number(canvas.dataset.gpuMs) }))
          window.__compositeParameterObserver.observe(canvas, { attributes: true, attributeFilter: ['data-presented-frame'] })
        })
        await page.getByLabel('红色增益', { exact: true }).fill('.6'); await page.getByLabel('红色增益', { exact: true }).press('Tab')
        await saved(page, file, value => value.sequences[0].clips.find(clip => clip.id === baseVideo.id).effects[0].code.parameters.gain === .6)
        await page.waitForFunction(() => window.__compositeParameter.frames.some(sample => sample.requestedAt >= window.__compositeParameter.inputs[0]))
        evidence.parameter = await page.evaluate(() => { window.__compositeParameterObserver.disconnect(); const state = window.__compositeParameter; const frame = state.frames.find(sample => sample.requestedAt >= state.inputs[0]); return { ...state, inputToPresentedMs: frame.at - state.inputs[0], includesPixelReadback: false } })
        assert.ok(evidence.parameter.inputToPresentedMs < 100)
        const afterGain = await pixels('filter-after-gain.png'); assert.ok((await pixelDifference(beforeGain.file, afterGain.file)).changedChannels > 1000)
        assert.equal((await read(effectRef, ['video_edit.effect.parameters'])).data.properties['video_edit.effect.parameters'].gain, .6)
        await page.getByLabel('效果强度', { exact: true }).fill('.5'); await button(page, '应用强度').click()
        await saved(page, file, value => value.sequences[0].clips.find(clip => clip.id === baseVideo.id).effects[0].amount === .5)
        await set(effectRef, { 'video_edit.effect.amount': .75, 'video_edit.effect.parameters': { gain: .7 } })
        assert.equal(Number(await page.getByLabel('红色增益', { exact: true }).inputValue()), .7)
        await button(page, '查看与编辑源码').click()
        const revised = filterSource.replace('c.g,c.b', 'c.g*.95,c.b')
        await page.getByLabel('代码素材源码', { exact: true }).fill(revised); await button(page, '检查并预览').click()
        await page.getByLabel('源码候选预览', { exact: true }).waitFor({ state: 'visible', timeout: 45000 })
        assert.equal(readFile(file).sequences[0].clips.find(clip => clip.id === baseVideo.id).effects[0].code.versionId, effect.code.versionId)
        await shot('composite-filter-source-candidate'); await button(page, '应用已检查源码').click()
        document = await saved(page, file, value => value.sequences[0].clips.find(clip => clip.id === baseVideo.id).effects[0].code.versionId !== effect.code.versionId)
        const fixed = document.sequences[0].clips.find(clip => clip.id === baseVideo.id).effects[0].code
        assert.equal(document.codeMaterials.find(value => value.id === definition.id).defaultVersionId, definition.defaultVersionId)
        assert.equal((await read(effectRef, ['video_edit.effect.version_id'])).data.properties['video_edit.effect.version_id'], fixed.versionId)
        // The final edit uses the processed graphic followed by the adjustment,
        // with the original source effect retained and disabled in its chain.
        await set(effectRef, { 'video_edit.effect.enabled': false })
        await selected(graphicClip)
        await page.getByLabel('复制效果的来源片段', { exact: true }).click(); await page.getByRole('option', { name: `${sequence.name} · ${baseVideo.name}`, exact: true }).click()
        await button(page, '复制并替换当前效果链').click()
        document = await saved(page, file, value => value.sequences[0].clips.find(clip => clip.id === graphicClip.id).effects?.length === 1)
        assert.notEqual(document.sequences[0].clips.find(clip => clip.id === graphicClip.id).effects[0].id, effect.id)
        await create('video_edit.effect', graphicRef, [{ 'video_edit.effect.definition_id': definition.id, 'video_edit.effect.version_id': fixed.versionId, 'video_edit.effect.name': '第二真实处理', 'video_edit.effect.amount': .25 }])
        document = await saved(page, file, value => value.sequences[0].clips.find(clip => clip.id === graphicClip.id).effects?.length === 2)
        const secondId = document.sequences[0].clips.find(clip => clip.id === graphicClip.id).effects[1].id
        await page.locator(`[data-video-edit-effect="${secondId}"]`).click(); await button(page, '上移效果').click()
        await saved(page, file, value => value.sequences[0].clips.find(clip => clip.id === graphicClip.id).effects[0].id === secondId)
        await page.getByRole('switch', { name: '启用所选效果', exact: true }).click(); await saved(page, file, value => value.sequences[0].clips.find(clip => clip.id === graphicClip.id).effects[0].enabled === false)
        await button(page, '重置效果与关键帧').click(); await saved(page, file, value => value.sequences[0].clips.find(clip => clip.id === graphicClip.id).effects[0].enabled === true && value.sequences[0].clips.find(clip => clip.id === graphicClip.id).effects[0].amount === 1)
        await button(page, '删除所选效果').click(); await saved(page, file, value => value.sequences[0].clips.find(clip => clip.id === graphicClip.id).effects.length === 1)
        await button(page, '重置效果与关键帧').click()
        await saved(page, file, value => { const effect = value.sequences[0].clips.find(clip => clip.id === graphicClip.id).effects[0]; return effect.enabled && effect.amount === 1 })
        // A short native card precedes the title transition; all code, image,
        // original video and audio clips keep their real three-second range.
        await set(graphicRef, { 'video_edit.clip.duration': 80 })
        phase('真实调整范围与同轨代码转场，保存重开后像素一致')
        await set(adjustmentRef, { 'video_edit.clip.adjustment_from_track': 2 })
        await create('video_edit.effect', adjustmentRef, [{ 'video_edit.effect.definition_id': definition.id, 'video_edit.effect.version_id': fixed.versionId, 'video_edit.effect.name': '真实下方处理', 'video_edit.effect.amount': 1 }])
        await selected(adjustmentClip)
        assert.equal(await page.getByLabel('水平位移', { exact: true }).count(), 0)
        await page.getByLabel('调整图层起始画面轨道', { exact: true }).click(); await page.getByRole('option', { name: sequence.tracks.find(track => track.index === 3).name, exact: true }).click()
        await saved(page, file, value => value.sequences[0].clips.find(clip => clip.id === adjustmentClip.id).adjustment.fromTrack === 3)
        const pair = sequence.clips.filter(clip => clip.kind === 'code' && clip.track === 5).sort((a, b) => a.start - b.start)
        assert.equal(pair.length, 2); await selected(pair[0]); await page.getByLabel('交叉溶解时长帧', { exact: true }).fill('12'); await button(page, '添加交叉溶解').click()
        document = await saved(page, file, value => value.sequences[0].transitions?.length === 1)
        const transition = document.sequences[0].transitions[0]; const transitionRef = ref('video_edit.transition', mixed.id, transition.id)
        await set(transitionRef, { 'video_edit.transition.duration_frames': 16 }); assert.equal(Number(await page.getByLabel('交叉溶解时长帧', { exact: true }).inputValue()), 16)
        const preview = new Map()
        for (const frame of [60, 81, 82, 89, 90, 97, 98, 120]) { await seek(projectRef, frame); preview.set(frame, await pixels(`preview-${frame}.png`)) }
        const snapshot = readFile(file); evidence.trackBanks = { mixed: await trackBanks(page) }
        await shot('composite-mixed-transition-4k'); await button(page, '关闭项目').click(); await waitReleased(page); await open(file)
        assert.deepEqual(readFile(file), snapshot); await seek(projectRef, 90)
        const reopened = await pixels('reopened-90.png'); assert.ok((await pixelDifference(reopened.file, preview.get(90).file)).equal)
        evidence.savedReopened = true; evidence.public = { effectRef, fixedVersion: fixed.versionId, transitionRef, graphicRef, adjustmentRef }
        phase('真实4K60音画图形代码滤镜转场MP4导出回读')
        const { ffmpegPath, ffprobePath } = require('./mediaBinaries.cjs')
        const output = path.join(root, `mixed-4k60-${Date.now()}.mp4`); await dialogs(app, [file], output)
        const began = performance.now(); await button(page, '导出视频').click()
        let task
        for (let attempt = 0; attempt < 2400; attempt++) { task = await callTool(client, 'query_video_edit_export', { documentRef: projectRef }); if (['completed', 'failed', 'cancelled'].includes(task.data.task?.state)) break; await page.waitForTimeout(50) }
        assert.equal(task.data.task?.state, 'completed', JSON.stringify(task))
        const metadata = mediaProbe(ffprobePath, output); const video = metadata.streams.find(stream => stream.codec_type === 'video'); const audio = metadata.streams.find(stream => stream.codec_type === 'audio')
        assert.equal(video.width, 3840); assert.equal(video.height, 2160); assert.equal(video.avg_frame_rate, '60/1'); assert.equal(Number(video.nb_frames), 180)
        assert.equal(Number(audio.sample_rate), 48000); assert.equal(audio.channels, 2)
        evidence.export = { output, elapsedMs: performance.now() - began, metadata, comparisons: [] }; store()
        for (const [frame, image] of preview) {
          const decoded = path.join(root, `export-${frame}.png`)
          execFileSync(ffmpegPath, ['-v', 'error', '-y', '-i', output, '-vf', `select=eq(n\\,${frame})`, '-frames:v', '1', decoded], { windowsHide: true, timeout: 60000 })
          const difference = await pixelDifference(decoded, image.file); evidence.export.comparisons.push({ frame, difference }); store()
          assert.ok(difference.psnr === null || difference.psnr >= 30, `实际成片须与同帧全分辨率预览匹配：${JSON.stringify({ frame, difference })}`)
        }
        await button(page, '关闭项目').click(); await waitReleased(page)
        evidence.mixedCompleted = true; evidence.phases.push('手动原生对象/源码效果/Modern MCP/保存重开/实际成片全部通过'); store()
        }
        phase('完整500片段500字幕原4K60新增受控代码滤镜压力')
        const { ffprobePath } = require('./mediaBinaries.cjs')
        const originalProbe = mediaProbe(ffprobePath, pressure.media.find(media => media.kind === 'video').path); evidence.originalVideoProbe = originalProbe
        assert.equal(originalProbe.streams.find(stream => stream.codec_type === 'video').width, 3840); assert.equal(originalProbe.streams.find(stream => stream.codec_type === 'video').avg_frame_rate, '60/1')
        const openAt = performance.now(); await open(pressureFile); evidence.firstDecodeMs = performance.now() - openAt
        const pressureRef = ref('video_edit.document', pressure.id); const pressureSeqRef = ref('video_edit.sequence', pressure.id, pressureSequence.id)
        const firstFrame = await page.getByLabel('剪辑画面', { exact: true }).evaluate(canvas => ({ width: canvas.width, height: canvas.height, ...canvas.dataset })); evidence.firstFrame = firstFrame
        await create('video_edit.code_material', pressureRef, [{ 'video_edit.code_material.source': dynamicSource }, { 'video_edit.code_material.source': filterSource }])
        document = await saved(page, pressureFile, value => value.codeMaterials?.length === 2)
        const codeItem = document.items.find(item => item.kind === 'code'); const filter = document.codeMaterials.find(definition => definition.name === '原创红色处理'); const textClip = pressureSequence.clips.find(clip => clip.kind === 'text')
        assert.ok(codeItem && filter && textClip)
        await change([{ kind: 'remove_items', entityType: 'video_edit.clip', parent: pressureSeqRef, targets: [ref('video_edit.clip', pressure.id, textClip.id)] }, { kind: 'create_items', entityType: 'video_edit.clip', parent: pressureSeqRef, items: [{ properties: { 'video_edit.clip.item_id': codeItem.id, 'video_edit.clip.kind': 'code', 'video_edit.clip.name': '压力原创动态代码', 'video_edit.clip.track': textClip.track, 'video_edit.clip.start': textClip.start, 'video_edit.clip.duration': textClip.duration } }] }])
        await create('video_edit.effect', ref('video_edit.clip', pressure.id, pressureSequence.clips.find(clip => clip.id === 'base').id), [{ 'video_edit.effect.definition_id': filter.id, 'video_edit.effect.version_id': filter.defaultVersionId, 'video_edit.effect.name': '受控全尺寸处理' }])
        document = await saved(page, pressureFile, value => value.sequences[0].clips.length === 500 && value.sequences[0].clips.find(clip => clip.id === 'base').effects?.length === 1)
        assert.equal(document.sequences[0].tracks.length, 32); assert.equal(document.sequences[0].captions.length, 500)
        const retained = pressureSequence.clips.filter(clip => clip.id !== textClip.id).map(clip => clip.id)
        assert.ok(retained.every(id => document.sequences[0].clips.some(clip => clip.id === id)))
        evidence.pressureWorkload = { tracks: 32, clips: 500, captions: 500, originalVideoClipsRetained: retained.length, replacedTextId: textClip.id, newCodeId: document.sequences[0].clips.find(clip => clip.itemId === codeItem.id).id, effects: 1, resolution: [3840, 2160], nominalFps: 60 }
        evidence.trackBanks.pressure = await trackBanks(page)
        await focus(ref('video_edit.caption', pressure.id, pressureSequence.captions[0].id))
        await page.locator('[data-video-edit-panel="content"]').first().waitFor({ state: 'visible' })
        await page.locator('[data-video-edit-timed-entry]').first().waitFor({ state: 'visible' })
        evidence.visibleCaptionCount = await page.locator('[data-video-edit-timed-entry]').count()
        assert.ok(evidence.visibleCaptionCount > 0 && evidence.visibleCaptionCount < 40)
        await closeVideoEditDockPanel(page, '字幕与标记')
        const canvas = page.getByLabel('剪辑画面', { exact: true }); await seek(pressureRef, 179); await seek(pressureRef, 0)
        evidence.cachedFrame = await canvas.evaluate(canvas => ({ ...canvas.dataset })); evidence.playback = []
        for (const direction of [1, -1]) {
          const from = direction === 1 ? 0 : 179; const to = direction === 1 ? 179 : 0; await seek(pressureRef, from, false, direction)
          await canvas.evaluate(canvas => {
            window.__compositeFrames = []
            window.__compositeFrameObserver = new MutationObserver(() => window.__compositeFrames.push({ at: performance.now(), frame: Number(canvas.dataset.presentedFrame), requestedAt: Number(canvas.dataset.requestedAt), decodeMs: Number(canvas.dataset.decodeMs), gpuMs: Number(canvas.dataset.gpuMs), cacheHits: Number(canvas.dataset.cacheHits), timestamps: canvas.dataset.sourceTimestamps }))
            window.__compositeFrameObserver.observe(canvas, { attributes: true, attributeFilter: ['data-presented-frame'] })
          })
          await seek(pressureRef, from, true, direction)
          try { await page.waitForFunction(frame => window.__compositeFrames.some(sample => sample.frame === frame), to, { timeout: 90000 }) }
          finally { evidence.inFlight = await canvas.evaluate(canvas => ({ data: { ...canvas.dataset }, samples: window.__compositeFrames })); store() }
          const samples = await page.evaluate(() => { window.__compositeFrameObserver.disconnect(); return window.__compositeFrames }); const start = await canvas.evaluate(canvas => Number(canvas.dataset.playClockStartAt))
          await seek(pressureRef, to, false, direction)
          const wanted = Array.from({ length: 179 }, (_, index) => from + direction * (index + 1)); const updates = [...new Map(samples.filter(sample => wanted.includes(sample.frame)).map(sample => [sample.frame, sample])).values()]
          const durationMs = updates.at(-1)?.at - start; const missing = wanted.filter(frame => !updates.some(sample => sample.frame === frame))
          const result = { direction, durationMs, actualFrames: updates.length, actualUpdatesPerSecond: updates.length * 1000 / durationMs, missing, gpuP95Ms: quantile(updates.map(sample => sample.gpuMs), .95), samples }; evidence.playback.push(result); store()
          assert.deepEqual(missing, []); assert.equal(updates.length, 179); assert.ok(result.actualUpdatesPerSecond >= 58); assert.ok(durationMs < 3100)
        }
        await seek(pressureRef, 0)
        const ruler = page.getByRole('slider', { name: '剪辑时间定位' }); const box = await ruler.boundingBox(); assert.ok(box)
        await canvas.evaluate(canvas => {
          const ruler = document.querySelector('[aria-label="剪辑时间定位"]'); window.__compositeDrag = { inputs: [], frames: [] }
          window.__compositeInputObserver = new MutationObserver(() => window.__compositeDrag.inputs.push({ at: performance.now(), frame: Number(ruler.getAttribute('aria-valuenow')) }))
          window.__compositeInputObserver.observe(ruler, { attributes: true, attributeFilter: ['aria-valuenow'] })
          window.__compositeDragObserver = new MutationObserver(() => window.__compositeDrag.frames.push({ at: performance.now(), frame: Number(canvas.dataset.presentedFrame), requestedAt: Number(canvas.dataset.requestedAt), decodeMs: Number(canvas.dataset.decodeMs), gpuMs: Number(canvas.dataset.gpuMs), cacheHits: Number(canvas.dataset.cacheHits) }))
          window.__compositeDragObserver.observe(canvas, { attributes: true, attributeFilter: ['data-presented-frame'] })
        })
        // Diagnostics only (task 3.8): HENJI_COMPOSITE_TRACE=1 records a Chromium trace (GPU and renderer processes) of the drag.
        const tracing = process.env.HENJI_COMPOSITE_TRACE === '1'
        if (tracing) await app.evaluate(({ contentTracing }, categories) => contentTracing.startRecording({ included_categories: categories }), process.env.HENJI_COMPOSITE_TRACE_CATEGORIES ? process.env.HENJI_COMPOSITE_TRACE_CATEGORIES.split(',') : ['gpu', 'gpu.dawn', 'disabled-by-default-gpu.dawn', 'disabled-by-default-gpu.service', 'viz', 'toplevel', 'v8', 'devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink.worker', 'gpu.angle', 'gpu.memory'])
        const mouse = await page.context().newCDPSession(page)
        // Reuse the accepted picture-gesture driver: held movements retain the
        // left button so Chromium keeps the native pointer capture active.
        const mouseEvent = (type, x, buttons = type === 'mouseReleased' ? 0 : 1) => mouse.send('Input.dispatchMouseEvent', { type, x, y: box.y + 12, button: 'left', buttons, force: buttons ? .5 : 0, clickCount: type === 'mouseMoved' ? 0 : 1 })
        let endedAt
        try {
          await mouseEvent('mouseMoved', box.x + 6, 0)
          await mouseEvent('mousePressed', box.x + 6); const dragStart = performance.now()
          for (let index = 1; index <= 180; index++) { await mouseEvent('mouseMoved', box.x + index + .1); const remaining = dragStart + index * 1000 / 60 - performance.now(); if (remaining > 0) await page.waitForTimeout(remaining) }
          endedAt = await page.evaluate(() => performance.now()); await mouseEvent('mouseReleased', box.x + 180.1)
        } finally {
          await mouseEvent('mouseReleased', box.x + 180.1).catch(() => {}); await mouse.detach()
          if (tracing) evidence.dragTracePath = await app.evaluate(({ contentTracing }, target) => contentTracing.stopRecording(target), path.join(root, 'drag.trace.json')).catch(error => String(error))
        }
        evidence.inFlightDrag = await page.evaluate(() => window.__compositeDrag); store()
        await presented(page, 180)
        const drag = await page.evaluate(() => { window.__compositeInputObserver.disconnect(); window.__compositeDragObserver.disconnect(); return window.__compositeDrag })
        const during = drag.frames.filter(sample => sample.at <= endedAt); const latencies = during.map(sample => { const input = drag.inputs.find(input => input.frame === sample.frame && input.at <= sample.at); return input ? sample.at - input.at : null }).filter(value => value !== null)
        const final = drag.frames.findLast(sample => sample.frame === 180); assert.ok(final); assert.ok(latencies.length)
        // Long gaps (task 3.2) attributed to decode / GPU submission when those take at least half of the gap, otherwise to
        // presentation; reported separately, never part of the assertions.
        const longGaps = during.slice(1).map((sample, index) => ({ fromFrame: during[index].frame, toFrame: sample.frame, gapMs: Math.round(sample.at - during[index].at), decodeMs: Math.round(sample.decodeMs), gpuMs: Math.round(sample.gpuMs) })).filter(gap => gap.gapMs > 50).map(gap => ({ ...gap, cause: gap.decodeMs >= gap.gapMs / 2 ? 'decode' : gap.gpuMs >= gap.gapMs / 2 ? 'gpu' : 'presentation' }))
        evidence.drag = { ...drag, actualUpdatesPerSecond: during.length * 1000 / (endedAt - drag.inputs[0].at), latencyP95Ms: quantile(latencies, .95), finalSettleMs: Math.max(0, final.at - endedAt), longGaps }; store()
        assert.ok(evidence.drag.actualUpdatesPerSecond >= 58); assert.ok(evidence.drag.latencyP95Ms < 100); assert.ok(evidence.drag.finalSettleMs < 100)
        await shot('composite-32-track-500-clip-code-filter-original-4k60'); await button(page, '关闭项目').click(); await waitReleased(page)
        evidence.resources = await workerSnapshot(page); assert.equal(evidence.resources.live, 0)
        for (const original of originals) { const now = fs.statSync(original.file); assert.equal(now.size, original.size); assert.equal(now.mtimeMs, original.mtimeMs) }
        evidence.originalsUnchanged = true; evidence.phases.push('完整原4K60压力帧、拖动与释放'); evidence.completed = true; evidence.pressureOnly = pressureOnly; delete evidence.currentPhase; store()
      } catch (error) {
        evidence.failed = { message: String(error.message ?? error), stack: error.stack }; evidence.presentation = await page.getByLabel('剪辑画面', { exact: true }).evaluate(canvas => ({ ...canvas.dataset })).catch(() => null); store()
        await shot('composite-edit-failed').catch(() => {}); throw error
      } finally {
        await page.mouse.up().catch(() => {}); await client?.close().catch(() => {}); await disableMcp(page).catch(() => {})
        await button(page, '关闭项目').click().catch(() => {})
        if (observed) { await waitReleased(page).catch(error => { evidence.releaseFailure = String(error); evidence.completed = false }); evidence.resources = await workerSnapshot(page).catch(() => evidence.resources) }
        await page.evaluate(previous => {
          for (const key of ['__compositeParameterObserver', '__compositeFrameObserver', '__compositeInputObserver', '__compositeDragObserver']) window[key]?.disconnect()
          window.__videoLayoutObservers?.forEach(observer => observer.disconnect()); if (window.__videoLayoutNativeWorker) window.Worker = window.__videoLayoutNativeWorker
          if (previous === null) localStorage.removeItem('henji.videoEdit.dockLayout.v1'); else if (typeof previous === 'string') localStorage.setItem('henji.videoEdit.dockLayout.v1', previous)
        }, previousLayout).catch(() => {}); store()
      }
    },
  }
}
module.exports = { createVideoEditCompositeEditScene }
