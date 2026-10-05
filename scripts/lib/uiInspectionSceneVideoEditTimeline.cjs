const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope } = require('./uiInspectionMcpClient.cjs')
const { observeWorkers, workerSnapshot, waitReleased } = require('./uiInspectionSceneVideoEditLayout.cjs')

const button = (page, name) => page.getByRole('button', { name, exact: true })
const clipNode = (page, id) => page.locator('[data-video-edit-clip="' + id + '"]')
const quantile = (values, q) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * q))] ?? 0
async function saved(page, file, matches) {
  for (let attempt = 0; attempt < 120; attempt++) {
    const document = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (matches(document)) return document
    await page.waitForTimeout(50)
  }
  assert.fail('静默保存没有到达预期剪辑状态')
}
async function presented(page, frame) {
  await page.waitForFunction(frame => document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame === String(frame), frame, { timeout: 90000 })
}
function expandTracks(document) {
  const sequence = document.sequences[0]
  sequence.tracks = Array.from({ length: 32 }, (_, index) => ({ id: document.id + '-track-' + index, name: index ? '视频 ' + index : '音频 1', index, kind: index ? 'video' : 'audio', locked: false, enabled: true, muted: false, solo: false, height: 32, syncLocked: true }))
  return document
}
function createVideoEditTimelineScene() {
  return { id: 'video-edit-timeline', surface: '剪辑', name: '剪辑-统一命令真实混剪与32轨500片段4K60', writesUserData: true,
    setup: async (page, app, { capture }) => {
      const root = path.resolve('node_modules/.cache/video-edit-timeline'); fs.mkdirSync(root, { recursive: true })
      const file = path.join(root, 'timeline.henji-video'); const pressureFile = path.join(root, 'pressure.henji-video')
      const project = JSON.parse(fs.readFileSync('node_modules/.cache/video-edit-code-controls/code-project.henji-video', 'utf8'))
      project.id = 'timeline-mixed'; project.name = '原生代码与关联混剪'; project.revision = 0
      project.sequences = [project.sequences[0]]; const sequence = project.sequences[0]
      sequence.id = 'timeline-mixed-sequence'; sequence.annotations = []
      const video = { ...sequence.clips.find(clip => clip.kind === 'video'), id: 'timeline-video', name: '原视频', start: 0, duration: 180, sourceInUs: 0, track: 1, linkId: 'timeline-pair' }
      const audio = { ...sequence.clips.find(clip => clip.kind === 'audio'), id: 'timeline-audio', name: '关联声音', start: 0, duration: 180, sourceInUs: 0, track: 0, linkId: 'timeline-pair' }
      const code = { ...sequence.clips.find(clip => clip.kind === 'code'), id: 'timeline-code', name: '原创代码', start: 0, duration: 180, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, track: 2 }
      sequence.clips = [video, audio, code]
      expandTracks(project); fs.writeFileSync(file, JSON.stringify(project))
      const pressure = expandTracks(JSON.parse(fs.readFileSync('node_modules/.cache/video-edit-scrub-original/scrub.henji-video', 'utf8')))
      pressure.id = 'timeline-pressure'; pressure.name = '32轨500片段原素材4K60'; pressure.revision = 0
      pressure.sequences[0].id = 'timeline-pressure-sequence'
      pressure.sequences[0].clips.push(...Array.from({ length: 497 }, (_, index) => ({ ...pressure.sequences[0].clips[0], id: 'offscreen-' + index, start: 3600 + index * 4, duration: 2, track: 31 })))
      fs.writeFileSync(pressureFile, JSON.stringify(pressure))
      const originals = [...new Set([...project.media, ...pressure.media].map(media => media.path))].map(file => ({ file, size: fs.statSync(file).size, mtime: fs.statSync(file).mtimeMs }))
      const evidence = { originalPaths: originals, phases: [] }; let client
      const store = () => fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
      const open = async file => { await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }) }, file); await button(page, '打开项目文件').click(); await presented(page, 0) }
      await observeWorkers(page)
      try {
        await button(page, '剪辑').click(); await open(file)
        const identity = await authorizeMcpConnection(page, { name: '剪辑命令回环', allowWrites: true, allowDestructive: true })
        client = await connectMcpClient(identity.config, 'Henji timeline Reality')
        const projectRef = { kind: 'video_edit.project', id: project.id }
        const read = async (ref, propertyIds) => callTool(client, 'read_application_entity', { ref, propertyIds })
        const change = async (ref, properties) => {
          const baseline = await read(ref, Object.keys(properties))
          const result = await callTool(client, 'change_application_entities', operationEnvelope([baseline], { summary: '真实混剪命令验收', changes: [{ kind: 'set_properties', entityType: ref.kind, target: ref, properties }] }))
          assert.equal(result.executionState, 'completed', JSON.stringify(result)); assert.equal(result.verificationState, 'verified', JSON.stringify(result)); return result
        }
        const view = async () => (await read(projectRef, ['video_edit.project.timeline_view'])).data.properties['video_edit.project.timeline_view']
        const frame = async value => { await change(projectRef, { 'video_edit.project.program_playback': { frame: value, playing: false, playbackDirection: 1 } }); await presented(page, value) }
        const timeline = page.locator('[data-video-edit-timeline-viewport]')
        await clipNode(page, video.id).getByRole('button', { name: '选择片段 原视频', exact: true }).click()
        await clipNode(page, code.id).getByRole('button', { name: '选择片段 原创代码', exact: true }).click({ modifiers: ['Control'] })
        assert.deepEqual(new Set((await view()).selectedClipIds), new Set([video.id, audio.id, code.id]))
        const box = await clipNode(page, video.id).boundingBox(); const beforeDrag = fs.readFileSync(file, 'utf8')
        await page.mouse.move(box.x + 50, box.y + 12); await page.mouse.down(); await page.mouse.move(box.x + 70, box.y + 12, { steps: 16 })
        assert.equal(fs.readFileSync(file, 'utf8'), beforeDrag, '指针预览不能写工程')
        await page.mouse.up()
        await saved(page, file, document => document.sequences[0].clips.every(clip => clip.start === 20))
        await button(page, '撤销').click(); await saved(page, file, document => document.sequences[0].clips.every(clip => clip.start === 0))
        await frame(60); await timeline.focus(); await timeline.press('Control+k')
        await saved(page, file, document => document.sequences[0].clips.length === 6)
        await button(page, '撤销').click(); await saved(page, file, document => document.sequences[0].clips.length === 3)
        await timeline.focus(); await timeline.press('Control+c'); await frame(200); await timeline.focus(); await timeline.press('Control+v')
        await saved(page, file, document => document.sequences[0].clips.length === 6 && document.sequences[0].clips.filter(clip => clip.start === 200).length === 3)
        await timeline.focus(); await timeline.press('Delete'); await saved(page, file, document => document.sequences[0].clips.length === 3)
        await button(page, '撤销').click(); await saved(page, file, document => document.sequences[0].clips.length === 6)
        await button(page, '撤销').click(); await saved(page, file, document => document.sequences[0].clips.length === 3)
        await frame(0)
        const search = page.getByLabel('搜索项目素材', { exact: true }); await search.fill('中文输入'); await search.press('v')
        await search.evaluate(input => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Process', code: 'KeyC', isComposing: true, bubbles: true })))
        assert.equal((await view()).tool, 'select'); await search.fill('')
        await clipNode(page, video.id).click({ button: 'right' })
        await page.getByRole('menuitem', { name: /打开源素材/ }).click()
        await page.waitForFunction(() => document.querySelector('[data-video-edit-source-status]')?.dataset.videoEditSourceStatus === 'ready')
        const sourceRef = { kind: 'video_edit.source', id: project.id + ':source' }
        await change(sourceRef, { 'video_edit.source.time_us': 1000000, 'video_edit.source.playing': false })
        const sourceHost = page.locator('[data-video-edit-source-status]'); await sourceHost.focus(); await sourceHost.press('i')
        await change(sourceRef, { 'video_edit.source.time_us': 2000000 }); await sourceHost.focus(); await sourceHost.press('o')
        const sourceRead = async () => (await read(sourceRef, ['video_edit.source.time_us', 'video_edit.source.presented_time_us', 'video_edit.source.in_us', 'video_edit.source.out_us', 'video_edit.source.playing', 'video_edit.source.playback_direction', 'video_edit.source.status', 'video_edit.source.error'])).data.properties
        evidence.sourceRange = await sourceRead(); assert.equal(evidence.sourceRange['video_edit.source.in_us'], 1000000); assert.equal(evidence.sourceRange['video_edit.source.out_us'], 2016667)
        const positionBeforeInput = await page.getByRole('slider', { name: '剪辑时间定位' }).getAttribute('aria-valuenow')
        await page.getByLabel('源素材定位秒', { exact: true }).press('ArrowLeft')
        assert.equal(await page.getByRole('slider', { name: '剪辑时间定位' }).getAttribute('aria-valuenow'), positionBeforeInput)
        await sourceHost.focus(); await page.waitForFunction(() => document.querySelector('[data-video-edit-source-status]')?.dataset.videoEditSourceStatus === 'ready')
        // 2.4 交接（3.5 修正，不放宽）：原生计划 104689d0 起源监视器画面是 canvas，没有 <video muted>。“反向静音”按当前契约证明：
        // 反向浏览全程采样源电平始终为零且源状态为反向；源素材释放后再正向播放同一素材，源电平须出声（证明电平是活的、素材有声）。
        await page.locator('[data-video-edit-source-host]').evaluate(host => { window.__reverseSourceFrames = []; window.__reverseSourceObserver = new MutationObserver(records => { for (const record of records) if (record.attributeName === 'data-presented-time-us') { const canvas = record.target; window.__reverseSourceFrames.push({ at: performance.now(), mediaTime: Number(canvas.dataset.presentedTimeUs) / 1e6, width: canvas.width, height: canvas.height, cacheHits: Number(canvas.dataset.cacheHits), cacheBytes: Number(canvas.dataset.cacheBytes), decodeMs: Number(canvas.dataset.decodeMs), gpuMs: Number(canvas.dataset.gpuMs) }) } }); window.__reverseSourceObserver.observe(host, { subtree: true, attributes: true, attributeFilter: ['data-presented-time-us'] }) })
        // 原生计划起源监视器打开即持有一个原生画面 Worker（关闭源素材才释放）：反向浏览不得多留 Worker，关闭源素材后只剩节目 Worker。
        const liveBeforeReverse = await page.evaluate(() => window.__videoLayoutEvidence.workers.filter(worker => !worker.terminated).length)
        await page.evaluate(() => { window.__reverseLevelSamples = []; window.__reverseLevelTimer = setInterval(() => window.__reverseLevelSamples.push([...(document.querySelector('[aria-label="源播放电平"]')?.querySelectorAll('[data-video-edit-level-channel]') ?? [])].map(node => ({ peak: Number(node.dataset.peak), rms: Number(node.dataset.rms) }))), 50) })
        await sourceHost.press('j')
        try { await page.waitForFunction(() => { const canvas = document.querySelector('[data-video-edit-source-canvas]'); return canvas && Number(canvas.dataset.presentedTimeUs) < 1980000 }, null, { timeout: 10000 }) }
        catch (error) { evidence.reverseFailure = { state: await sourceRead(), native: await page.locator('[data-video-edit-source-canvas]').evaluate(canvas => ({ ...canvas.dataset })).catch(() => null) }; await capture('timeline-source-reverse-failure'); throw error }
        evidence.reverseState = await sourceRead()
        assert.equal(evidence.reverseState['video_edit.source.playback_direction'], -1, '源监视器应处于反向浏览')
        await page.waitForTimeout(1000)
        evidence.reversePresentations = await page.evaluate(() => { window.__reverseSourceObserver.disconnect(); return window.__reverseSourceFrames })
        evidence.reversePreparation = await page.locator('[data-video-edit-source-canvas]').evaluate(canvas => ({ width: canvas.width, height: canvas.height, ...canvas.dataset }))
        evidence.reverseLevels = await page.evaluate(() => { clearInterval(window.__reverseLevelTimer); return window.__reverseLevelSamples })
        assert.ok(evidence.reverseLevels.length >= 10, `反向浏览期间源电平采样不足：${evidence.reverseLevels.length}`)
        assert.ok(evidence.reverseLevels.every(sample => sample.length > 0 && sample.every(channel => channel.peak < .00001 && channel.rms < .00001)), '源反向浏览必须静音：采样期间源电平须始终为零')
        await sourceHost.press('k'); await page.waitForFunction(() => document.querySelector('[data-video-edit-source-status]')?.dataset.videoEditSourceStatus === 'ready')
        evidence.reverseSource = await sourceRead(); assert.ok(evidence.reverseSource['video_edit.source.presented_time_us'] < 1983333); assert.equal(evidence.reverseSource['video_edit.source.playing'], false)
        if (evidence.reversePresentations.length > 1) { const samples = evidence.reversePresentations; evidence.reverseSourceUpdatesPerSecond = (samples.length - 1) * 1000 / (samples.at(-1).at - samples[0].at) }
        assert.ok(evidence.reverseSourceUpdatesPerSecond >= 58, '源反向浏览也须保持4K60实际画面更新')
        assert.ok(evidence.reversePresentations.every(sample => sample.width === 3840 && sample.height === 2160 && sample.cacheBytes <= 3 * 1024 ** 3))
        const stoppedAt = await page.locator('[data-video-edit-source-canvas]').evaluate(canvas => canvas.dataset.presentedTimeUs)
        await page.waitForTimeout(300)
        assert.equal(await page.locator('[data-video-edit-source-canvas]').evaluate(canvas => canvas.dataset.presentedTimeUs), stoppedAt, '停止后源画面不得继续前进或后退')
        await page.waitForFunction(live => window.__videoLayoutEvidence.workers.filter(worker => !worker.terminated).length === live, liveBeforeReverse, { timeout: 10000 })
        evidence.sourceReleased = await workerSnapshot(page)
        await change(sourceRef, { 'video_edit.source.time_us': 1000000, 'video_edit.source.playing': false }); await sourceHost.focus()
        await page.waitForFunction(() => document.querySelector('[data-video-edit-source-status]')?.dataset.videoEditSourceStatus === 'ready')
        await sourceHost.press('l')
        await page.waitForFunction(() => [...(document.querySelector('[aria-label="源播放电平"]')?.querySelectorAll('[data-video-edit-level-channel]') ?? [])].some(node => Number(node.dataset.peak) > .01 && Number(node.dataset.rms) > .003), null, { timeout: 10000 })
        evidence.forwardSourceLevels = await page.evaluate(() => [...(document.querySelector('[aria-label="源播放电平"]')?.querySelectorAll('[data-video-edit-level-channel]') ?? [])].map(node => ({ peak: Number(node.dataset.peak), rms: Number(node.dataset.rms) })))
        await sourceHost.press('k'); await page.waitForFunction(() => document.querySelector('[data-video-edit-source-status]')?.dataset.videoEditSourceStatus === 'ready')
        await capture('timeline-source-range-and-tracks'); await button(page, '关闭源素材').click()
        await page.waitForFunction(() => window.__videoLayoutEvidence.workers.filter(worker => !worker.terminated).length === 1, null, { timeout: 10000 })
        await button(page, '视频 1锁定').click()
        await clipNode(page, video.id).getByRole('button', { name: '选择片段 原视频', exact: true }).click()
        await timeline.focus(); await timeline.press('Delete'); await page.waitForTimeout(100)
        assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).sequences[0].clips.length, 3)
        await button(page, '视频 1锁定').click(); await saved(page, file, document => !document.sequences[0].tracks[1].locked)
        await capture('timeline-mixed-command-result')
        evidence.phases.push('关联多选移动一次历史、代码视频共同拆分、复制粘贴删除撤销、输入和IME保护、源I/O与J/K、锁定跨命令')
        const savedBeforeReopen = JSON.parse(fs.readFileSync(file, 'utf8')); await button(page, '关闭项目').click(); await waitReleased(page); await open(file)
        assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), savedBeforeReopen)
        assert.equal(await page.locator('[data-video-edit-track]').count(), 32)
        await button(page, '关闭项目').click(); await waitReleased(page)
        const openedAt = performance.now(); await open(pressureFile); evidence.firstFrameMs = performance.now() - openedAt
        const canvas = page.getByLabel('剪辑画面', { exact: true })
        evidence.firstFrame = await canvas.evaluate(canvas => ({ width: canvas.width, height: canvas.height, ...canvas.dataset }))
        assert.equal(evidence.firstFrame.width, 3840); assert.equal(evidence.firstFrame.height, 2160)
        assert.equal(await page.locator('[data-video-edit-track]').count(), 32)
        evidence.visibleClips = await page.locator('[data-video-edit-clip]').count(); assert.ok(evidence.visibleClips < 20, '500片段只绘制视口内对象')
        const pressureRef = { kind: 'video_edit.project', id: pressure.id }
        const pressureFrame = async (frame, playing, playbackDirection) => change(pressureRef, { 'video_edit.project.program_playback': { frame, playing, playbackDirection } })
        const pressureTimeline = page.locator('[data-video-edit-timeline-viewport]')
        await pressureTimeline.focus(); await pressureTimeline.press('Control+a'); await pressureTimeline.press('Control+c')
        const pressureView = (await read(pressureRef, ['video_edit.project.timeline_view'])).data.properties['video_edit.project.timeline_view']
        assert.equal(pressureView.selectedClipIds.length, 500)
        await pressureFrame(179, false, 1); await presented(page, 179); await pressureFrame(0, false, 1); await presented(page, 0)
        evidence.playback = []
        for (const direction of [1, -1]) {
          const from = direction === 1 ? 0 : 179; const to = direction === 1 ? 179 : 0
          await pressureFrame(from, false, direction); await presented(page, from)
          await canvas.evaluate(canvas => { window.__timelineFrames = []; window.__timelineFrameObserver = new MutationObserver(() => window.__timelineFrames.push({ at: performance.now(), frame: Number(canvas.dataset.presentedFrame), requestedAt: Number(canvas.dataset.requestedAt), decodeMs: Number(canvas.dataset.decodeMs), gpuMs: Number(canvas.dataset.gpuMs), cacheHits: Number(canvas.dataset.cacheHits), timestamps: canvas.dataset.sourceTimestamps })); window.__timelineFrameObserver.observe(canvas, { attributes: true, attributeFilter: ['data-presented-frame'] }) })
          await pressureFrame(from, true, direction)
          try { await page.waitForFunction(frame => window.__timelineFrames.some(sample => sample.frame === frame), to, { timeout: 90000 }) }
          catch (error) { evidence.playbackFailure = { direction, canvas: await canvas.evaluate(canvas => ({ width: canvas.width, height: canvas.height, ...canvas.dataset })), samples: await page.evaluate(() => window.__timelineFrames) }; store(); await capture('timeline-playback-failure'); throw error }
          const samples = await canvas.evaluate(() => { window.__timelineFrameObserver.disconnect(); return window.__timelineFrames })
          const clockStart = await canvas.evaluate(canvas => Number(canvas.dataset.playClockStartAt))
          await pressureFrame(to, false, direction)
          const wanted = Array.from({ length: 179 }, (_, index) => from + direction * (index + 1))
          const updates = samples.filter(sample => wanted.includes(sample.frame)); const missing = wanted.filter(frame => !updates.some(sample => sample.frame === frame))
          const durationMs = updates.at(-1).at - clockStart
          const result = { direction, durationMs, actualUpdatesPerSecond: updates.length * 1000 / durationMs, missing, gpuP95Ms: quantile(updates.map(sample => sample.gpuMs), .95), cacheHits: updates.reduce((sum, sample) => sum + sample.cacheHits, 0), samples }
          evidence.playback.push(result); store(); assert.deepEqual(missing, []); assert.ok(result.actualUpdatesPerSecond >= 58, '32轨500片段仍须保持原素材4K60实际呈现'); assert.ok(durationMs < 3100)
        }
        await pressureFrame(0, false, 1); await presented(page, 0)
        const ruler = page.getByRole('slider', { name: '剪辑时间定位' }); const rulerBox = await ruler.boundingBox()
        await canvas.evaluate(canvas => {
          window.__timelineDrag = { inputs: [], frames: [] }
          const ruler = document.querySelector('[aria-label="剪辑时间定位"]')
          window.__timelineInputObserver = new MutationObserver(() => window.__timelineDrag.inputs.push({ at: performance.now(), frame: Number(ruler.getAttribute('aria-valuenow')) }))
          window.__timelineInputObserver.observe(ruler, { attributes: true, attributeFilter: ['aria-valuenow'] })
          window.__timelineDragObserver = new MutationObserver(() => window.__timelineDrag.frames.push({ at: performance.now(), frame: Number(canvas.dataset.presentedFrame), requestedAt: Number(canvas.dataset.requestedAt), decodeMs: Number(canvas.dataset.decodeMs), gpuMs: Number(canvas.dataset.gpuMs), cacheHits: Number(canvas.dataset.cacheHits) }))
          window.__timelineDragObserver.observe(canvas, { attributes: true, attributeFilter: ['data-presented-frame'] })
        })
        await page.mouse.move(rulerBox.x + 6, rulerBox.y + 12); await page.mouse.down()
        const dragStart = performance.now()
        for (let index = 1; index <= 180; index++) { await page.mouse.move(rulerBox.x + index + .1, rulerBox.y + 12); const wait = dragStart + index * 1000 / 60 - performance.now(); if (wait > 0) await page.waitForTimeout(wait) }
        const ended = await page.evaluate(() => performance.now()); await page.mouse.up(); await presented(page, 180)
        const data = await page.evaluate(() => { window.__timelineInputObserver.disconnect(); window.__timelineDragObserver.disconnect(); return window.__timelineDrag })
        const during = data.frames.filter(sample => sample.at <= ended); const latencies = during.map(sample => { const input = data.inputs.find(input => input.frame === sample.frame && input.at <= sample.at); return input ? sample.at - input.at : null }).filter(value => value !== null)
        evidence.drag = { data, updates: during.length, actualUpdatesPerSecond: during.length * 1000 / (ended - (data.inputs[0]?.at ?? ended)), latencyP95Ms: quantile(latencies, .95), settleMs: Math.max(0, data.frames.at(-1).at - ended) }
        store(); assert.ok(evidence.drag.actualUpdatesPerSecond >= 58); assert.ok(evidence.drag.settleMs < 100); assert.ok(evidence.drag.latencyP95Ms < 100)
        await capture('timeline-32-tracks-500-clips-4k60')
        evidence.finalCanvas = await canvas.evaluate(canvas => ({ width: canvas.width, height: canvas.height, ...canvas.dataset }))
        await button(page, '关闭项目').click(); await waitReleased(page); evidence.resources = await workerSnapshot(page); assert.equal(evidence.resources.live, 0)
        for (const original of originals) { assert.equal(fs.statSync(original.file).size, original.size); assert.equal(fs.statSync(original.file).mtimeMs, original.mtime) }
        evidence.completed = true; store()
      } finally {
        evidence.resources = await workerSnapshot(page).catch(() => evidence.resources); store()
        if (client) await client.close().catch(() => {}); await disableMcp(page).catch(() => {})
        await page.evaluate(() => { window.__videoLayoutObservers?.forEach(observer => observer.disconnect()); if (window.__videoLayoutNativeWorker) window.Worker = window.__videoLayoutNativeWorker }).catch(() => {})
      }
    },
  }
}
module.exports = { createVideoEditTimelineScene }
