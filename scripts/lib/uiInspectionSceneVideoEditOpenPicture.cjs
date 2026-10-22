const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const sharp = require('sharp')
const { videoEditFixtureProject } = require('./uiInspectionSceneVideoEditProbe.cjs')
const { seedVideoEditProject, openVideoEditProjectCard, leaveVideoEditProject } = require('./uiInspectionVideoEditDocuments.cjs')
const { observeWorkers, workerSnapshot } = require('./uiInspectionSceneVideoEditLayout.cjs')

const PROGRAM = 'canvas[aria-label="剪辑画面"]'
/** 空画布与面板底是均匀色；有画面时像素离散度明显升高（真实素材可能整体偏暗，不能只看平均亮度）。 */
const VISIBLE_SPREAD = 8

/**
 * 打开剪辑后节目画面真正出现在屏幕上的时间：每 50ms 截取节目画布在窗口中的实际像素并测亮度，
 * 与画布记录的“已呈现帧”和 Worker 渲染回执对照，区分“没渲染”“渲染了没上屏”“上屏后又丢失”。
 */
async function sampleProgram(page, startedAt, durationMs) {
  const samples = []
  while (performance.now() - startedAt < durationMs) {
    const at = performance.now() - startedAt
    const canvas = page.locator(PROGRAM).first()
    const state = await page.evaluate(selector => {
      const element = document.querySelector(selector)
      if (!element) return null
      const box = element.getBoundingClientRect()
      return { presentedFrame: element.dataset.presentedFrame ?? null, renderMs: Number(element.dataset.renderMs), width: element.width, height: element.height,
        box: { width: Math.round(box.width), height: Math.round(box.height) }, connected: element.isConnected,
        preparing: Boolean(document.querySelector('[data-video-edit-program-preparing]')), busyText: document.querySelector('[data-video-edit-panel="program"]')?.textContent?.slice(0, 80) ?? '' }
    }, PROGRAM)
    let mean = null, spread = null
    if (state?.box.width && state.box.height) {
      const shot = await canvas.screenshot({ timeout: 2000 }).catch(() => null)
      if (shot) {
        const channels = (await sharp(shot).stats()).channels.slice(0, 3)
        mean = Math.round(channels.reduce((sum, channel) => sum + channel.mean, 0) / 3)
        spread = Math.round(channels.reduce((sum, channel) => sum + channel.stdev, 0) / 3)
      }
    }
    samples.push({ at: Math.round(at), mean, spread, ...state })
    await page.waitForTimeout(50)
  }
  return samples
}

/** CPU 采样（HENJI_OPEN_PICTURE_PROFILE=1）：按函数自身耗时排序，定位主线程长任务。 */
async function profileStart(page) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start')
  return cdp
}
async function profileStop(cdp, file) {
  const { profile } = await cdp.send('Profiler.stop'); await cdp.detach()
  fs.writeFileSync(file, JSON.stringify(profile))
  const self = new Map(); const byId = new Map(profile.nodes.map(node => [node.id, node]))
  const deltas = profile.timeDeltas ?? []
  profile.samples.forEach((id, index) => { const node = byId.get(id); const key = `${node.callFrame.functionName || '(anonymous)'} ${node.callFrame.url.split('/').pop()}:${node.callFrame.lineNumber + 1}`; self.set(key, (self.get(key) ?? 0) + (deltas[index] ?? 0) / 1000) })
  return [...self].sort((left, right) => right[1] - left[1]).slice(0, 25).map(([name, ms]) => ({ name, ms: Math.round(ms) }))
}

const scrubPercentile = (values, q) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]) : null }

/**
 * 正向播放流畅度（HENJI_OPEN_PICTURE_PLAYBACK=1）：从序列开头播放 ms 毫秒，记录节目每次实际呈现的帧号与时刻，
 * 统计跳帧、超过 2.5 帧间隔的卡顿（附帧号，便于对照剪辑点）与解码预打开日志。
 */
