const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope } = require('./uiInspectionMcpClient.cjs')
const { observeWorkers, workerSnapshot, waitReleased } = require('./uiInspectionSceneVideoEditLayout.cjs')
const { dialogs, presented } = require('./uiInspectionSceneVideoEditMonitor.cjs')
const button = (page, name) => page.getByRole('button', { name, exact: true })
const group = (page, title) => page.locator('.dv-groupview').filter({ has: button(page, `关闭${title}`) })
const ORIGINAL = process.env.HENJI_PERF_SOURCE || 'D:/视频制作/0A0片头片尾和素材/2021片头V2 4K 60FPS.mp4'
const PROJECT_ID = 'video-edit-performance'
const TILES = 9; const TILE = 420; const TOTAL = TILES * TILE
// Fixed before measuring (5.1): a regression must fail, not be re-tuned.
const TOLERANCE = { updatesPerSecond: 59.0, missingRatio: 0.01, maxGapMs: 100, clockDeviation: 0.01, memoryGrowth: 0.15 }
const GENERATOR = 'export default {apiVersion:1,name:"持续动态标题条",kind:"generator",mode:"dynamic",width:3840,height:2160,durationSeconds:63,seed:5,parameters:{amount:{type:"number",title:"强度",default:.6,min:0,max:1,step:.01,animatable:true}},render(ctx){return [rect({x:200+ctx.time*40,y:1700,width:1200,height:180,fill:[1,.85,.2,ctx.params.amount]}),ellipse({x:3200,y:300+ctx.time*20,width:320,height:320,fill:[.2,.6,1,.7]})];}}'
const FILTER = 'export default {apiVersion:1,name:"受控暖色",kind:"filter",mode:"static",width:3840,height:2160,durationSeconds:63,seed:9,parameters:{warm:{type:"number",title:"暖色",default:.9,min:0,max:1,step:.01,animatable:true}},render(ctx){const c=sample(ctx.u,ctx.v);return rgba(c.r,c.g*ctx.params.warm,c.b*ctx.params.warm,c.a);}}'

