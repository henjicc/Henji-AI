const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const { videoEditFixtureProject } = require('./uiInspectionSceneVideoEditProbe.cjs')
const { seedVideoEditProject, openVideoEditProjectCard, readVideoEditFile, leaveVideoEditProject } = require('./uiInspectionVideoEditDocuments.cjs')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope } = require('./uiInspectionMcpClient.cjs')
const { dialogs, presented } = require('./uiInspectionSceneVideoEditMonitor.cjs')
const { confirmVideoEditExport } = require('./uiInspectionVideoEditExportDialog.cjs')

/** Real capture of an isolated fixture window, real OCR utility, public confirmation and formal export. */
function createOcrPrivacyScene() {
  return { id: 'ocr-privacy', surface: '剪辑', name: 'OCR-真实录制识别确认与滚动打码导出', writesUserData: true,
    setup: async (page, app, { capture }) => {
      assert(process.env.HENJI_OCR_MODELS, 'HENJI_OCR_MODELS must point to isolated official v6 weights')
      const root = path.resolve('.ui-tour/ocr-privacy'); fs.mkdirSync(root, { recursive: true })
      const { ffmpegPath, ffprobePath } = require('./mediaBinaries.cjs')
      const evidence = {}; let fixtureId; let client
      const save = () => fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
      try {
        const dirs = await page.evaluate(() => window.henjiNative.paths.appDirectories())
        assert(dirs.userRoot.includes('henji-electron-test-'), 'Refuse to seed weights in real user data')
        const manifest = require('../check-persistence-compat.cjs').loadTypeScript('electron/main/services/local-models/manifest.ts').LOCAL_MODEL_MANIFEST
        for (const model of manifest.filter(m => ['text_detection_ppocr', 'text_recognition_ppocr'].includes(m.id))) {
          for (const locale of ['zh', 'en']) {
            const target = path.join(dirs.userRoot, locale === 'zh' ? '模型' : 'Models', model.folderName[locale]); fs.mkdirSync(target, { recursive: true })
            for (const file of model.files) fs.copyFileSync(path.join(process.env.HENJI_OCR_MODELS, file.name), path.join(target, file.name))
          }
        }
        // This test window contains only made-up credentials. No desktop or other application is captured.
        const fixture = await app.evaluate(async ({ BrowserWindow, screen }) => {
          const display = screen.getDisplayNearestPoint({ x: 2561, y: 1 })
          const window = new BrowserWindow({ x: display.bounds.x, y: display.bounds.y, width: 2560, height: 1440, frame: false, show: false, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } })
          const html = `<html><body style="margin:0;background:white;color:black;font:32px 'Microsoft YaHei'"><main style="padding:100px;height:2800px"><h1>Screen recording privacy</h1><p>demo@example.com</p><p>sk-testABCDEFGHIJKLMNOP1234</p><p>Normal text stays visible</p><p>中文录屏隐私检查</p><div style="height:600px"></div><p>Scroll review complete</p></main><canvas id="clock" width="40" height="40" style="position:fixed;right:20px;bottom:20px"></canvas><script>const c=document.getElementById('clock').getContext('2d');function tick(t){c.fillStyle='white';c.fillRect(0,0,40,40);c.fillStyle='black';c.fillRect((t/40)%32,0,8,40);requestAnimationFrame(tick)}requestAnimationFrame(tick)</script></body></html>`
          await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)); window.showInactive()
          return { id: window.id, sourceId: window.getMediaSourceId(), scale: display.scaleFactor, bounds: window.getContentBounds() }
        })
        fixtureId = fixture.id; evidence.fixture = fixture; save()
        await page.waitForFunction(() => window.__henjiCapture)
        const id = randomUUID()
        await page.evaluate(async ({ id, sourceId }) => {
          await window.henjiNative.screenRecording.grant({ sessionId: id, userReceipt: crypto.randomUUID(), kinds: ['screen'], selection: { sourceId, excludedSourceIds: [] } })
          await window.__henjiCapture.prepare(id, { sourceId, backend: 'chromium', width: 3840, height: 2160, fps: 30, bitrate: 18000000 })
          await window.henjiNative.screenRecording.control(id, 'toggle')
        }, { id, sourceId: fixture.sourceId })
        let ready = false
        for (let i = 0; i < 240; i++) {
          const manifest = await page.evaluate(() => window.__henjiCapture.read())
          if (manifest?.status === 'failed') throw new Error('Fixture capture failed')
          if (manifest?.status === 'recording' && manifest.spans.length) { ready = true; break }
          await page.waitForTimeout(250)
        }
        assert(ready, 'Formal capture must finish its countdown and actually open a span')
        const captureStarted = Date.now()
        await page.waitForTimeout(1600)
        evidence.beforeScroll = await page.evaluate(() => window.__henjiCapture.read()); save()
        await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).webContents.executeJavaScript('window.scrollTo(0, 160)'), fixtureId)
        await page.waitForTimeout(1800)
        await page.evaluate(id => window.henjiNative.screenRecording.control(id, 'stop'), id)
        const recording = await page.evaluate(() => window.__henjiCapture.read())
        evidence.captureWallMs = Date.now() - captureStarted; evidence.manifest = recording; save()
        assert.equal(recording.status, 'stopped')
        const original = path.join(dirs.folders.uploads, 'screen-recordings', id, recording.spans.find(s => s.finalized).file)
        const source = path.join(root, 'recorded-4k.mp4'); fs.copyFileSync(original, source)
        await page.evaluate(() => window.__henjiCapture.close())
        await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.destroy(), fixtureId); fixtureId = undefined
        const probe = JSON.parse(execFileSync(ffprobePath, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', source], { encoding: 'utf8', windowsHide: true }))
        const duration = Number(probe.format.duration); evidence.recording = { duration, width: probe.streams[0].width, height: probe.streams[0].height, backend: recording.backend }; save()
        assert.equal(probe.streams[0].width, 3840); assert.equal(probe.streams[0].height, 2160)
        assert(duration >= 3, `Capture must contain both still and scrolled intervals: ${duration}s`)
        execFileSync(ffmpegPath, ['-v', 'error', '-y', '-ss', '0.5', '-i', source, '-frames:v', '1', path.join(root, 'real-4k.png')], { windowsHide: true })
        const fixtureProject = videoEditFixtureProject({ id: 'ocr-privacy', name: '录屏隐私验收', revision: 0, width: 3840, height: 2160, fps: 30,
          media: [{ id: 'screen', name: '屏幕原片', path: source, kind: 'video', width: 3840, height: 2160, durationSeconds: duration, hasAudio: false }],
          clips: [{ id: 'clip', mediaId: 'screen', name: '隐私录制', kind: 'video', track: 1, start: 0, duration: Math.floor(duration * 30), sourceInUs: 0, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '' }], annotations: [] })
        const seeded = await seedVideoEditProject(page, fixtureProject); await openVideoEditProjectCard(page, seeded.projectId)
        client = await connectMcpClient((await authorizeMcpConnection(page, { name: 'OCR免费验收', allowWrites: true, allowDestructive: true })).config)
        const documentRef = { kind: 'video_edit.document', id: seeded.documentId }, clipRef = { kind: 'video_edit.clip', id: `${seeded.documentId}:clip` }
        const read = (ref, propertyIds) => callTool(client, 'read_application_entity', { ref, propertyIds })
        const change = async (ref, properties) => {
          const value = await callTool(client, 'change_application_entities', operationEnvelope([await read(ref, Object.keys(properties))], { summary: '确认隐私候选', changes: [{ kind: 'set_properties', entityType: ref.kind, target: ref, properties }] }))
          assert.equal(value.executionState, 'completed', JSON.stringify(value))
        }
        const generated = await callTool(client, 'detect_video_edit_sensitive_text', operationEnvelope([await read(clipRef, ['video_edit.clip.name'])], { documentRef, clipRef }))
        assert.equal(generated.executionState, 'completed', JSON.stringify(generated))
        const effects = readVideoEditFile(seeded.file).sequences[0].clips[0].effects
        assert(effects.length >= 2); assert(effects.every(e => e.enabled === false))
        evidence.effects = effects; save()
        const snapshot = async (frame, label) => {
          await change(documentRef, { 'video_edit.document.program_playback': { frame, playing: false, playbackDirection: 1 } }); await presented(page, frame)
          const bytes = await page.getByLabel('剪辑画面', { exact: true }).evaluate(canvas => canvas.toDataURL('image/png').split(',')[1])
          const file = path.join(root, `${label}-${frame}.png`); fs.writeFileSync(file, Buffer.from(bytes, 'base64')); return file
        }
        const frame = 15, before = await snapshot(frame, 'pending')
        for (const effect of effects) await change({ kind: 'video_edit.effect', id: `${seeded.documentId}:${effect.id}` }, { 'video_edit.effect.enabled': true })
        await snapshot(frame + 1, 'refresh')
        const after = await snapshot(frame, 'confirmed')
        assert(!fs.readFileSync(before).equals(fs.readFileSync(after)), 'Confirmed redaction must change pixels')
        await snapshot(Math.min(Math.floor(duration * 30) - 1, 85), 'scrolled')
        const output = path.join(root, `redacted-${id}.mp4`); await dialogs(app, [], output)
        evidence.phase = 'export'; save()
        await confirmVideoEditExport(page)
        let task
        for (let i = 0; i < 360; i++) {
          task = await callTool(client, 'query_video_edit_export', { documentRef })
          if (['completed', 'failed', 'cancelled'].includes(task.data.queue?.[0]?.state ?? task.data.task?.state)) break
          await page.waitForTimeout(500)
        }
        evidence.export = task.data.queue?.[0] ?? task.data.task; save()
        assert.equal(evidence.export?.state, 'completed', JSON.stringify(task))
        assert.equal(evidence.export?.outputReady, true, 'Formal export must verify its output')
        assert(fs.existsSync(output), JSON.stringify(task))
        fs.copyFileSync(output, path.join(root, 'redacted.mp4'))
        for (const second of [.5, 2.8]) execFileSync(ffmpegPath, ['-v', 'error', '-y', '-ss', String(second), '-i', output, '-frames:v', '1', path.join(root, `export-${second}.png`)], { windowsHide: true })
        await capture('ocr-privacy-confirmed')
        // Optional 600-second encoded stream of the same real recording: deterministic scroll/idle benchmark.
        if (process.env.HENJI_OCR_LONG === '1') {
          evidence.phase = 'benchmark'; save()
          const long = process.env.HENJI_OCR_LONG_SOURCE ? path.resolve(process.env.HENJI_OCR_LONG_SOURCE) : path.join(root, 'loop-600s.mp4')
          if (!process.env.HENJI_OCR_LONG_SOURCE) execFileSync(ffmpegPath, ['-v', 'error', '-y', '-stream_loop', '-1', '-i', source, '-t', '600', '-c', 'copy', long], { windowsHide: true })
          const cursor = process.env.HENJI_OCR_LONG_CURSOR ? JSON.parse(fs.readFileSync(process.env.HENJI_OCR_LONG_CURSOR, 'utf8')) : undefined
          await page.evaluate(root => window.henjiNative.media.allowRoot(root), path.dirname(long))
          let finished = false; const samples = []; const started = Date.now()
          const pending = page.evaluate(async ({ source, cursor }) => window.henjiNative.smartRegions.detectSensitiveText({ requestId: crypto.randomUUID(), source, mediaId: 'benchmark', startUs: 0, endUs: 600000000, originUs: 0, ...(cursor ? { cursor } : {}) }), { source: long, cursor }).finally(() => { finished = true })
          while (!finished) { samples.push(await app.evaluate(({ app }) => app.getAppMetrics().filter(m => m.name === '痕迹AI本地推理').map(m => ({ pid: m.pid, workingSetKiB: m.memory.workingSetSize })))); await page.waitForTimeout(1000) }
          const result = await pending
          evidence.benchmark = { input: process.env.HENJI_OCR_LONG_SOURCE ? '600s deterministic cursor/scroll fixture, not ten-minute live recording' : '600s loop of real capture, not ten-minute live recording', durationMs: Date.now() - started, frames: result.frames, inferredFrames: result.inferredFrames, inferenceRatio: result.inferredFrames / result.frames, samples }; save()
          if (process.env.HENJI_OCR_LONG_SOURCE) {
            assert(result.inferredFrames / result.frames <= .2, 'Typical recording must infer at most 20% of sampled frames')
            assert(evidence.benchmark.durationMs <= 120000, 'Ten-minute fixture must finish within two minutes')
            assert(result.privacy.candidates.some(c => c.kind === 'email' && c.startUs === 18000000), 'The newly scrolled email must be detected at 18s')
          }
        }
        await leaveVideoEditProject(page)
        evidence.phase = 'completed'; save()
      } finally {
        await page.evaluate(() => window.__henjiCapture?.close()).catch(() => undefined)
        if (fixtureId) await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.destroy(), fixtureId)
        await client?.close(); await disableMcp(page); save()
      }
    },
  }
}
module.exports = { createOcrPrivacyScene }