async function measurePlayback(page, ms, after) {
  await page.locator('[data-video-edit-timeline-viewport]').first().focus(); await page.keyboard.press('Home'); await page.waitForTimeout(1500)
  const nativeBefore = await page.evaluate(() => window.henjiNative.videoFrames.stats()).catch(() => null)
  const playbackStarted = await page.evaluate(() => performance.now())
  await page.evaluate(() => { window.__playFrames = []; const canvas = document.querySelector('canvas[aria-label="剪辑画面"]'); window.__playMo = new MutationObserver(() => window.__playFrames.push([performance.now(), Number(canvas.dataset.presentedFrame)])); window.__playMo.observe(canvas, { attributes: true, attributeFilter: ['data-presented-frame'] }) })
  await page.keyboard.press('Space'); await page.waitForTimeout(ms); await page.keyboard.press('Space')
  const frames = await page.evaluate(() => { window.__playMo.disconnect(); return window.__playFrames })
  // 呈现统计已封口；等停止汇总回传，避免漏掉最后一个切点的前瞻命中。
  await page.waitForFunction(started => window.__videoLayoutEvidence.events.some(entry => entry.kind === 'worker.log' && entry.at >= started && entry.event === 'video_edit.decode.lookahead.summary' && entry.context?.reason === 'stop'), playbackStarted, { timeout: 2000 })
  const first = frames[0], last = frames.at(-1)
  if (!first) return { presented: 0 }
  const span = last[1] - first[1], seconds = (last[0] - first[0]) / 1000, rate = span / seconds
  const budget = 1000 / Math.max(1, Math.round(rate))
  let skipped = 0; const stalls = []
  for (let index = 1; index < frames.length; index++) {
    const gap = frames[index][0] - frames[index - 1][0], step = frames[index][1] - frames[index - 1][1]
    if (step > 1) skipped += step - 1
    if (gap > budget * 2.5) stalls.push({ frame: frames[index][1], gapMs: Math.round(gap), skipped: Math.max(0, step - 1) })
  }
  // 每次卡顿那一帧的阶段构成：节目 Worker 回执带累计阶段耗时，与上一次回执相减。
  const snapshot = await workerSnapshot(page)
  const program = new Set(snapshot.workers.filter(worker => worker.direct && !worker.terminated).map(worker => worker.id))
  const renders = snapshot.events.filter(event => event.kind === 'render.completed' && event.at >= playbackStarted && program.has(event.worker) && event.preparationStages).sort((a, b) => a.at - b.at)
  for (const stall of stalls) {
    const index = renders.findIndex(event => event.frame === stall.frame)
    if (index <= 0) continue
    const event = renders[index], previous = renders[index - 1]
    stall.renderMs = Math.round(event.elapsedMs); stall.decodeMs = Math.round(event.decodeMs ?? 0); stall.gpuMs = Math.round(event.gpuMs ?? 0)
    stall.stages = Object.fromEntries(Object.entries(event.preparationStages).map(([name, value]) => [name, Math.round(value.ms - (previous.preparationStages[name]?.ms ?? 0))]).filter(([, ms]) => ms >= 5))
  }
  // 日志含本地时区偏移，按实际时间过滤；字符串比较会把上一轮同日事件算入。
  const events = (await page.evaluate(async after => (await window.henjiNative.logging.queryLogEvents({ date: after.slice(0, 10), afterTimestamp: after, keyword: 'video_edit.decode', limit: 3000 })).events, after)).filter(entry => Date.parse(entry.timestamp) >= Date.parse(after))
  const counts = {}; for (const entry of events) counts[entry.event] = (counts[entry.event] ?? 0) + 1
  return { presented: frames.length, frames: span + 1, seconds: Math.round(seconds * 100) / 100, fps: Math.round(frames.length / seconds * 10) / 10, timelineRate: Math.round(rate * 10) / 10, skipped, stalls, stalledMs: stalls.reduce((sum, stall) => sum + stall.gapMs, 0), decodeEvents: counts, workerActivity: snapshot.workers.map(worker => ({ ...worker, renders: snapshot.events.filter(entry => entry.worker === worker.id && entry.at >= playbackStarted && entry.kind === 'render.completed').length })), decodeSummaries: snapshot.events.filter(entry => entry.kind === 'worker.log' && entry.at >= playbackStarted && program.has(entry.worker) && entry.event === 'video_edit.decode.lookahead.summary').map(entry => entry.context), nativeBefore, nativeAfter: await page.evaluate(() => window.henjiNative.videoFrames.stats()).catch(() => null), lookaheadBudget: snapshot.events.filter(entry => entry.kind === 'worker.log' && entry.at >= playbackStarted && program.has(entry.worker) && entry.event === 'video_edit.decode.lookahead.budget').map(entry => entry.context), fpsBySecond: Array.from({ length: Math.floor(seconds) }, (_, index) => frames.filter(frame => frame[0] >= first[0] + index * 1000 && frame[0] < first[0] + (index + 1) * 1000).length) }
}

