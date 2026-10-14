const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { videoEditFixtureProject } = require('./uiInspectionSceneVideoEditProbe.cjs')
const { seedVideoEditProject, openVideoEditProjectCard, leaveVideoEditProject } = require('./uiInspectionVideoEditDocuments.cjs')

function createScreenCaptureScene() {
  return { id: 'screen-capture', name: '屏幕采集-双后端与剪辑回读', surface: '剪辑', writesUserData: true,
    setup: async (page, app) => {
      const root = path.resolve('.ui-tour/screen-capture'); fs.mkdirSync(root, { recursive: true })
      const { ffmpegPath, ffprobePath } = require('./mediaBinaries.cjs')
      const source = path.join(root, 'motion.mp4')
      execFileSync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=60', '-t', '5', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', source], { windowsHide: true })
      const makeProject = (file, id, duration, width = 1920, height = 1080) => videoEditFixtureProject({ id, name: `录制验收 ${id}`, revision: 0, width, height, fps: 60,
        media: [{ id: 'source', name: '录制画面', path: file, kind: 'video', width, height, durationSeconds: duration, hasAudio: false }],
        clips: [{ id: 'v', mediaId: 'source', name: '画面', kind: 'video', track: 1, start: 0, duration: Math.floor(duration * 60), sourceInUs: 0, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '' }], annotations: [] })
      const longSource = path.join(root, 'motion-long.mp4')
      execFileSync(ffmpegPath, ['-v', 'error', '-y', '-stream_loop', '-1', '-i', source, '-t', '600', '-c', 'copy', longSource], { windowsHide: true })
      const seeded = await seedVideoEditProject(page, makeProject(longSource, 'capture-load', 600))
      await openVideoEditProjectCard(page, seeded.projectId)
      await page.getByLabel('剪辑画面', { exact: true }).waitFor({ state: 'visible' })
      await page.waitForFunction(() => window.__henjiCapture)
      const probe = await page.evaluate(() => window.henjiNative.testFixtures.recordingControl('read'))
      const displays = await app.evaluate(({ screen }) => screen.getAllDisplays().map(d => ({ id: String(d.id), bounds: d.bounds, scale: d.scaleFactor })))
      const performanceMode = process.env.HENJI_CAPTURE_BENCHMARK === '1'
      const seconds = performanceMode ? 120 : 30
      const results = { seconds, displays, runs: [] }
      const save = () => fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(results, null, 2))
      const specs = performanceMode ? [[1920, 1080], [3840, 2160]] : [[1920, 1080]]
      try {
        for (const backend of ['gfxcapture', 'chromium']) for (const [width, height] of specs) {
          const id = require('node:crypto').randomUUID()
          const sources = await page.evaluate(() => window.henjiNative.screenRecording.sources())
          const display = [...displays].sort((a, b) => b.bounds.width * b.scale - a.bounds.width * a.scale)[0]
          const sourceId = performanceMode ? sources.find(s => s.kind === 'screen' && s.displayId === display.id)?.id : probe.sourceId
          assert(sourceId, '无法定位真实采集源')
          const run = { backend, width, height, sourceId, samples: [] }; results.runs.push(run); save()
          await page.evaluate(async ({ id, options }) => {
            await window.henjiNative.screenRecording.grant({ sessionId: id, userReceipt: crypto.randomUUID(), kinds: ['screen'], selection: { sourceId: options.sourceId, excludedSourceIds: [] } })
            await window.__henjiCapture.prepare(id, options)
            await window.henjiNative.screenRecording.control(id, 'toggle')
          }, { id, options: { sourceId, backend, width, height, fps: 60, bitrate: width === 3840 ? 45_000_000 : 12_000_000 } })
          let ready = false
          for (let attempt = 0; attempt < 180; attempt++) {
            const state = await page.evaluate(() => window.henjiNative.screenRecording.snapshot())
            if (state?.phase === 'failed') throw new Error(state.error)
            if (state?.phase === 'recording' && !state.busy) { ready = true; break }
            await page.waitForTimeout(250)
          }
          assert(ready, '采集未在 45 秒内准备好')
          const started = Date.now()
          if (results.runs.length === 1) await page.getByRole('button', { name: '播放／暂停', exact: true }).click()
          while (Date.now() - started < seconds * 1000) {
            await page.waitForTimeout(1000)
            const metrics = await app.evaluate(({ app }) => app.getAppMetrics().map(m => ({ type: m.type, cpu: m.cpu.percentCPUUsage, workingSetKiB: m.memory.workingSetSize })))
            let gpu = null
            try { gpu = execFileSync('nvidia-smi', ['--query-gpu=utilization.gpu,utilization.encoder,memory.used', '--format=csv,noheader,nounits'], { windowsHide: true, encoding: 'utf8', timeout: 3000 }).trim() } catch { /* Evidence says unavailable rather than reporting zero. */ }
            let native = null
            if (backend === 'gfxcapture') {
              const quoted = "'" + ffmpegPath.replace(/'/g, "''") + "'"
              const query = `$ProgressPreference='SilentlyContinue'; Get-Process -Name ffmpeg -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq ${quoted} } | Select-Object Id,CPU,WorkingSet64 | ConvertTo-Json -Compress`
              try { native = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(query, 'utf16le').toString('base64')], { windowsHide: true, encoding: 'utf8', timeout: 5000 }).trim() || 'null') } catch { /* Missing counters stay unknown. */ }
            }
            run.samples.push({ elapsedMs: Date.now() - started, metrics, gpu, native })
            const status = await page.evaluate(() => window.henjiNative.screenRecording.snapshot())
            assert.equal(status.phase, 'recording', status.error || '录制中断')
          }
          await page.evaluate(id => window.henjiNative.screenRecording.control(id, 'toggle'), id)
          const paused = await page.evaluate(() => window.__henjiCapture.read())
          assert.equal(paused.status, 'paused')
          await page.waitForTimeout(300)
          await page.evaluate(id => window.henjiNative.screenRecording.control(id, 'toggle'), id)
          await page.waitForTimeout(1500)
          await page.evaluate(id => window.henjiNative.screenRecording.control(id, 'stop'), id)
          run.manifest = await page.evaluate(() => window.__henjiCapture.read())
          assert.equal(run.manifest.status, 'stopped')
          assert.equal(run.manifest.cursorEmbedded, backend === 'chromium')
          const directory = path.join(probe.uploads, 'screen-recordings', id)
          run.files = run.manifest.spans.filter(span => span.finalized).map(span => {
            const file = path.join(directory, span.file)
            const info = JSON.parse(execFileSync(ffprobePath, ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', file], { windowsHide: true, encoding: 'utf8', timeout: 60000 }))
            assert.equal(info.streams[0].width, width); assert.equal(info.streams[0].height, height)
            assert(Number(info.streams[0].nb_read_frames) > 0)
            const kept = path.join(root, `${backend}-${width}-${span.index}.mp4`); fs.copyFileSync(file, kept)
            return { path: kept, duration: Number(info.format.duration), frames: Number(info.streams[0].nb_read_frames), monoUs: span.monoUs }
          })
          assert.equal(run.files.length, 2)
          await page.evaluate(() => window.__henjiCapture.close())
          // Simulate abrupt tail loss only after preserving the complete acceptance copies.
          const last = path.join(directory, run.manifest.spans.at(-1).file)
          const size = fs.statSync(last).size
          fs.truncateSync(last, Math.max(0, size - 32768))
          run.recovery = await page.evaluate(id => window.henjiNative.screenRecording.capture({ operation: 'recover', sessionId: id }), id)
          assert(run.recovery.files.length >= 1, '尾部损坏不能丢失先前已写入的片段')
          save(); console.log('[screen-capture]', JSON.stringify({ backend, width, files: run.files }))
        }
        await leaveVideoEditProject(page)
        for (const run of results.runs) {
          const file = run.files[0]
          const imported = await seedVideoEditProject(page, makeProject(file.path, `${run.backend}-${run.width}`, file.duration, run.width, run.height))
          await openVideoEditProjectCard(page, imported.projectId)
          const canvas = page.getByLabel('剪辑画面', { exact: true })
          await canvas.waitFor({ state: 'visible' })
          await page.waitForFunction(() => document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame === '0', null, { timeout: 30000 })
          const ruler = page.getByRole('slider', { name: '剪辑时间定位' })
          await ruler.click({ position: { x: 60, y: 12 } })
          const frame = await ruler.getAttribute('aria-valuenow')
          await page.waitForFunction(frame => document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame === frame, frame, { timeout: 30000 })
          run.editorReadback = { frame }; save()
          await page.getByRole('button', { name: '播放／暂停', exact: true }).click()
          await page.waitForFunction(frame => Number(document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame) > Number(frame) + 10, frame, { timeout: 10000 })
          await page.getByRole('button', { name: '播放／暂停', exact: true }).click()
          run.editorReadback.played = true; save()
          await leaveVideoEditProject(page)
        }
      } finally { await page.evaluate(() => window.__henjiCapture?.close()).catch(() => {}); save() }
    },
  }
}
module.exports = { createScreenCaptureScene }
