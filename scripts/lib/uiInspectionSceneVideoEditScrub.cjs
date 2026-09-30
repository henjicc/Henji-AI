const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync, execFile } = require('node:child_process')
const button = (page, name) => page.getByRole('button', { name, exact: true })
const quantile = (values, q) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * q))] ?? 0

function createVideoEditScrubScene() {
  return {
    id: 'video-edit-4k60-scrub', surface: '剪辑', name: '剪辑-4K60连续拖动实际画面更新', writesUserData: true,
    setup: async (page, app, { capture }) => {
      const root = path.resolve('node_modules/.cache/video-edit-scrub'); fs.mkdirSync(root, { recursive: true })
      const { ffmpegPath, ffprobePath } = require('ffmpeg-ffprobe-static')
      const source = path.join(root, '4k60-gop120-b2.mp4')
      if (!fs.existsSync(source)) execFileSync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=3840x2160:rate=60', '-t', '8', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-g', '120', '-keyint_min', '120', '-sc_threshold', '0', '-bf', '2', '-pix_fmt', 'yuv420p', source], { windowsHide: true })
      const clip = { id: 'base', mediaId: 'source', name: '4K60 主画面', kind: 'video', track: 1, start: 0, duration: 360, sourceInUs: 0, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 0, brightness: 1, text: '' }
      const project = { format: 'henji-video-project', version: 1, id: 'scrub-4k60', name: '4K60 连续拖动验证', revision: 0, width: 3840, height: 2160, fps: 60, media: [{ id: 'source', name: '4k60-gop120-b2.mp4', path: source, kind: 'video', durationSeconds: 8, width: 3840, height: 2160 }], clips: [clip, { ...clip, id: 'overlay', name: '4K60 叠加', track: 2, sourceInUs: 1000000, x: .3, y: .3, scale: .3 }, { ...clip, id: 'text', mediaId: undefined, name: '文字', kind: 'text', track: 3, text: '4K60', y: -.35, scale: .5 }], annotations: [] }
      const file = path.join(root, 'scrub.henji-video'); fs.writeFileSync(file, JSON.stringify(project))
      await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }) }, file)
      await button(page, '剪辑').click(); await button(page, '打开工程').click()
      const canvas = page.getByLabel('剪辑画面', { exact: true })
      await page.waitForFunction(() => document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame === '0', null, { timeout: 30000 })
      const evidence = { machine: { cpu: os.cpus()[0].model, memoryBytes: os.totalmem() }, runtime: await app.evaluate(({ app }) => ({ versions: process.versions, gpu: app.getGPUFeatureStatus(), memory: app.getAppMetrics() })), media: JSON.parse(execFileSync(ffprobePath, ['-v', 'error', '-show_streams', '-of', 'json', source], { windowsHide: true, encoding: 'utf8' })), layers: 3, cases: [] }
      evidence.gpuReadings = []
      let sampling = false
      const gpuTimer = setInterval(() => {
        if (sampling) return; sampling = true
        execFile('nvidia-smi', ['--query-gpu=utilization.gpu,utilization.decoder,memory.used', '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 3000 }, (error, stdout) => { sampling = false; if (!error) evidence.gpuReadings.push({ at: Date.now(), values: stdout.trim() }) })
      }, 500)
      try {
      const ruler = page.getByRole('slider', { name: '剪辑时间定位' })
      let pixels = 1
      for (const [name, from, to, duration] of [['cold-reverse', 359, 1, 6000], ['forward', 1, 359, 6000], ['reverse', 359, 1, 6000], ['fast-forward', 1, 359, 2000], ['warm-reverse', 359, 1, 2000], ['segment-forward', 26 * 60, 34 * 60, 6000], ['segment-reverse', 34 * 60, 26 * 60, 6000]]) {
        if (name === 'segment-forward') {
          const longSource = path.join(root, '4k60-40s.mp4')
          if (!fs.existsSync(longSource)) execFileSync(ffmpegPath, ['-v', 'error', '-y', '-stream_loop', '4', '-i', source, '-t', '40', '-c', 'copy', longSource], { windowsHide: true })
          const longProject = structuredClone(project); longProject.id = 'scrub-boundary'; longProject.media[0].path = longSource; longProject.media[0].durationSeconds = 40; longProject.clips.forEach(clip => { clip.duration = 36 * 60 })
          const longFile = path.join(root, 'boundary.henji-video'); fs.writeFileSync(longFile, JSON.stringify(longProject))
          await button(page, '关闭工程').click()
          await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }) }, longFile)
          await button(page, '打开工程').click(); await page.waitForFunction(() => document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame === '0', null, { timeout: 30000 })
          await page.getByLabel('时间线缩放', { exact: true }).focus(); await page.getByLabel('时间线缩放', { exact: true }).press('Home'); pixels = .25
        }
        const box = await ruler.boundingBox()
        await ruler.click({ position: { x: from * pixels + .1, y: 12 } }); await page.waitForFunction(frame => document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame === String(frame), from, { timeout: 30000 })
        await canvas.evaluate(canvas => {
          window.__scrub = { targets: [], frames: [], start: performance.now() }
          const ruler = document.querySelector('[aria-label="剪辑时间定位"]')
          window.__scrubTarget = new MutationObserver(() => window.__scrub.targets.push({ at: performance.now(), frame: Number(ruler.getAttribute('aria-valuenow')) }))
          window.__scrubTarget.observe(ruler, { attributes: true, attributeFilter: ['aria-valuenow'] })
          window.__scrubFrame = new MutationObserver(() => window.__scrub.frames.push({ at: performance.now(), frame: Number(canvas.dataset.presentedFrame), timestamps: canvas.dataset.sourceTimestamps, requestedAt: Number(canvas.dataset.requestedAt), renderMs: Number(canvas.dataset.renderMs), cacheHits: Number(canvas.dataset.cacheHits) }))
          window.__scrubFrame.observe(canvas, { attributes: true, attributeFilter: ['data-presented-frame'] })
        })
        await page.mouse.move(box.x + from * pixels + .1, box.y + 12); await page.mouse.down()
        const began = performance.now()
        for (let index = 1; index <= 180; index++) {
          const frame = Math.round(from + (to - from) * index / 180)
          await page.mouse.move(box.x + frame * pixels + .1, box.y + 12)
          const delay = began + duration * index / 180 - performance.now()
          if (delay > 0) await page.waitForTimeout(delay)
        }
        const ended = await page.evaluate(() => performance.now()); await page.mouse.up()
        await page.waitForFunction(frame => { const canvas = document.querySelector('canvas[aria-label="剪辑画面"]'); return canvas?.dataset.presentedFrame === String(frame) && canvas.dataset.scrubbing === 'false' }, to, { timeout: 30000 })
        const data = await page.evaluate(() => { window.__scrubTarget.disconnect(); window.__scrubFrame.disconnect(); return window.__scrub })
        const during = data.frames.filter(frame => frame.at <= ended)
        const gaps = during.map((frame, index) => frame.at - (index ? during[index - 1].at : data.start))
        const lags = during.map(frame => { const target = [...data.targets].reverse().find(target => target.at <= frame.at); return target ? Math.abs(frame.frame - target.frame) * duration / Math.abs(to - from) : 0 })
        for (const frame of during) { const times = frame.timestamps.split(',').map(Number).sort((a, b) => a - b); assert.ok(Math.abs(times[0] - frame.frame / 60) < 1e-5); assert.ok(Math.abs(times[1] - (1 + frame.frame / 60)) < 1e-5) }
        const result = { name, durationMs: ended - data.start, inputs: data.targets.length, presentationsDuringDrag: during.length, submittedFramesPerSecond: during.length * 1000 / (ended - data.start), gapP95Ms: quantile(gaps, .95), gapMaxMs: Math.max(...gaps, ended - (during.at(-1)?.at ?? data.start)), pointerLagP95Ms: quantile(lags, .95), settleMs: Math.max(0, data.frames.at(-1).at - ended), renderP95Ms: quantile(during.map(frame => frame.renderMs), .95), cacheHits: during.reduce((sum, frame) => sum + (frame.cacheHits || 0), 0), samples: data }
        evidence.cases.push(result)
        fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
      }
      await capture('4k60-scrub')
      evidence.canvas = await canvas.evaluate(canvas => ({ width: canvas.width, height: canvas.height, cacheBytes: Number(canvas.dataset.cacheBytes), proxyPreparationMs: Number(canvas.dataset.proxyPreparationMs), proxyBytes: Number(canvas.dataset.proxyBytes), bounds: { width: canvas.getBoundingClientRect().width, height: canvas.getBoundingClientRect().height }, pixel: [...canvas.getContext('2d').getImageData(Math.floor(canvas.width * .2), Math.floor(canvas.height * .5), 1, 1).data] }))
      evidence.afterMemory = await app.evaluate(({ app }) => app.getAppMetrics())
      fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
      for (const result of evidence.cases) {
        assert.ok(result.submittedFramesPerSecond >= 15, `${result.name} 拖动期间只有 ${result.submittedFramesPerSecond.toFixed(1)} 次画面更新/秒`)
        assert.ok(result.gapMaxMs < 500, `${result.name} 拖动期间停顿 ${result.gapMaxMs.toFixed(0)}ms`)
        assert.ok(result.settleMs < 350, `${result.name} 松手后定位耗时 ${result.settleMs.toFixed(0)}ms`)
      }
      } finally { clearInterval(gpuTimer); fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2)) }
    },
  }
}
module.exports = { createVideoEditScrubScene }
