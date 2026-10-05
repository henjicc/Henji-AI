const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync, execFile } = require('node:child_process')
const { observeWorkers, workerSnapshot, waitReleased } = require('./uiInspectionSceneVideoEditLayout.cjs')
const button = (page, name) => page.getByRole('button', { name, exact: true })
const quantile = (values, q) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * q))] ?? 0

function createVideoEditScrubScene() {
  return {
    id: 'video-edit-4k60-scrub', surface: '剪辑', name: '剪辑-4K60连续拖动实际画面更新', writesUserData: true,
    setup: async (page, app, { capture }) => {
      const suppliedSource = process.env.HENJI_VIDEO_EDIT_SCRUB_SOURCE
      const root = path.resolve(`node_modules/.cache/video-edit-scrub${suppliedSource ? '-original' : ''}`); fs.mkdirSync(root, { recursive: true })
      const { ffmpegPath, ffprobePath } = require('./mediaBinaries.cjs')
      const source = suppliedSource ? path.resolve(suppliedSource) : path.join(root, '4k60-gop120-b2.mp4')
      if (suppliedSource) assert.ok(fs.existsSync(source), '指定的原素材必须存在，不生成替代文件')
      if (!fs.existsSync(source)) execFileSync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=3840x2160:rate=60', '-t', '8', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-g', '120', '-keyint_min', '120', '-sc_threshold', '0', '-bf', '2', '-pix_fmt', 'yuv420p', source], { windowsHide: true })
      const mediaProbe = JSON.parse(execFileSync(ffprobePath, ['-v', 'error', '-show_streams', '-of', 'json', source], { windowsHide: true, encoding: 'utf8' }))
      const videoTrack = mediaProbe.streams.find(stream => stream.codec_type === 'video')
      assert.equal(videoTrack.width, 3840); assert.equal(videoTrack.height, 2160); assert.equal(videoTrack.avg_frame_rate, '60/1')
      const clip = { id: 'base', mediaId: 'source', name: '4K60 主画面', kind: 'video', track: 1, start: 0, duration: 360, sourceInUs: 0, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 0, brightness: 1, text: '' }
      const fixture = { format: 'henji-video-project', version: 1, id: 'scrub-4k60', name: '4K60 连续拖动验证', revision: 0, width: 3840, height: 2160, fps: 60, media: [{ id: 'source', name: path.basename(source), path: source, kind: 'video', durationSeconds: Number(videoTrack.duration), width: 3840, height: 2160 }], clips: [clip, { ...clip, id: 'overlay', name: '4K60 叠加', track: 2, sourceInUs: 1000000, x: .3, y: .3, scale: .3 }, { ...clip, id: 'text', mediaId: undefined, name: '文字', kind: 'text', track: 3, text: '4K60', y: -.35, scale: .5 }], annotations: [] }
      const project = require('./uiInspectionSceneVideoEditProbe.cjs').videoEditFixtureProject(fixture)
      const file = path.join(root, 'scrub.henji-video'); fs.writeFileSync(file, JSON.stringify(project))
      await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }) }, file)
      await observeWorkers(page)
      await button(page, '剪辑').click(); const openedAt = performance.now(); await button(page, '打开项目文件').click()
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
      let sampling = false
      const gpuTimer = setInterval(() => {
        if (sampling) return; sampling = true
        execFile('nvidia-smi', ['--query-gpu=utilization.gpu,utilization.decoder,memory.used', '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 3000 }, (error, stdout) => { sampling = false; if (!error) evidence.gpuReadings.push({ at: Date.now(), values: stdout.trim() }) })
      }, 500)
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
          const longFile = path.join(root, 'boundary.henji-video'); fs.writeFileSync(longFile, JSON.stringify(longProject))
          await button(page, '关闭项目').click()
          await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }) }, longFile)
          await button(page, '打开项目文件').click(); await waitPresented(0, 'segment-start-failed')
          await page.getByLabel('时间线缩放', { exact: true }).focus(); await page.getByLabel('时间线缩放', { exact: true }).press('Home')
          // The timeline draws 60 x zoom / fps pixels per frame; read the zoom the control actually reached.
          pixels = 60 * Number(await page.getByLabel('时间线缩放', { exact: true }).inputValue()) / 60
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
        const data = await page.evaluate(() => { window.__scrubTarget.disconnect(); window.__scrubFrame.disconnect(); return window.__scrub })
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
      await button(page, '打开项目文件').click()
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
        assert.ok(result.submittedFramesPerSecond >= (['fast-forward', 'warm-reverse'].includes(result.name) ? 57 : 27), `${result.name} 拖动期间只有 ${result.submittedFramesPerSecond.toFixed(1)} 次画面更新/秒`)
        assert.ok(result.gapMaxMs < 500, `${result.name} 拖动期间停顿 ${result.gapMaxMs.toFixed(0)}ms`)
        assert.ok(result.settleMs < 100, `${result.name} 松手后定位耗时 ${result.settleMs.toFixed(0)}ms`)
      }
      await button(page, '关闭项目').click(); await waitReleased(page)
      evidence.resources = await workerSnapshot(page)
      assert.equal(evidence.resources.live, 0); assert.equal(evidence.resources.peakLive, 1)
      assert.ok(evidence.resources.workers.every(worker => worker.disposedAt && worker.terminatedAt), '原视频预览资源必须完成释放并终止')
      evidence.completed = true
      } finally {
        clearInterval(gpuTimer)
        evidence.resources = await workerSnapshot(page).catch(() => evidence.resources)
        fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
        await page.evaluate(() => { window.__videoLayoutObservers.forEach(observer => observer.disconnect()); window.Worker = window.__videoLayoutNativeWorker }).catch(() => {})
      }
    },
  }
}
module.exports = { createVideoEditScrubScene }
