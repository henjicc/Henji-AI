const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { videoEditFixtureProject } = require('./uiInspectionSceneVideoEditProbe.cjs')
const { openVideoEditFile, readVideoEditFile, leaveVideoEditProject } = require('./uiInspectionVideoEditDocuments.cjs')
const { presented } = require('./uiInspectionSceneVideoEditMonitor.cjs')
const { observeWorkers, workerSnapshot } = require('./uiInspectionSceneVideoEditLayout.cjs')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope } = require('./uiInspectionMcpClient.cjs')

function statistics(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  const at = q => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? null
  return { count: sorted.length, p50: at(.5), p95: at(.95), max: at(1) }
}
async function comparePixels(actual, expected) {
  const sharp = require('sharp')
  const raw = file => sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const [a, b] = await Promise.all([raw(actual), raw(expected)])
  assert.deepEqual(a.info, b.info)
  let maxDelta = 0; let changed = 0
  for (let i = 0; i < a.data.length; i++) { const delta = Math.abs(a.data[i] - b.data[i]); maxDelta = Math.max(maxDelta, delta); if (delta) changed++ }
  return { maxDelta, changedChannels: changed, changedRatio: changed / a.data.length, channels: a.data.length }
}
function createVideoEditCodePerformanceScene() {
  return { id: 'video-edit-code-performance', surface: '剪辑', name: '剪辑-复杂代码真实播放与冷启动', writesUserData: true,
    setup: async (page, app, { capture }) => {
      const label = process.env.HENJI_CODE_PERF_LABEL ?? 'after'
      assert.match(label, /^[a-z0-9-]+$/)
      const root = path.resolve('node_modules/.cache/t112', label); fs.mkdirSync(root, { recursive: true })
      const evidence = { completed: false, resolution: [1920, 1080], fps: 30, expectedFrames: 180,
        measurements: { rounds: ['first-playback', 'warmed-playback'], drawMs: 'code draw preparation through GPU queue completion, excluding CPU evaluation', presentationMs: 'compositor submission through queue completion; not physical display scanout', requestMs: 'main-to-worker request through completed response', dropped: '180 expected timeline frames minus distinct completed presentations, including the initially presented frame 0' },
        pixelTolerance: { maxDelta: 1, changedRatio: .0001 }, pixels: [], runs: [], observations: [] }
      const save = () => fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
      save()
      const file = path.join(root, 'fixture.json')
      const project = videoEditFixtureProject({ id: 't112-code-performance', name: '代码播放性能验收', revision: 0, width: 1920, height: 1080, fps: 30, media: [], clips: [], annotations: [] })
      fs.writeFileSync(file, JSON.stringify(project))
      let client
      try {
        assert.ok(await app.evaluate(() => Boolean(process.env.HENJI_ISOLATED_APP_DATA)), '性能场景只允许隔离资料目录')
        evidence.runtime = await app.evaluate(async ({ app }) => ({ electron: process.versions.electron, chrome: process.versions.chrome, gpu: await app.getGPUInfo('basic') }))
        await observeWorkers(page)
        const opened = await openVideoEditFile(page, file)
        const documentRef = { kind: 'video_edit.document', id: opened.documentId }
        const sequenceRef = { kind: 'video_edit.sequence', id: `${opened.documentId}:${project.sequences[0].id}` }
        const port = await new Promise((resolve, reject) => {
          const server = require('node:net').createServer(); server.once('error', reject)
          server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(error => error ? reject(error) : resolve(port)) })
        })
        await page.evaluate(port => window.henjiNative.mcp.configure({ enabled: true, port }), port)
        const identity = await authorizeMcpConnection(page, { name: '代码播放性能验收', allowWrites: true })
        client = await connectMcpClient(identity.config, 'Henji code performance')
        const change = async (ref, entry) => {
          const read = await callTool(client, 'read_application_entity', { ref })
          const result = await callTool(client, 'change_application_entities', operationEnvelope([read], { summary: '代码播放性能验收', changes: [entry] }))
          assert.equal(result.executionState, 'completed', JSON.stringify(result))
        }
        const source = fs.readFileSync(path.resolve('src/tests/fixtures/videoEdit/performance/complex-to-simple.ts.txt'), 'utf8')
        await change(documentRef, { kind: 'create_items', entityType: 'video_edit.code_material', parent: documentRef, items: [{ properties: { 'video_edit.code_material.source': source } }] })
        let item
        for (let i = 0; i < 100 && !item; i++) { item = readVideoEditFile(file).items.find(item => item.kind === 'code'); if (!item) await page.waitForTimeout(100) }
        assert.ok(item)
        await change(sequenceRef, { kind: 'create_items', entityType: 'video_edit.clip', parent: sequenceRef, items: [{ properties: { 'video_edit.clip.item_id': item.id, 'video_edit.clip.kind': 'code', 'video_edit.clip.name': 'complex-to-simple', 'video_edit.clip.track': 1, 'video_edit.clip.start': 0, 'video_edit.clip.duration': 180 } }] })
        const playback = (frame, playing) => change(documentRef, { kind: 'set_properties', entityType: documentRef.kind, target: documentRef, properties: { 'video_edit.document.program_playback': { frame, playing, playbackDirection: 1 } } })
        await change(documentRef, { kind: 'set_properties', entityType: documentRef.kind, target: documentRef, properties: { 'video_edit.document.playback_resolution': { resolution: 'full', fullWhenPaused: true } } })
        const canvas = page.locator('canvas[aria-label="剪辑画面"]')
        for (let round = 0; round < 2; round++) {
          await playback(0, false); await presented(page, 0)
          const start = await page.evaluate(() => performance.now())
          await playback(0, true)
          await page.waitForTimeout(6500)
          const snapshot = await workerSnapshot(page)
          const programWorkers = new Set(snapshot.workers.filter(worker => worker.direct && worker.sequenceId === project.sequences[0].id).map(worker => worker.id))
          const frames = snapshot.events.filter(event => programWorkers.has(event.worker) && event.kind === 'render.completed' && event.at >= start && event.frame < 180 && event.codePerformance?.length)
          const unique = [...new Map(frames.filter(frame => frame.presented).map(frame => [frame.frame, frame])).values()]
          const presentedCount = new Set([0, ...unique.map(frame => frame.frame)]).size
          const samples = frames.flatMap(frame => frame.codePerformance)
          assert.ok(samples.length > 0, '必须捕获正式节目 Worker 的逐帧成本，零样本不能报通过')
          assert.ok(frames.every(frame => frame.codePerformance.every(sample => sample.frame === frame.frame)), '两帧流水统计必须属于本次请求')
          evidence.runs.push({ round, samples: frames, presented: presentedCount, dropped: 180 - presentedCount, droppedRatio: (180 - presentedCount) / 180,
            cpuMs: statistics(samples.map(sample => sample.cpuMs)), drawMs: statistics(samples.map(sample => sample.gpuMs)), evaluateDrawMs: statistics(samples.map(sample => sample.cpuMs + sample.gpuMs)), presentationMs: statistics(frames.map(frame => frame.gpuMs)), requestMs: statistics(frames.map(frame => frame.elapsedMs)) })
          save()
          await playback(179, false); await presented(page, 179)
        }
        for (const frame of [30, 90, 96, 150, 175]) {
          await playback(frame, false); await presented(page, frame)
          const png = await canvas.evaluate(canvas => canvas.toDataURL('image/png'))
          const image = path.join(root, `frame-${frame}.png`)
          fs.writeFileSync(image, Buffer.from(png.split(',')[1], 'base64'))
          if (process.env.HENJI_CODE_PERF_REFERENCE) {
            const comparison = await comparePixels(image, path.join(process.env.HENJI_CODE_PERF_REFERENCE, `frame-${frame}.png`))
            evidence.pixels.push({ frame, ...comparison }); save()
            assert.ok(comparison.maxDelta <= evidence.pixelTolerance.maxDelta && comparison.changedRatio <= evidence.pixelTolerance.changedRatio, `帧 ${frame} 像素超出容差：${JSON.stringify(comparison)}`)
          }
          const result = await callTool(client, 'observe_video_edit_frame', { documentRef, target: { kind: 'program', sequenceRef, frame }, maxWidth: 1920 })
          evidence.observations.push({ frame, result }); save()
        }
        await capture('code-performance-175')
        evidence.workers = (await workerSnapshot(page)).workers
        if (label === 'after') {
          assert.ok(evidence.runs[1].evaluateDrawMs.p95 <= 1000 / 30, '稳态 p95 必须进入 30fps 预算')
          assert.equal(evidence.runs[1].dropped, 0, '热播放必须呈现全部 180 帧')
          for (const observation of evidence.observations) {
            const data = observation.result.result?.data ?? observation.result.data
            assert.ok(data.performance?.length)
            assert.ok(data.performance.every(sample => sample.preparation && sample.sampling?.mode === 'adjacent-frame'), '取帧必须返回独立首次准备和相邻帧稳态样本')
          }
        }
        evidence.completed = true; save()
      } finally { save(); if (client) { await client.close(); await disableMcp(page).catch(() => {}) } await leaveVideoEditProject(page).catch(() => {}) }
    },
  }
}
module.exports = { createVideoEditCodePerformanceScene, statistics }