/**
 * 在节目时间定位条上按给定方式拖动，统计节目实际呈现的帧数、节目 Worker 每帧往返/解码/GPU 耗时与原生取帧请求。
 * `offset(t)`：t∈[0,1] 时播放头相对起点（时间线 30% 处）的秒数；`sweep`：从开头扫到一半。
 */
async function measureScrub(page, pattern, pct) {
  const slider = page.getByRole('slider', { name: '剪辑时间定位' }).first()
  // 整条序列适配窗口（PR 的 \），再在可见范围内点两处读帧号，标定“每像素多少帧”，不依赖标尺内部数值。
  await page.locator('[data-video-edit-timeline-viewport]').first().focus(); await page.keyboard.press('Backslash'); await page.waitForTimeout(400)
  const viewport = await page.locator('[data-video-edit-timeline-viewport]').first().boundingBox()
  const box = await slider.boundingBox()
  const y = box.y + box.height / 2
  const left = Math.max(box.x, viewport.x + 140), right = Math.min(box.x + box.width, viewport.x + viewport.width - 20)
  const frameAt = async px => { await page.mouse.click(px, y); await page.waitForTimeout(150); return Number(await slider.getAttribute('aria-valuenow')) }
  const f1 = await frameAt(left + (right - left) * 0.2), f2 = await frameAt(left + (right - left) * 0.8)
  const framesPerPx = (f2 - f1) / ((right - left) * 0.6)
  const fps = 60
  const x = seconds => Math.max(left, Math.min(right, left + (right - left) * 0.2 + (seconds * fps - f1) / framesPerPx))
  const start = (f1 + (f2 - f1) * 0.4) / fps
  const total = f2
  const position = t => pattern.sweep ? x(f1 / fps + (f2 - f1) / fps * t) : x(start + pattern.offset(t))
  await page.mouse.click(position(0), box.y + box.height / 2); await page.waitForTimeout(1500)
  await page.evaluate(() => { window.__scrubFrames = 0; const canvas = document.querySelector('canvas[aria-label="剪辑画面"]'); window.__scrubMo = new MutationObserver(() => window.__scrubFrames++); window.__scrubMo.observe(canvas, { attributes: true, attributeFilter: ['data-presented-frame'] }) })
  const cpu = pattern.profile ? await profileStart(page) : null
  const from = await page.evaluate(() => performance.now()); const after = new Date().toISOString(); const startedAt = performance.now()
  await page.mouse.move(position(0), box.y + box.height / 2); await page.mouse.down()
  // 按真实鼠标的节奏（约 60 次/秒）发送移动：直接走浏览器输入协议且不等每次往返，测试工具本身不成为瓶颈。
  const input = await page.context().newCDPSession(page)
  let moves = 0
  while (performance.now() - startedAt < pattern.ms) {
    void input.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: position((performance.now() - startedAt) / pattern.ms), y: box.y + box.height / 2, button: 'left', buttons: 1 }).catch(() => undefined)
    moves++
    await new Promise(resolve => setTimeout(resolve, 16))
  }
  await input.detach().catch(() => undefined)
  const midValue = await slider.getAttribute('aria-valuenow')
  await page.mouse.up()
  const presentedFrames = await page.evaluate(() => { window.__scrubMo.disconnect(); return window.__scrubFrames })
  const profilePath = path.resolve('node_modules/.cache/video-edit-open-picture', `scrub-${pattern.name}.cpuprofile`)
  const top = cpu ? await profileStop(cpu, profilePath) : undefined
  const debug = { total, box: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) }, startX: Math.round(position(0)), midValue, endValue: await slider.getAttribute('aria-valuenow') }
  const snapshot = await workerSnapshot(page)
  const program = new Set(snapshot.workers.filter(worker => worker.direct && !worker.terminated).map(worker => worker.id))
  const renders = snapshot.events.filter(event => event.kind === 'render.completed' && event.at >= from && program.has(event.worker))
  const stat = key => ({ p50: pct(renders.map(event => event[key] ?? 0), .5), p90: pct(renders.map(event => event[key] ?? 0), .9) })
  // 流水线：相邻两次请求的间隔，以及“上一帧完成 → 下一次请求发出”的空档（大说明主线程拖慢，接近 0 说明渲染侧是瓶颈）。
  const requested = snapshot.events.filter(event => event.kind === 'render' && event.at >= from && program.has(event.worker)).map(event => event.at).sort((a, b) => a - b)
  const completedAt = renders.map(event => event.at).sort((a, b) => a - b)
  const intervals = requested.slice(1).map((at, index) => at - requested[index])
  const gaps = requested.slice(1).map(at => { const previous = completedAt.filter(done => done <= at).pop(); return previous === undefined ? null : at - previous }).filter(value => value !== null)
  // 最长的几次停顿：发生在第几秒、停了多久、停顿前那一帧的渲染耗时，用来区分是渲染慢还是没有发请求。
  const stalls = intervals.map((value, index) => ({ at: Math.round(requested[index] - from), ms: Math.round(value) })).sort((a, b) => b.ms - a.ms).slice(0, 8)
  const pipeline = { requestIntervalMs: { p50: pct(intervals, .5), p90: pct(intervals, .9), max: Math.round(Math.max(0, ...intervals)) }, gapAfterCompleteMs: { p50: pct(gaps, .5), p90: pct(gaps, .9) }, stalls, stalledMs: Math.round(intervals.filter(value => value > 100).reduce((a, b) => a + b, 0)) }
  // 最慢几帧的阶段构成：Worker 回执带累计阶段耗时，与上一帧相减即这一帧花在各阶段的时间。
  const ordered = [...renders].sort((a, b) => a.at - b.at)
  const slowest = ordered.map((event, index) => ({ event, previous: ordered[index - 1] })).filter(entry => entry.previous && entry.event.preparationStages && entry.previous.preparationStages)
    .sort((a, b) => b.event.elapsedMs - a.event.elapsedMs).slice(0, 3).map(({ event, previous }) => ({
      at: Math.round(event.at - from), elapsedMs: Math.round(event.elapsedMs), decodeMs: Math.round(event.decodeMs ?? 0),
      stages: Object.fromEntries(Object.entries(event.preparationStages).map(([name, value]) => [name, { ms: Math.round(value.ms - (previous.preparationStages[name]?.ms ?? 0)), count: value.count - (previous.preparationStages[name]?.count ?? 0) }]).filter(([, value]) => value.ms >= 5 || value.count > 0 && value.ms >= 1)),
    }))
  const decoderEvents = await page.evaluate(async after => (await window.henjiNative.logging.queryLogEvents({ date: after.slice(0, 10), afterTimestamp: after, keyword: 'video_decoder.request.completed', limit: 5000 })).events, after)
  const decoder = {}
  for (const entry of decoderEvents) { const type = entry.context?.type ?? '?'; decoder[type] ??= { count: 0, totalMs: 0 }; decoder[type].count++; decoder[type].totalMs += Math.round(entry.context?.elapsedMs ?? 0) }
  await page.waitForTimeout(1500)
  return { ...(top ? { top: top.slice(0, 15), profilePath } : {}), slowest, pipeline, debug, movesPerSecond: Math.round(moves / (pattern.ms / 1000) * 10) / 10, requests: snapshot.events.filter(event => event.kind === 'render' && event.at >= from && program.has(event.worker)).length, fps: Math.round(presentedFrames / (pattern.ms / 1000) * 10) / 10, presentedFrames, renders: renders.length, elapsedMs: stat('elapsedMs'), decodeMs: stat('decodeMs'), gpuMs: stat('gpuMs'), decoder }
}

