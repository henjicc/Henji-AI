const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync } = require('node:child_process')
const { startGpuSampler } = require('./uiInspectionGpuSampler.cjs')
const { observeWorkers, workerSnapshot, waitReleased } = require('./uiInspectionSceneVideoEditLayout.cjs')
const { openVideoEditFile } = require('./uiInspectionVideoEditDocuments.cjs')
const button = (page, name) => page.getByRole('button', { name, exact: true })
const quantile = (values, q) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * q))] ?? 0

function createVideoEditScrubScene() {
  return {
    id: 'video-edit-4k60-scrub', surface: '剪辑', name: '剪辑-4K60连续拖动实际画面更新', writesUserData: true,
    setup: async (page, app, { capture }) => {
      const suppliedSource = process.env.HENJI_VIDEO_EDIT_SCRUB_SOURCE
      const root = path.resolve(`.ui-tour/cache/video-edit-scrub${suppliedSource ? '-original' : ''}`); fs.mkdirSync(root, { recursive: true })
      const { ffmpegPath, ffprobePath } = require('./mediaBinaries.cjs')
      const source = suppliedSource ? path.resolve(suppliedSource) : path.join(root, '4k60-gop120-b2.mp4')
      if (suppliedSource) assert.ok(fs.existsSync(source), '指定的原素材必须存在，不生成替代文件')
      if (!fs.existsSync(source)) execFileSync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=3840x2160:rate=60', '-t', '8', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-g', '120', '-keyint_min', '120', '-sc_threshold', '0', '-bf', '2', '-pix_fmt', 'yuv420p', source], { windowsHide: true })
      const mediaProbe = JSON.parse(execFileSync(ffprobePath, ['-v', 'error', '-show_streams', '-of', 'json', source], { windowsHide: true, encoding: 'utf8' }))
      const videoTrack = mediaProbe.streams.find(stream => stream.codec_type === 'video')
      assert.equal(videoTrack.width, 3840); assert.equal(videoTrack.height, 2160); assert.equal(videoTrack.avg_frame_rate, '60/1')
      const clip = { id: 'base', mediaId: 'source', name: '4K60 主画面', kind: 'video', track: 1, start: 0, duration: 360, sourceInUs: 0, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 0, text: '' }
      const fixture = { format: 'henji-video-project', version: 1, id: 'scrub-4k60', name: '4K60 连续拖动验证', revision: 0, width: 3840, height: 2160, fps: 60, media: [{ id: 'source', name: path.basename(source), path: source, kind: 'video', durationSeconds: Number(videoTrack.duration), width: 3840, height: 2160 }], clips: [clip, { ...clip, id: 'overlay', name: '4K60 叠加', track: 2, sourceInUs: 1000000, x: .3, y: .3, scale: .3 }, { ...clip, id: 'text', mediaId: undefined, name: '文字', kind: 'text', track: 3, text: '4K60', y: -.35, scale: .5 }], annotations: [] }
      const project = require('./uiInspectionSceneVideoEditProbe.cjs').videoEditFixtureProject(fixture)
      const file = path.join(root, 'scrub.hjvid'); fs.writeFileSync(file, JSON.stringify(project))
      await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }) }, file)
      // 诊断运行（HENJI_VIDEO_EDIT_SCRUB_DIAGNOSTICS=1）按轮记录 Worker 准备阶段的增量，定位每一轮的时间花在哪里。
      const diagnostics = process.env.HENJI_VIDEO_EDIT_SCRUB_DIAGNOSTICS === '1'
      await observeWorkers(page, false, diagnostics)
      await button(page, '剪辑').click(); const openedAt = performance.now(); await openVideoEditFile(page, file)
      const canvas = page.getByLabel('剪辑画面', { exact: true })
      try {
        await page.waitForFunction(() => document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame === '0', null, { timeout: 90000 })
      } catch (error) {
        await capture('first-frame-failed'); console.error((await page.locator('body').innerText()).slice(-2500)); throw error
      }
      const firstFrameMs = performance.now() - openedAt
      const evidence = { machine: { cpu: os.cpus()[0].model, memoryBytes: os.totalmem() }, runtime: await app.evaluate(({ app }) => ({ versions: process.versions, gpu: app.getGPUFeatureStatus(), memory: app.getAppMetrics() })), media: mediaProbe, layers: 3, cases: [] }
      evidence.firstFrameMs = firstFrameMs
      evidence.firstFrame = await canvas.evaluate(canvas => ({ renderMs: Number(canvas.dataset.renderMs), decodeMs: Number(canvas.dataset.decodeMs), gpuMs: Number(canvas.dataset.gpuMs), cacheHits: Number(canvas.dataset.cacheHits), cacheBytes: Number(canvas.dataset.cacheBytes), timestamps: canvas.dataset.sourceTimestamps }))
      evidence.cacheDirectory = path.join(await app.evaluate(({ app }) => app.getPath('userData')), 'cache', 'video-edit-preview')
      evidence.gpuReadings = []
      const tracePath = process.env.HENJI_VIDEO_EDIT_SCRUB_TRACE
      if (tracePath) await app.evaluate(({ contentTracing }) => contentTracing.startRecording({ included_categories: ['devtools.timeline', 'v8', 'gpu', 'blink.user_timing', 'disabled-by-default-v8.gc'], recording_mode: 'record-as-much-as-possible' }))
      const stopGpuSampler = await startGpuSampler({ onReading: reading => evidence.gpuReadings.push(reading), onError: error => { evidence.gpuSamplingError = error.message } })
      try {
      const ruler = page.getByRole('slider', { name: '剪辑时间定位' })
      const waitPresented = async (frame, label) => {
        try { await page.waitForFunction(frame => document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame === String(frame), frame, { timeout: 90000 }) }
        catch (error) { console.error(label, await canvas.evaluate(canvas => ({ ...canvas.dataset })), (await page.locator('body').innerText()).slice(-1200)); await capture(label); throw error }
      }
      let pixels = 1
      for (const [name, from, to, duration] of [['cold-reverse', 359, 1, 6000], ['forward', 1, 359, 6000], ['reverse', 359, 1, 6000], ['fast-forward', 1, 359, 2000], ['warm-reverse', 359, 1, 2000], ['segment-forward', 26 * 60, 34 * 60, 6000], ['segment-reverse', 34 * 60, 26 * 60, 6000]]) {
        if (name === 'segment-forward') {
          // Named after its source: a supplied source must not reuse a loop made from another file.
          const longSource = path.join(root, `${path.basename(source, path.extname(source))}-40s.mp4`)
          if (!fs.existsSync(longSource)) execFileSync(ffmpegPath, ['-v', 'error', '-y', '-stream_loop', '-1', '-i', source, '-t', '40', '-c', 'copy', longSource], { windowsHide: true })
          const longProject = structuredClone(project); longProject.id = 'scrub-boundary'; longProject.media[0].path = longSource; longProject.media[0].durationSeconds = 40; longProject.sequences[0].clips.forEach(clip => { clip.duration = 36 * 60 })
          const longFile = path.join(root, 'boundary.hjvid'); fs.writeFileSync(longFile, JSON.stringify(longProject))
          await button(page, '关闭项目').click()
          await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }) }, longFile)
          await openVideoEditFile(page, longFile); await waitPresented(0, 'segment-start-failed')
          await page.getByRole('slider', { name: '时间线缩放', exact: true }).focus(); await page.getByRole('slider', { name: '时间线缩放', exact: true }).press('Home')
          // The timeline draws 60 x zoom / fps pixels per frame; read the zoom the control actually reached.
          pixels = 60 * Number(await page.getByRole('slider', { name: '时间线缩放', exact: true }).inputValue()) / 60
        }
        const box = await ruler.boundingBox()
        const safeStart = Math.max(6, from * pixels + pixels / 4)
        await ruler.click({ position: { x: safeStart, y: 12 } })
        let positioned = Number(await ruler.getAttribute('aria-valuenow'))
        for (let left = Math.ceil(6 / pixels) + 1; positioned !== from && left > 0; left--) {
          await ruler.press(positioned > from ? 'ArrowLeft' : 'ArrowRight')
          positioned = Number(await ruler.getAttribute('aria-valuenow'))
        }
        assert.equal(positioned, from)
        await waitPresented(from, `${name}-position-failed`)
        // Capture on the ruler body before moving to boundary frames, where the
        // dock separator overlaps the edge. Measurement starts at the same source frame.
        await page.mouse.move(box.x + safeStart, box.y + 12); await page.mouse.down()
        await page.mouse.move(box.x + from * pixels + pixels / 4, box.y + 12)
        await waitPresented(from, `${name}-captured-position-failed`)
        await canvas.evaluate(canvas => {
          window.__scrub = { targets: [], frames: [], start: performance.now() }
          performance.mark('video-edit-scrub-start')
          const ruler = document.querySelector('[aria-label="剪辑时间定位"]')
          window.__scrubTarget = new MutationObserver(() => window.__scrub.targets.push({ at: performance.now(), frame: Number(ruler.getAttribute('aria-valuenow')) }))
          window.__scrubTarget.observe(ruler, { attributes: true, attributeFilter: ['aria-valuenow'] })
          window.__scrubFrame = new MutationObserver(() => window.__scrub.frames.push({ at: performance.now(), frame: Number(canvas.dataset.presentedFrame), timestamps: canvas.dataset.sourceTimestamps, requestedAt: Number(canvas.dataset.requestedAt), renderMs: Number(canvas.dataset.renderMs), cacheHits: Number(canvas.dataset.cacheHits), decodeMs: Number(canvas.dataset.decodeMs), gpuMs: Number(canvas.dataset.gpuMs) }))
          window.__scrubFrame.observe(canvas, { attributes: true, attributeFilter: ['data-presented-frame'] })
        })
        const began = performance.now()
        for (let index = 1; index <= 180; index++) {
          const frame = Math.round(from + (to - from) * index / 180)
          await page.mouse.move(box.x + frame * pixels + pixels / 4, box.y + 12)
          const delay = began + duration * index / 180 - performance.now()
          if (delay > 0) await page.waitForTimeout(delay)
        }
        const ended = await page.evaluate(() => performance.now()); await page.mouse.up()
        try { await page.waitForFunction(frame => { const canvas = document.querySelector('canvas[aria-label="剪辑画面"]'); return canvas?.dataset.presentedFrame === String(frame) && canvas.dataset.scrubbing === 'false' }, to, { timeout: 90000 }) }
        catch (error) { console.error(`${name}-settle-failed`, { pixels, to, ruler: await ruler.getAttribute('aria-valuenow'), box }, await canvas.evaluate(canvas => ({ ...canvas.dataset }))); await capture(`${name}-settle-failed`); throw error }
        const data = await page.evaluate(() => { performance.mark('video-edit-scrub-end'); window.__scrubTarget.disconnect(); window.__scrubFrame.disconnect(); return window.__scrub })
        const during = data.frames.filter(frame => frame.at <= ended)
        const gaps = during.map((frame, index) => frame.at - (index ? during[index - 1].at : data.start))
        const lags = during.map(frame => { const target = [...data.targets].reverse().find(target => target.at <= frame.at); return target ? Math.abs(frame.frame - target.frame) * duration / Math.abs(to - from) : 0 })
        for (const frame of during) {
          const times = frame.timestamps.split(',').map(Number).sort((a, b) => a - b)
          const exact = Math.abs(times[0] - frame.frame / 60) < 1e-5 && Math.abs(times[1] - (1 + frame.frame / 60)) < 1e-5
          if (!exact) { evidence.failedCase = { name, frame, samples: data }; fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2)) }
          assert.ok(exact, `${name}：第 ${frame.frame} 帧画出的源时间为 ${frame.timestamps}（应为 ${frame.frame / 60} 与 ${1 + frame.frame / 60}）`)
        }
        const result = { name, durationMs: ended - data.start, inputs: data.targets.length, presentationsDuringDrag: during.length, submittedFramesPerSecond: during.length * 1000 / (ended - data.start), gapP95Ms: quantile(gaps, .95), gapMaxMs: Math.max(...gaps, ended - (during.at(-1)?.at ?? data.start)), pointerLagP95Ms: quantile(lags, .95), settleMs: Math.max(0, data.frames.at(-1).at - ended), renderP95Ms: quantile(during.map(frame => frame.renderMs), .95), decodeP95Ms: quantile(during.map(frame => frame.decodeMs), .95), gpuP95Ms: quantile(during.map(frame => frame.gpuMs), .95), cacheHits: during.reduce((sum, frame) => sum + (frame.cacheHits || 0), 0), samples: data }
        result.gapsOver25Ms = during.flatMap((frame, index) => gaps[index] > 25 ? [{ atMs: frame.at - data.start, gapMs: gaps[index], frame: frame.frame, decodeMs: frame.decodeMs, gpuMs: frame.gpuMs, renderMs: frame.renderMs, cacheHits: frame.cacheHits }] : [])
        result.inputGapsOver25Ms = data.targets.flatMap((target, index) => {
          const gapMs = target.at - (index ? data.targets[index - 1].at : data.start)
          return gapMs > 25 ? [{ atMs: target.at - data.start, gapMs }] : []
        })
        if (diagnostics) {
          const completed = (await workerSnapshot(page)).events.filter(event => event.kind === 'render.completed' && event.preparationStages)
          const before = [...completed].reverse().find(event => event.at < data.start)?.preparationStages ?? {}
          const after = [...completed].reverse().find(event => event.at <= data.frames.at(-1).at)?.preparationStages ?? {}
          result.preparation = Object.fromEntries(Object.entries(after).map(([key, value]) => [key, { ms: value.ms - (before[key]?.ms ?? 0), count: value.count - (before[key]?.count ?? 0) }]).filter(([, value]) => value.count > 0))
          console.log('[scrub-diagnostics]', name, JSON.stringify(result.preparation))
        }
        evidence.cases.push(result)
        fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
      }
      await capture('4k60-scrub')
      evidence.canvas = await canvas.evaluate(canvas => ({ width: canvas.width, height: canvas.height, cacheBytes: Number(canvas.dataset.cacheBytes), proxyPreparationMs: Number(canvas.dataset.proxyPreparationMs), proxyBytes: Number(canvas.dataset.proxyBytes), bounds: { width: canvas.getBoundingClientRect().width, height: canvas.getBoundingClientRect().height } }))
      assert.equal(evidence.canvas.width, 3840); assert.equal(evidence.canvas.height, 2160)
      evidence.diskPreviewFiles = fs.existsSync(evidence.cacheDirectory) ? fs.readdirSync(evidence.cacheDirectory) : []
      assert.deepEqual(evidence.diskPreviewFiles, [], '普通原素材预览不得生成磁盘转码缓存')
      assert.ok(evidence.canvas.cacheBytes <= 8 * 1024 ** 3, '临时帧工作集不能超过总预算')
      // Playback measures completed video frames, never animation callback counts.
      await button(page, '关闭项目').click()
      await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }) }, file)
      await openVideoEditFile(page, file)
      await page.waitForFunction(() => document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame === '0', null, { timeout: 90000 })
      await canvas.evaluate(canvas => {
        window.__playFrames = []
        window.__playObserver = new MutationObserver(() => window.__playFrames.push({ at: performance.now(), frame: Number(canvas.dataset.presentedFrame), renderMs: Number(canvas.dataset.renderMs), timestamps: canvas.dataset.sourceTimestamps }))
        window.__playObserver.observe(canvas, { attributes: true, attributeFilter: ['data-presented-frame'] })
      })
      const beganPlayback = performance.now()
      await button(page, '播放／暂停').click()
      await page.waitForFunction(() => document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame === '359')
      evidence.playback = { wallMs: performance.now() - beganPlayback, frames: await page.evaluate(() => { window.__playObserver.disconnect(); return window.__playFrames }) }
      evidence.playback.clockStartAt = await canvas.evaluate(canvas => Number(canvas.dataset.playClockStartAt))
      evidence.playback.videoDurationMs = evidence.playback.frames.at(-1).at - evidence.playback.clockStartAt
      evidence.playback.missing = Array.from({ length: 359 }, (_, i) => i + 1).filter(frame => !evidence.playback.frames.some(item => item.frame === frame))
      // Compare a colorful interior frame before/after cache reuse, independently
      // of encoder loss. This catches chroma, range, crop and orientation errors.
      await ruler.click({ position: { x: 120.1, y: 12 } }); await waitPresented(120, 'native-color-frame-failed')
      const nativePixels = await canvas.evaluate(canvas => canvas.toDataURL('image/png').split(',')[1])
      await ruler.click({ position: { x: 121.1, y: 12 } }); await waitPresented(121, 'cache-color-frame-failed')
      await ruler.click({ position: { x: 120.1, y: 12 } }); await waitPresented(120, 'cache-color-return-failed')
      assert.equal(await canvas.evaluate(canvas => Number(canvas.dataset.cacheHits)), 2, '比较画面必须使用两层原素材的缓存帧')
      const cachedPixels = await canvas.evaluate(canvas => canvas.toDataURL('image/png').split(',')[1])
      const sharp = require('sharp')
      const [nativeRgb, cachedRgb] = await Promise.all([sharp(Buffer.from(nativePixels, 'base64')).removeAlpha().raw().toBuffer(), sharp(Buffer.from(cachedPixels, 'base64')).removeAlpha().raw().toBuffer()])
      let difference = 0; for (let i = 0; i < nativeRgb.length; i++) difference += (nativeRgb[i] - cachedRgb[i]) ** 2
      evidence.cacheColorPsnr = 10 * Math.log10(255 ** 2 / (difference / nativeRgb.length))
      assert.ok(evidence.cacheColorPsnr > 40, `缓存画面改变颜色或细节：PSNR ${evidence.cacheColorPsnr}`)
      evidence.afterMemory = await app.evaluate(({ app }) => app.getAppMetrics())
      fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
      assert.deepEqual(evidence.playback.missing, [], '4K60 全帧率预览不能跳过时间线视频帧')
      assert.ok(evidence.playback.videoDurationMs < 6100, '4K60 不能通过减慢时钟实现全帧率')
      for (const result of evidence.cases) {
        const fast = ['fast-forward', 'warm-reverse'].includes(result.name)
        assert.ok(result.submittedFramesPerSecond >= (fast ? 58 : 27), `${result.name} 拖动期间只有 ${result.submittedFramesPerSecond.toFixed(1)} 次画面更新/秒`)
        assert.ok(result.gapMaxMs < (fast ? 50 : 500), `${result.name} 拖动期间停顿 ${result.gapMaxMs.toFixed(0)}ms`)
        assert.ok(result.settleMs < 100, `${result.name} 松手后定位耗时 ${result.settleMs.toFixed(0)}ms`)
      }
      await button(page, '关闭项目').click(); await waitReleased(page)
      evidence.resources = await workerSnapshot(page)
      assert.equal(evidence.resources.live, 0); assert.equal(evidence.resources.peakLive, 1)
      assert.ok(evidence.resources.workers.every(worker => worker.disposedAt && worker.terminatedAt), '原视频预览资源必须完成释放并终止')
      evidence.completed = true
      } finally {
        await stopGpuSampler()
        if (tracePath) evidence.tracePath = await app.evaluate(({ contentTracing }, file) => contentTracing.stopRecording(file), path.resolve(tracePath))
        evidence.resources = await workerSnapshot(page).catch(() => evidence.resources)
        fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
        await page.evaluate(() => { window.__videoLayoutObservers.forEach(observer => observer.disconnect()); window.Worker = window.__videoLayoutNativeWorker }).catch(() => {})
      }
    },
  }
}
function summarizeScrubAccelerationRound({ round, startAt, endAt, frames, events }) {
  const during = frames.filter(frame => frame.at >= startAt && frame.at <= endAt)
  const requestFrames = frames.filter(frame => frame.requestedAt >= startAt && frame.requestedAt <= endAt)
  const requests = events.filter(event => event.kind === 'render' && event.at >= startAt && event.at <= endAt)
  const completions = events.filter(event => event.kind === 'render.completed' && event.requestedAt >= startAt && event.requestedAt <= endAt)
  const completed = new Set(completions.map(event => event.id))
  const times = [startAt, ...during.map(frame => frame.at), endAt]
  // 首次远跳包含冷启动与按下开销；停更门槛衡量首个精确帧后的持续更新。
  const exactTimes = [...during.filter(frame => !frame.approximate).map(frame => frame.at), endAt]
  return { round, startAt, endAt, frames: during, requestFrames, events: [...requests, ...completions], unanswered: requests.filter(event => !completed.has(event.id)).length,
    gaps: times.slice(1).map((at, index) => at - times[index]), maxExactGapMs: Math.max(0, ...exactTimes.slice(1).map((at, index) => at - exactTimes[index])) }
}

