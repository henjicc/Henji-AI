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
            // 拖动播放头 4 秒：记录主线程长任务与节目实际呈现的帧数。
            const slider = page.getByRole('slider', { name: '剪辑时间定位' }).first(); const box = await slider.boundingBox()
            await page.evaluate(() => { window.__scrubLong = []; window.__scrubObserver = new PerformanceObserver(list => { for (const entry of list.getEntries()) window.__scrubLong.push(Math.round(entry.duration)) }); window.__scrubObserver.observe({ type: 'longtask' }); window.__scrubFrames = 0; const canvas = document.querySelector('canvas[aria-label="剪辑画面"]'); window.__scrubMo = new MutationObserver(() => window.__scrubFrames++); window.__scrubMo.observe(canvas, { attributes: true, attributeFilter: ['data-presented-frame'] }) })
            const scrubProfile = await profileStart(page)
            await page.mouse.move(box.x + 20, box.y + box.height / 2); await page.mouse.down()
            for (let step = 0; step <= 240; step++) { await page.mouse.move(box.x + 20 + (box.width - 40) * (step / 240) * 0.5, box.y + box.height / 2); await page.waitForTimeout(16) }
            await page.mouse.up()
            evidence[`profileScrub${evidence.runs.length}`] = await profileStop(scrubProfile, path.join(root, `scrub-${evidence.runs.length}.cpuprofile`))
            evidence[`scrub${evidence.runs.length}`] = await page.evaluate(() => { window.__scrubObserver.disconnect(); window.__scrubMo.disconnect(); return { presentedFrames: window.__scrubFrames, longTasks: window.__scrubLong } })
            console.log('[open-picture-profile]', JSON.stringify({ open: evidence[`profileOpen${evidence.runs.length}`]?.slice(0, 12), scrub: evidence[`scrub${evidence.runs.length}`], scrubTop: evidence[`profileScrub${evidence.runs.length}`].slice(0, 12) }))
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