function summarizeSamples(samples) {
  // “正在准备画面”浮层本身有文字和图标，出现时不算画面上屏。
  const visible = sample => sample.spread !== null && sample.spread >= VISIBLE_SPREAD && !sample.preparing
  const firstVisible = samples.find(visible)
  const firstPresented = samples.find(sample => sample.presentedFrame !== null && sample.presentedFrame !== undefined)
  const lostAfterVisible = firstVisible ? samples.filter(sample => sample.at > firstVisible.at && sample.spread !== null && !visible(sample)).map(sample => sample.at) : []
  return { firstVisibleMs: firstVisible?.at ?? null, firstPresentedMarkMs: firstPresented?.at ?? null, lostAfterVisibleMs: lostAfterVisible, sampleCount: samples.length }
}

function createVideoEditOpenPictureScene() {
  return { id: 'video-edit-open-picture', surface: '剪辑', name: '剪辑-打开项目后节目画面实际上屏', writesUserData: true,
    setup: async (page, _app, { capture }) => {
      const root = path.resolve('node_modules/.cache/video-edit-open-picture'); fs.mkdirSync(root, { recursive: true })
      const { ffmpegPath } = require('./mediaBinaries.cjs')
      // 接近相机原片：4K60 H.264 长 GOP、B 帧、带声音；画面始终明亮，任何黑屏都能被亮度区分。
      const source = path.join(root, '4k60-camera.mp4')
      if (!fs.existsSync(source)) execFileSync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=3840x2160:rate=60', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
        '-t', '20', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-g', '120', '-bf', '3', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', source], { windowsHide: true })
      const clip = { id: 'v', mediaId: 'source', name: '原片画面', kind: 'video', track: 1, start: 0, duration: 1200, sourceInUs: 0, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '', sourceComponent: 'video', linkId: 'link' }
      const fixture = videoEditFixtureProject({ id: 'open-picture', name: '打开上屏', revision: 0, width: 3840, height: 2160, fps: 60, annotations: [],
        media: [{ id: 'source', name: '4k60-camera.mp4', path: source, kind: 'video', durationSeconds: 20, width: 3840, height: 2160, hasAudio: true }],
        clips: [clip, { ...clip, id: 'a', name: '原片声音', kind: 'audio', sourceComponent: 'audio', track: 0 }] })
      const evidence = { source, runs: [] }
      const save = () => fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
      // 真实工程（HENJI_OPEN_PICTURE_PROJECT=工程文件夹）：复制到缓存后登记为外部项目再打开，不改动原工程。
      const realFolder = process.env.HENJI_OPEN_PICTURE_PROJECT
      if (realFolder) {
        const copy = path.join(root, 'real-project'); fs.rmSync(copy, { recursive: true, force: true })
        fs.cpSync(realFolder, copy, { recursive: true, filter: file => !/[\\/](导出|backups)([\\/]|$)/.test(file) })
        // 可选 HENJI_OPEN_PICTURE_DOCUMENT=剪辑文件名：副本里只保留这份剪辑并设为主剪辑。
        const manifestPath = path.join(copy, '.henji', 'project.json'); const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
        const chosen = process.env.HENJI_OPEN_PICTURE_DOCUMENT
        if (chosen) {
          for (const file of fs.readdirSync(copy)) if (file.endsWith('.henji-video') && file !== chosen) fs.rmSync(path.join(copy, file))
          const chosenDocument = JSON.parse(fs.readFileSync(path.join(copy, chosen), 'utf8'))
          // 副本里修正外部工具写成数字的时间字段，原文件不动。
          if (typeof chosenDocument.updatedAt === 'number') { chosenDocument.updatedAt = new Date(chosenDocument.updatedAt).toISOString(); fs.writeFileSync(path.join(copy, chosen), JSON.stringify(chosenDocument)) }
          manifest.mainVideoEditId = chosenDocument.id
          fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
        }
        const projectId = manifest.id
        await page.evaluate(folder => window.henjiNative.documents.registerExternalProject(folder), copy)
        const durationMs = Number(process.env.HENJI_OPEN_PICTURE_MS || 60000)
        for (const name of ['真实工程：刷新后首次打开', '真实工程：离开后再次打开']) {
          if (name.includes('刷新')) {
            await page.getByRole('button', { name: '生成', exact: true }).click()
            await page.reload({ waitUntil: 'domcontentloaded' })
            await page.getByRole('button', { name: '生成', exact: true }).waitFor({ state: 'visible' })
            await observeWorkers(page)
            await page.getByRole('button', { name: '剪辑', exact: true }).click()
          }
          const after = new Date().toISOString()
          const profiling = process.env.HENJI_OPEN_PICTURE_PROFILE === '1'
          const openProfile = profiling ? await profileStart(page) : null
          const startedAt = performance.now()
          await openVideoEditProjectCard(page, projectId)
          const openedMs = Math.round(performance.now() - startedAt)
          const samples = await sampleProgram(page, startedAt, durationMs)
          if (openProfile) evidence[`profileOpen${evidence.runs.length}`] = await profileStop(openProfile, path.join(root, `open-${evidence.runs.length}.cpuprofile`))
          if (profiling) {
            // 三种拖动方式：附近来回找帧、中速向前、快速扫过半条时间线（后者几乎每帧都是新镜头，主要测首次打开成本）。
            const patterns = [
              { name: '附近来回找帧', ms: 6000, offset: t => Math.sin(t * Math.PI * 2 * 3) * 3, profile: true },
              { name: '中速向前', ms: 5000, offset: t => t * 10 },
              { name: '快速扫过', ms: 4000, sweep: true },
            ]
            evidence[`scrub${evidence.runs.length}`] = {}
            for (const pattern of patterns) evidence[`scrub${evidence.runs.length}`][pattern.name] = await measureScrub(page, pattern, scrubPercentile)
            console.log('[open-picture-scrub]', JSON.stringify(evidence[`scrub${evidence.runs.length}`]))
          }
          if (process.env.HENJI_OPEN_PICTURE_PLAYBACK === '1') {
            evidence[`playback${evidence.runs.length}`] = await measurePlayback(page, 12000, new Date().toISOString())
            console.log('[open-picture-playback]', JSON.stringify(evidence[`playback${evidence.runs.length}`]))
          }
          const worker = await workerSnapshot(page)
          const renders = worker.events.filter(event => event.kind === 'render.completed' || event.kind === 'init.completed' || event.kind === 'update.completed').slice(0, 30).map(({ kind, at, frame, elapsedMs, presented, decodeMs, gpuMs, error, preparationStages }) => ({ kind, at: Math.round(at), frame, elapsedMs: Math.round(elapsedMs), presented, decodeMs, gpuMs, error, preparationStages }))
          const query = keyword => page.evaluate(async ({ after, keyword }) => (await window.henjiNative.logging.queryLogEvents({ date: after.slice(0, 10), afterTimestamp: after, keyword, limit: 3000 })).events, { after, keyword })
          const logs = [...await query('video_edit'), ...await query('documents'), ...await query('fonts')]
            .filter(entry => /program\.|render\.|preview\.|code\.|content|fonts|documents\.|open/.test(entry.event) && !/decode\.backend/.test(entry.event))
            .sort((left, right) => String(left.timestamp).localeCompare(String(right.timestamp))).slice(0, 400).map(entry => ({ at: entry.timestamp, event: entry.event, level: entry.level, context: entry.context }))
          const result = { name, openedMs, ...summarizeSamples(samples), renders, logs, samples }
          evidence.runs.push(result); save()
          console.log('[open-picture]', JSON.stringify({ name, openedMs, firstVisibleMs: result.firstVisibleMs, firstPresentedMarkMs: result.firstPresentedMarkMs, lostAfterVisibleMs: result.lostAfterVisibleMs.slice(0, 10), renders: renders.slice(0, 8) }))
          await capture(`open-picture-real-${evidence.runs.length}`)
          await leaveVideoEditProject(page)
          await page.waitForTimeout(800)
        }
        return
      }
      const seeded = await seedVideoEditProject(page, fixture)
      const runs = [
        { name: '刷新后首次进入剪辑并立即打开', reload: true },
        { name: '离开后再次打开同一项目', reload: false },
        { name: '再刷新后打开（原生解码服务已热）', reload: true },
      ]
      for (const run of runs) {
        if (run.reload) {
          await page.getByRole('button', { name: '生成', exact: true }).click()
          await page.reload({ waitUntil: 'domcontentloaded' })
          await page.getByRole('button', { name: '生成', exact: true }).waitFor({ state: 'visible' })
          await observeWorkers(page)
          await page.getByRole('button', { name: '剪辑', exact: true }).click()
        }
        const startedAt = performance.now()
        await openVideoEditProjectCard(page, seeded.projectId)
        const openedMs = Math.round(performance.now() - startedAt)
        const samples = await sampleProgram(page, startedAt, 12000)
        const worker = await workerSnapshot(page)
        const renders = worker.events.filter(event => event.kind === 'render.completed').slice(0, 12).map(({ at, frame, elapsedMs, presented, decodeMs, gpuMs, error }) => ({ at: Math.round(at), frame, elapsedMs: Math.round(elapsedMs), presented, decodeMs, gpuMs, error }))
        const result = { name: run.name, openedMs, ...summarizeSamples(samples), renders, samples }
        evidence.runs.push(result); save()
        console.log('[open-picture]', JSON.stringify({ name: result.name, openedMs, firstVisibleMs: result.firstVisibleMs, firstPresentedMarkMs: result.firstPresentedMarkMs, lostAfterVisibleMs: result.lostAfterVisibleMs.slice(0, 10), renders: renders.slice(0, 6) }))
        await capture(`open-picture-${evidence.runs.length}`)
        await leaveVideoEditProject(page)
        await page.waitForTimeout(800)
      }
      // 用户实际流程：新建项目、导入视频，把视频拖到空时间线上自动新建序列，从松手开始计时。
      const empty = { ...fixture, id: 'open-picture-new', name: '拖入新建序列', sequences: [] }
      const emptySeeded = await seedVideoEditProject(page, empty)
      for (const name of ['拖素材到空时间线新建序列（刷新后）', '拖素材到空时间线新建序列（再次）']) {
        if (name.includes('刷新')) {
          await page.getByRole('button', { name: '生成', exact: true }).click()
          await page.reload({ waitUntil: 'domcontentloaded' })
          await page.getByRole('button', { name: '生成', exact: true }).waitFor({ state: 'visible' })
          await observeWorkers(page)
          await page.getByRole('button', { name: '剪辑', exact: true }).click()
        } else {
          // 再次：重新播种为没有序列的同一项目
          await seedVideoEditProject(page, empty)
        }
        await openVideoEditProjectCard(page, emptySeeded.projectId)
        const item = page.locator('[data-video-edit-project-entry="item-source"]').first()
        await item.waitFor({ state: 'visible', timeout: 15000 })
        const timeline = page.locator('[data-video-edit-timeline]').first()
        await item.dragTo(timeline, { timeout: 10000 })
        // 素材没有记录帧率时会先请用户确认新序列规格；从确认那一刻计时（直接建好时从松手计时）。
        const create = page.getByRole('dialog', { name: '新建序列' }).getByRole('button', { name: '新建', exact: true })
        const asked = await create.waitFor({ state: 'visible', timeout: 1500 }).then(() => true, () => false)
        const startedAt = performance.now()
        if (asked) await create.click()
        const samples = await sampleProgram(page, startedAt, 12000)
        const result = { name, openedMs: 0, ...summarizeSamples(samples), samples }
        evidence.runs.push(result); save()
        console.log('[open-picture]', JSON.stringify({ name, firstVisibleMs: result.firstVisibleMs, firstPresentedMarkMs: result.firstPresentedMarkMs, lostAfterVisibleMs: result.lostAfterVisibleMs.slice(0, 10) }))
        await capture(`open-picture-drop-${evidence.runs.length}`)
        await leaveVideoEditProject(page)
        await page.waitForTimeout(800)
      }
      for (const run of evidence.runs) {
        assert.ok(run.firstVisibleMs !== null, `${run.name}：12 秒内节目画面始终是黑的`)
        assert.deepEqual(run.lostAfterVisibleMs, [], `${run.name}：画面出现后又变黑`)
      }
    } }
}
module.exports = { createVideoEditOpenPictureScene }