function fixture(audioPath) {
  const track = (index, kind, name) => ({ id: `${kind[0]}${index}`, name, index, kind, locked: false, enabled: true, muted: false, solo: false })
  const base = { kind: 'video', track: 1, duration: TILE, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, brightness: 1, text: '' }
  return { format: 'henji-video-project', version: 2, id: PROJECT_ID, name: '标准4K60性能负载', revision: 0,
    media: [{ id: 'original', name: '原4K60片头', path: ORIGINAL, kind: 'video', durationSeconds: 7, width: 3840, height: 2160, hasAudio: false, frameRate: { numerator: 60, denominator: 1 }, frameRateMode: 'sampled-constant' },
      { id: 'music', name: '63秒立体声', path: audioPath, kind: 'audio', durationSeconds: 63, width: 0, height: 0, hasAudio: true }],
    bins: [], items: [{ id: 'original-item', name: '原4K60片头', kind: 'video', mediaId: 'original' }, { id: 'music-item', name: '63秒立体声', kind: 'audio', mediaId: 'music' }],
    sequences: [{ id: 'main', name: '序列 1', width: 3840, height: 2160, frameRate: { numerator: 60, denominator: 1 }, pixelAspectRatio: { numerator: 1, denominator: 1 }, sampleRate: 48000, channels: 2,
      tracks: [track(0, 'audio', '音频 1'), track(1, 'video', '视频 1'), track(2, 'video', '视频 2')],
      clips: [...Array.from({ length: TILES }, (_, index) => ({ ...base, id: `tile-${index}`, itemId: 'original-item', name: `片头${index + 1}`, start: index * TILE })),
        { ...base, id: 'music-clip', itemId: 'music-item', name: '63秒立体声', kind: 'audio', track: 0, start: 0, duration: TOTAL }], annotations: [] }] }
}
const quantile = (values, q) => values.length ? values[Math.min(values.length - 1, Math.floor(values.length * q))] : null
async function measure(page, seconds) {
  return page.evaluate(async duration => {
    const canvas = document.querySelector('canvas[aria-label="剪辑画面"]')
    const frames = []; const observer = new MutationObserver(() => frames.push({ at: performance.now(), frame: Number(canvas.dataset.presentedFrame), renderMs: Number(canvas.dataset.renderMs), decodeMs: Number(canvas.dataset.decodeMs), gpuMs: Number(canvas.dataset.gpuMs), requestedAt: Number(canvas.dataset.requestedAt) }))
    observer.observe(canvas, { attributes: true, attributeFilter: ['data-presented-frame'] })
    await new Promise(resolve => setTimeout(resolve, duration * 1000)); observer.disconnect()
    return frames.filter((value, index) => index === 0 || value.frame !== frames[index - 1].frame)
  }, seconds)
}
function summarize(frames) {
  const gaps = frames.slice(1).map((value, index) => value.at - frames[index].at).sort((a, b) => a - b)
  const span = (frames.at(-1).at - frames[0].at) / 1000; const advanced = frames.at(-1).frame - frames[0].frame
  const missing = frames.slice(1).reduce((total, value, index) => total + Math.max(0, value.frame - frames[index].frame - 1), 0)
  const backwards = frames.slice(1).filter((value, index) => value.frame < frames[index].frame).length
  const worstGaps = frames.slice(1).map((value, index) => ({ fromFrame: frames[index].frame, toFrame: value.frame, gapMs: Math.round(value.at - frames[index].at), atSecond: Math.round((frames[index].at - frames[0].at) / 100) / 10, renderMs: Math.round(value.renderMs), decodeMs: Math.round(value.decodeMs), gpuMs: Math.round(value.gpuMs), requestDelayMs: Math.round(value.requestedAt - frames[index].at) })).sort((a, b) => b.gapMs - a.gapMs).slice(0, 8)
  return { worstGaps, updates: frames.length, spanSeconds: span, updatesPerSecond: (frames.length - 1) / span, framesAdvanced: advanced, missing, missingRatio: missing / Math.max(1, advanced), backwards,
    clockDeviation: Math.abs(advanced / 60 - span) / span, p50GapMs: quantile(gaps, 0.5), p95GapMs: quantile(gaps, 0.95), p99GapMs: quantile(gaps, 0.99), maxGapMs: gaps.at(-1) }
}
const memory = metrics => Object.fromEntries(['Browser', 'Tab', 'GPU', 'Utility'].map(type => [type, metrics.filter(item => item.type === type).reduce((total, item) => total + item.memory.workingSetSize, 0)]))