function validateScrubAccelerationCase(result) {
  for (const round of result.rounds) {
    assert.equal(round.unanswered, 0, `${result.name} 第 ${round.round} 轮仍有拖动请求没有完成`)
    assert.ok(round.frames.some(frame => !frame.approximate), `${result.name} 第 ${round.round} 轮必须实际呈现精确帧`)
    assert.ok(round.maxExactGapMs < 500, `${result.name} 第 ${round.round} 轮精确画面停更 ${round.maxExactGapMs.toFixed(1)}ms`)
  }
  if (result.name.startsWith('accelDecel')) {
    assert.ok(result.exactRenderMs.p90 <= 50, `${result.name} 精确画面请求到呈现 p90 为 ${result.exactRenderMs.p90.toFixed(1)}ms，超过 50ms`)
    assert.ok(result.exactRequestRenderMs.p90 <= 50, `${result.name} 含拖动结束后呈现的精确请求 p90 为 ${result.exactRequestRenderMs.p90.toFixed(1)}ms，超过 50ms`)
    assert.ok(result.workerMs.p90 <= 50, `${result.name} 含拖动结束后回执的精确请求 p90 为 ${result.workerMs.p90.toFixed(1)}ms，超过 50ms`)
  }
}

function createVideoEditScrubAccelerationScene() {
  return { id: 'video-edit-acceleration', surface: '剪辑', name: '剪辑-加减速拖动精确帧分段计时', writesUserData: true,
    setup: async (page, app, { capture }) => {
      const { seedVideoEditProject, openVideoEditProjectCard, leaveVideoEditProject, takeOverVideoEdit } = require('./uiInspectionVideoEditDocuments.cjs')
      const { assignIsolatedMcpPort, authorizeMcpConnection, connectMcpClient, callTool, operationEnvelope, disableMcp } = require('./uiInspectionMcpClient.cjs')
      const { benchProject, ensureBenchRecording } = require('../../tests/fixtures/bench/video-edit/fixture.cjs')
      const root = path.resolve('.ui-tour/cache/video-edit-scrub-acceleration'); fs.mkdirSync(root, { recursive: true })
      const evidence = { cases: [], mode: process.env.HENJI_BUNDLE_MODE || 'production', prerender: process.env.HENJI_SCRUB_PRERENDER !== '0' }
      const save = () => fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
      const stats = values => ({ n: values.length, p50: quantile(values, .5), p90: quantile(values, .9), max: Math.max(0, ...values) })
      await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.webContents.setBackgroundThrottling(false) })
      await assignIsolatedMcpPort(page)
      await observeWorkers(page, true)
      const seeded = await seedVideoEditProject(page, benchProject(ensureBenchRecording()), { projectName: '加减速拖动' })
      await openVideoEditProjectCard(page, seeded.projectId)
      await page.waitForFunction(() => document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame === '0')
      await page.waitForTimeout(5000)
      if (evidence.prerender) {
        const identity = await authorizeMcpConnection(page, { name: '加减速拖动验收' })
        const client = await connectMcpClient(identity.config)
        try {
          const documentRef = { kind: 'video_edit.document', id: seeded.documentId }
          await callTool(client, 'render_video_edit_preview', operationEnvelope([await callTool(client, 'read_application_entity', { ref: documentRef })], { documentRef, scope: 'all' }))
          let cache
          for (let i = 0; i < 120; i++) {
            cache = (await callTool(client, 'read_application_entity', { ref: documentRef, propertyIds: ['video_edit.document.render_cache'] })).data.properties['video_edit.document.render_cache']
            if (cache.windows.length && cache.windows.every(window => window.state === 'ready')) break
            await page.waitForTimeout(1000)
          }
          assert.ok(cache.windows.length && cache.windows.every(window => window.state === 'ready'), '预渲染必须完成才开始测量')
          evidence.cache = cache
        } finally { await client.close(); await disableMcp(page) }
        await takeOverVideoEdit(page)
        await page.waitForTimeout(3000)
      }
      await page.evaluate(() => {
        const canvas = document.querySelector('canvas[aria-label="剪辑画面"]')
        window.__accelerationFrames = []
        window.__accelerationObserver = new MutationObserver(() => window.__accelerationFrames.push({ at: performance.now(), frame: Number(canvas.dataset.presentedFrame), requestedAt: Number(canvas.dataset.requestedAt), renderMs: Number(canvas.dataset.renderMs), approximate: canvas.dataset.approximate === 'true', decodeMs: Number(canvas.dataset.decodeMs), gpuMs: Number(canvas.dataset.gpuMs) }))
        window.__accelerationObserver.observe(canvas, { attributes: true, attributeFilter: ['data-presented-frame'] })
      })
      const ruler = await page.getByRole('slider', { name: '剪辑时间定位', exact: true }).boundingBox()
      const y = ruler.y + ruler.height / 2
      const ease = t => t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
      try {
        for (const [name, curve] of [['linear', t => t], ['accelDecel', ease], ['linear2', t => t], ['accelDecel2', ease]]) {
          const rounds = []
          for (let round = 0; round < 4; round++) {
            await page.evaluate(() => { window.__accelerationFrames = [] })
            const startAt = await page.evaluate(() => performance.now())
            // 反向轮次覆盖一次向右跳转后缓动后退的状态切换。
            await page.mouse.move(ruler.x + ruler.width * .04, y); await page.mouse.down()
            for (let i = 1; i <= 90; i++) {
              const p = round % 2 ? 1 - curve(i / 90) : curve(i / 90)
              await page.mouse.move(ruler.x + ruler.width * (.04 + .38 * p), y); await page.waitForTimeout(16)
            }
            const endAt = await page.evaluate(() => performance.now())
            await page.mouse.up(); await page.waitForTimeout(1200)
            await page.waitForFunction(() => {
              const canvas = document.querySelector('canvas[aria-label="剪辑画面"]'), ruler = document.querySelector('[aria-label="剪辑时间定位"]')
              return canvas?.dataset.presentedFrame === ruler?.getAttribute('aria-valuenow') && canvas?.dataset.scrubbing === 'false' && canvas?.dataset.approximate === 'false'
            }, null, { timeout: 90000 })
            const frames = await page.evaluate(() => window.__accelerationFrames)
            const snapshot = await workerSnapshot(page)
            const program = new Set(snapshot.workers.filter(worker => worker.direct && !worker.terminated).map(worker => worker.id))
            const events = snapshot.events.filter(event => program.has(event.worker))
            rounds.push(summarizeScrubAccelerationRound({ round, startAt, endAt, frames, events }))
          }
          const frames = rounds.flatMap(round => round.frames), renders = rounds.flatMap(round => round.events.filter(event => event.kind === 'render.completed' && event.presented && !event.approximate))
          const requestFrames = rounds.flatMap(round => round.requestFrames)
          const stages = Object.fromEntries(['delivery', 'queue', 'prerenderQueue', 'prerenderDecode', 'prerenderSnapshot', 'prerenderDraw', 'presentComplete'].map(key => [key, stats(renders.flatMap(event => Number.isFinite(event.renderStages?.[key]) ? [event.renderStages[key]] : []))]))
          const requestPreparation = requestFrames.filter(frame => !frame.approximate).flatMap(frame => {
            const matching = renders.filter(event => event.frame === frame.frame && event.at <= frame.at && event.requestedAt >= frame.requestedAt).sort((a, b) => a.requestedAt - b.requestedAt)[0]
            return matching ? [matching.requestedAt - frame.requestedAt] : []
          })
          const result = { name, renderMs: stats(frames.map(entry => entry.renderMs)), exactRenderMs: stats(frames.filter(entry => !entry.approximate).map(entry => entry.renderMs)), exactRequestRenderMs: stats(requestFrames.filter(entry => !entry.approximate).map(entry => entry.renderMs)), gaps: stats(rounds.flatMap(round => round.gaps)), requestPreparationMs: stats(requestPreparation), workerMs: stats(renders.map(entry => entry.elapsedMs)), decodeMs: stats(renders.map(entry => entry.decodeMs ?? 0)), gpuMs: stats(renders.map(entry => entry.gpuMs ?? 0)), stages, rounds }
          evidence.cases.push(result); save()
          console.log('[scrub-acceleration]', JSON.stringify({ ...result, rounds: undefined }))
        }
        await capture('scrub-acceleration')
        for (const result of evidence.cases) validateScrubAccelerationCase(result)
      } finally { await page.evaluate(() => window.__accelerationObserver.disconnect()); save(); await leaveVideoEditProject(page) }
    } }
}
module.exports = { createVideoEditScrubScene, createVideoEditScrubAccelerationScene, summarizeScrubAccelerationRound, validateScrubAccelerationCase }