function createVideoEditPerformanceScene() {
  return { id: 'video-edit-performance', surface: '剪辑', name: '剪辑-标准4K60负载60秒持续播放定位参数与资源释放', writesUserData: true,
    setup: async (page, app, { capture }) => {
      const root = path.resolve('node_modules/.cache/video-edit-performance'); fs.rmSync(root, { recursive: true, force: true }); fs.mkdirSync(root, { recursive: true })
      const { ffmpegPath } = require('./mediaBinaries.cjs')
      const audio = path.join(root, 'music-63s.wav')
      execFileSync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'aevalsrc=0.2*sin(2*PI*330*t)|0.15*sin(2*PI*550*t):s=48000:d=63', '-c:a', 'pcm_s16le', audio], { windowsHide: true, timeout: 60000 })
      const file = path.join(root, 'performance.henji-video'); fs.writeFileSync(file, JSON.stringify(fixture(audio)))
      const evidence = { completed: false, startedAt: new Date().toISOString(), tolerance: TOLERANCE, phases: [], captures: [] }
      const store = () => fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
      const phase = name => { evidence.currentPhase = name; store() }
      const projectRef = { kind: 'video_edit.project', id: PROJECT_ID }; const sequenceRef = { kind: 'video_edit.sequence', id: `${PROJECT_ID}:main` }
      let client; let observed = false
      const playback = async (frame, playing) => {
        const read = await callTool(client, 'read_application_entity', { ref: projectRef, propertyIds: ['video_edit.project.program_playback'] })
        await callTool(client, 'change_application_entities', operationEnvelope([read], { summary: '性能定位', changes: [{ kind: 'set_properties', entityType: 'video_edit.project', target: projectRef, properties: { 'video_edit.project.program_playback': { frame, playing, playbackDirection: 1 } } }] }))
      }
      const create = async (entityType, parent, items) => { const read = await callTool(client, 'read_application_entity', { ref: parent }); const result = await callTool(client, 'change_application_entities', operationEnvelope([read], { summary: `创建${entityType}`, changes: [{ kind: 'create_items', entityType, parent, items: items.map(properties => ({ properties })) }] })); assert.equal(result.verificationState, 'verified', JSON.stringify(result)); return result }
      const readProject = () => JSON.parse(fs.readFileSync(file, 'utf8'))
      try {
        evidence.runtime = await app.evaluate(async ({ app, screen, BrowserWindow }) => ({ versions: { electron: process.versions.electron, chrome: process.versions.chrome }, gpu: await app.getGPUInfo('basic'), window: BrowserWindow.getAllWindows()[0].getBounds(), display: screen.getDisplayMatching(BrowserWindow.getAllWindows()[0].getBounds()).id, primary: screen.getPrimaryDisplay().id }))
        phase('build-load')
        await button(page, '剪辑').first().click(); if (await button(page, '关闭工程').isVisible()) await button(page, '关闭工程').click()
        await observeWorkers(page); observed = true
        await dialogs(app, [file], file); await button(page, '打开工程').click(); await presented(page, 0)
        const identity = await authorizeMcpConnection(page, { name: '性能负载', allowWrites: true }); client = await connectMcpClient(identity.config, 'Henji performance Reality')
        await create('video_edit.code_material', projectRef, [{ 'video_edit.code_material.source': GENERATOR }, { 'video_edit.code_material.source': FILTER }])
        let document = readProject(); const generatorItem = document.items.find(item => item.code && document.codeMaterials.find(definition => definition.id === item.code.definitionId)?.versions[0].source === GENERATOR)
        const filterDefinition = document.codeMaterials.find(definition => definition.versions[0].source === FILTER)
        await create('video_edit.clip', sequenceRef, [{ 'video_edit.clip.item_id': generatorItem.id, 'video_edit.clip.name': '持续动态标题条', 'video_edit.clip.kind': 'code', 'video_edit.clip.track': 2, 'video_edit.clip.start': 0, 'video_edit.clip.duration': TOTAL }])
        for (let index = 0; index < TILES; index++) await create('video_edit.effect', { kind: 'video_edit.clip', id: `${PROJECT_ID}:tile-${index}` }, [{ 'video_edit.effect.definition_id': filterDefinition.id, 'video_edit.effect.version_id': filterDefinition.versions[0].id, 'video_edit.effect.name': '受控暖色', 'video_edit.effect.amount': 1 }])
        document = readProject(); assert.equal(document.sequences[0].clips.filter(clip => clip.effects?.length).length, TILES)
        evidence.load = { width: 3840, height: 2160, fps: 60, frames: TOTAL, originalTiles: TILES, codeGenerator: 1, codeFilterInstances: TILES, audio: '48kHz stereo 63s', layers: 2 }
        await playback(0, false); await presented(page, 0)

        phase('seek')
        const seek = async frame => { const at = performance.now(); await playback(frame, false); await presented(page, frame); return Math.round(performance.now() - at) }
        const targets = [1500, 2700, 900, 3300]
        evidence.coldSeekMs = []; for (const frame of targets) evidence.coldSeekMs.push({ frame, ms: await seek(frame) })
        evidence.cachedSeekMs = []; for (const frame of targets) evidence.cachedSeekMs.push({ frame, ms: await seek(frame) })
        phase('parameter')
        const genClip = readProject().sequences[0].clips.find(clip => clip.kind === 'code'); const genRef = { kind: 'video_edit.clip', id: `${PROJECT_ID}:${genClip.id}` }
        const before = await page.evaluate(() => document.querySelector('canvas[aria-label="剪辑画面"]').dataset.presentedRevision)
        const read = await callTool(client, 'read_application_entity', { ref: genRef }); const at = performance.now()
        await callTool(client, 'change_application_entities', operationEnvelope([read], { summary: '调强度', changes: [{ kind: 'set_properties', entityType: 'video_edit.clip', target: genRef, properties: { 'video_edit.clip.code_parameters': { amount: 0.3 } } }] }))
        await page.waitForFunction(previous => { const canvas = document.querySelector('canvas[aria-label="剪辑画面"]'); return canvas.dataset.presentedRevision !== previous && canvas.dataset.presentedFrame === '3300' }, before, { timeout: 30000 })
        evidence.parameterToPictureMs = Math.round(performance.now() - at)
        evidence.phases.push('冷定位/缓存命中/参数到正确画面分别测量')

        phase('playback-60s')
        const metricsBefore = memory(await app.evaluate(({ app }) => app.getAppMetrics()))
        // Opt-in Chromium trace for stall attribution; never part of normal acceptance timing.
        const tracing = process.env.HENJI_PERF_TRACE === '1'
        if (tracing) await app.evaluate(({ contentTracing }, categories) => contentTracing.startRecording({ included_categories: categories }), process.env.HENJI_PERF_TRACE_CATEGORIES ? process.env.HENJI_PERF_TRACE_CATEGORIES.split(',') : ['gpu', 'media', 'viz', 'disabled-by-default-gpu.service', 'disabled-by-default-media', 'toplevel'])
        const traceStart = tracing ? Number(process.env.HENJI_PERF_TRACE_START ?? 0) : 0
        await playback(traceStart, true); await page.waitForTimeout(500)
        const frames = await measure(page, tracing ? Number(process.env.HENJI_PERF_TRACE_SECONDS ?? 6) : 60)
        // Which decoder actually played (2.2): the renderer's per-file choice and the native frame channel counters.
        evidence.decode = await page.evaluate(async startedAt => {
          const logs = await window.henjiNative.logging.queryLogEvents({ date: startedAt.slice(0, 10), afterTimestamp: startedAt, limit: 500 })
          const stats = await window.henjiNative.videoFrames?.stats().catch(() => null)
          return {
            backends: logs.events.filter(event => event.event === 'video_edit.decode.backend.selected').map(event => event.context),
            nativeStreams: stats?.streams.filter(stream => stream.kind === 'decoder').map(stream => ({ format: stream.format, width: stream.width, height: stream.height, delivered: stream.delivered, handoffMs: stream.handoffMs })) ?? [],
            native: stats?.native ? { cpuMs: stats.native.cpuMs, gpuLocalMemory: stats.native.gpuLocalMemory, streams: stats.native.streams.map(stream => ({ kind: stream.kind, format: stream.format, counters: stream.counters })) } : null,
          }
        }, evidence.startedAt)
        await playback(0, false)
        if (tracing) evidence.tracePath = await app.evaluate(({ contentTracing }, target) => contentTracing.stopRecording(target), path.join(root, 'playback.trace.json'))
        evidence.playback = summarize(frames); evidence.memoryBeforePlayback = metricsBefore; evidence.memoryAfterPlayback = memory(await app.evaluate(({ app }) => app.getAppMetrics()))
        store()
        const play = evidence.playback
        // Violations are recorded and asserted at the end so resource cycles are still measured.
        evidence.violations = []
        const check = (ok, message) => { if (!ok) evidence.violations.push(message) }
        check(play.spanSeconds >= 59, `持续播放窗口不足60秒：${play.spanSeconds}`)
        check(play.updatesPerSecond >= TOLERANCE.updatesPerSecond, `实际更新率不达标：${play.updatesPerSecond}`)
        check(play.missingRatio <= TOLERANCE.missingRatio, `遗漏帧超出容差：${play.missingRatio}`)
        check(play.maxGapMs <= TOLERANCE.maxGapMs, `最大帧间隔超出容差：${play.maxGapMs}ms @${JSON.stringify(play.worstGaps[0])}`)
        check(play.clockDeviation <= TOLERANCE.clockDeviation, `播放时钟偏差超出容差：${play.clockDeviation}`)
        check(play.backwards === 0, `画面倒退${play.backwards}次`)
        store()
        await capture('performance-after-60s')
        evidence.phases.push('标准4K60负载60秒持续播放满足预先固定容差')

        phase('resource-cycles')
        evidence.cycles = []
        // Diagnostic only: HENJI_PERF_CYCLES lengthens the curve; the asserted acceptance always uses 4 cycles.
        const cycles = Math.max(4, Number(process.env.HENJI_PERF_CYCLES) || 4)
        for (let cycle = 0; cycle < cycles; cycle++) {
          await button(page, '生成').click(); await button(page, '剪辑').first().click(); await presented(page, 0)
          await group(page, '节目画面').locator('.dv-tab').filter({ has: button(page, '关闭节目画面') }).click()
          const opened = app.waitForEvent('window', { timeout: 30000 })
          await group(page, '节目画面').getByRole('button', { name: '面板菜单', exact: true }).click(); await page.getByText('在独立窗口打开', { exact: true }).click()
          const child = await opened; await child.waitForFunction(() => document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame === '0', null, { timeout: 60000 })
          await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.getTitle() === '痕迹AI · 节目画面')?.close())
          await page.locator('canvas[aria-label="剪辑画面"]').waitFor({ state: 'visible', timeout: 60000 }); await presented(page, 0)
          await button(page, '关闭工程').click(); await waitReleased(page)
          await dialogs(app, [file], file); await button(page, '打开工程').click(); await presented(page, 0)
          await page.waitForTimeout(1500)
          const nativeFrames = await page.evaluate(() => window.henjiNative.videoFrames?.stats().then(stats => ({ streams: stats.streams.length, unreleasedImports: stats.unreleasedImports, preloadOutstanding: stats.preload.outstanding, nativeVramBytes: stats.native?.gpuLocalMemory?.currentUsageBytes ?? null })).catch(() => null))
          evidence.cycles.push({ cycle, memory: memory(await app.evaluate(({ app }) => app.getAppMetrics())), workers: (await workerSnapshot(page)).live, nativeFrames }); store()
        }
        const first = evidence.cycles[0].memory; const last = evidence.cycles[3].memory
        evidence.memoryGrowth = Object.fromEntries(Object.keys(first).map(key => [key, first[key] ? (last[key] - first[key]) / first[key] : 0]))
        for (const key of ['Tab', 'GPU']) check(evidence.memoryGrowth[key] <= TOLERANCE.memoryGrowth, `反复切页/浮窗/重开后${key}进程内存增长${evidence.memoryGrowth[key]}`)
        check(evidence.cycles.every(cycle => cycle.workers <= 1), `循环后节目渲染Worker多于一个：${JSON.stringify(evidence.cycles.map(cycle => cycle.workers))}`)
        evidence.phases.push('切页/节目浮窗/关闭重开4轮后渲染与GPU进程内存不持续增长，单一渲染会话')

        await button(page, '关闭工程').click(); await waitReleased(page)
        evidence.resources = await workerSnapshot(page); assert.equal(evidence.resources.live, 0)
        evidence.completed = evidence.violations.length === 0; store()
        assert.deepEqual(evidence.violations, [], '标准4K60负载未达到预先固定的容差')
      } catch (error) { evidence.failed = { phase: evidence.currentPhase, message: String(error.message ?? error), stack: error.stack }; store(); await capture('performance-failed').catch(() => {}); throw error }
      finally {
        await client?.close().catch(() => {}); await disableMcp(page).catch(() => {})
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(window => window.getTitle().startsWith('痕迹AI · ')).forEach(window => window.close())).catch(() => {})
        if (await button(page, '关闭工程').isVisible().catch(() => false)) await button(page, '关闭工程').click().catch(() => {})
        if (observed) { await waitReleased(page).catch(error => { evidence.completed = false; evidence.releaseFailure = String(error) }); evidence.resources = await workerSnapshot(page).catch(() => evidence.resources) }
        await page.evaluate(() => { window.__videoLayoutObservers?.forEach(observer => observer.disconnect()); if (window.__videoLayoutNativeWorker) window.Worker = window.__videoLayoutNativeWorker; try { localStorage.removeItem('henji.videoEdit.popoutLayout.v1') } catch { /* view convenience only */ } }).catch(() => {}); store()
      }
    },
  }
}
module.exports = { createVideoEditPerformanceScene }
