const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { findPanePoint, readCanvasState, resetViewport, sweep } = require('./canvasPanBench.cjs')
const { createPanDiagnostics, installPageDiagnostics } = require('./canvasPanDiagnostics.cjs')

function createCanvasScalePerformanceScenes(context) {
  if (process.env.CANVAS_SCALE_BENCH !== '1') return []
  const counts = (process.env.CANVAS_SCALE_COUNTS || '100,500,1000').split(',').map(Number)
  if (counts.some(count => !Number.isInteger(count) || count < 50 || count > 5000)) throw new Error('CANVAS_SCALE_COUNTS 必须在 50 到 5000 之间')
  return [{
    id: 'canvas-scale-performance', surface: '画布', name: '画布-混合节点规模性能', writesUserData: true,
    async setup(page, app, inspection) {
      const imagePath = process.env.CANVAS_SCALE_IMAGE
      if (!imagePath) throw new Error('CANVAS_SCALE_IMAGE 必须指向真实内容图片')
      const bytes = [...await fs.readFile(imagePath)], extension = path.extname(imagePath).slice(1)
      const image = await page.evaluate(({ bytes, extension }) => window.henjiNative.image.persistImageBinary(new Uint8Array(bytes), extension), { bytes, extension })
      const viewport = { x: 40, y: 80, zoom: 0.5 }
      const out = path.resolve(process.env.CANVAS_SCALE_OUT || '.ui-tour/canvas-scale-performance.json')
      await fs.mkdir(path.dirname(out), { recursive: true })
      const report = { collectedAt: new Date().toISOString(), checkoutCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        staleBuildDiagnostic: process.env.HENJI_SKIP_BUILD_FRESHNESS === '1',
        debuggerDiagnostic: process.env.CANVAS_SCALE_DIAGNOSE === '1',
        openOnly: process.env.CANVAS_SCALE_OPEN_ONLY === '1',
        build: createHash('sha256').update(await fs.readFile('out/main/index.cjs')).update(await fs.readFile('out/renderer/index.html')).digest('hex'),
        hardware: { cpu: os.cpus()[0].model, threads: os.cpus().length, memoryBytes: os.totalmem(), gpu: await app.evaluate(({ app }) => app.getGPUInfo('basic')) },
        imagePath, window: inspection.windowEvidence, viewport, runs: [] }
      await context.setupCanvas(page)
      for (const count of counts) {
        if (await page.locator('.react-flow').count()) await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
        const projectId = `canvas-scale-${Date.now()}-${count}`
        const edgeCount = await page.evaluate(async ({ count, projectId, image, viewport }) => {
          const nodes = [], edges = []
          for (let i = 0; i < count; i++) {
            const kind = i % 3, group = Math.floor(i / 3), x = (group % 16) * 1100 + kind * 350, y = Math.floor(group / 16) * 520
            nodes.push({ id: `scale-${i}`, type: ['uploadNode', 'imageNode', 'exportImageNode'][kind], position: { x, y },
              style: { width: kind === 1 ? 320 : 260, height: kind === 1 ? 380 : 280 },
              data: kind === 1 ? { prompt: '保留人物、构图与颜色，输出清晰自然的图像。', modelId: 'kie-nano-banana-2', aspectRatio: '1:1', params: {} }
                : { imageUrl: image, previewImageUrl: image, aspectRatio: '1:1', displayName: kind === 0 ? '参考图' : '生成结果', isGenerating: false } })
            if (kind > 0) edges.push({ id: `scale-edge-${i}`, source: `scale-${i - 1}`, target: `scale-${i}`,
              sourceHandle: 'source', targetHandle: kind === 1 ? 'param:__image' : 'target', type: 'disconnectableEdge' })
          }
          await window.henjiNative.db.execute('INSERT INTO storyboard_projects (id,name,created_at,updated_at,node_count,nodes_json,edges_json,viewport_json,history_json) VALUES (?,?,?,?,?,?,?,?,?)',
            [projectId, `性能基准 ${count}`, Date.now(), Date.now(), count, JSON.stringify(nodes), JSON.stringify(edges), JSON.stringify(viewport), JSON.stringify({ past: [], future: [], imagePool: [] })])
          return edges.length
        }, { count, projectId, image, viewport })
        // 每档重建渲染层状态，避免上一档已加载工程的会话缓存遮蔽数据库夹具。
        await page.reload({ waitUntil: 'domcontentloaded' })
        await context.setupCanvas(page)
        let probe, pauseTimer
        if (process.env.CANVAS_SCALE_DIAGNOSE === '1') {
          probe = await page.context().newCDPSession(page)
          await probe.send('Debugger.enable')
          probe.on('Debugger.paused', async event => {
            console.log('[canvas-scale-performance] paused', JSON.stringify(event.callFrames.map(frame => ({ name: frame.functionName, location: frame.location, url: frame.url }))))
            for (const frame of event.callFrames.slice(0, 4)) {
              const value = await probe.send('Debugger.evaluateOnCallFrame', { callFrameId: frame.callFrameId,
                expression: "typeof fieldName === 'string' ? fieldName : typeof partial2 === 'object' && partial2 ? Object.keys(partial2) : null", returnByValue: true })
              console.log('[canvas-scale-performance] updating-fields', JSON.stringify(value.result.value))
            }
            await probe.send('Debugger.resume')
          })
          pauseTimer = setTimeout(() => { void probe.send('Debugger.pause').catch(() => {}) }, 15000)
        }
        const begin = performance.now()
        console.log('[canvas-scale-performance] opening', count)
        await page.locator(`[data-project-id="${projectId}"]`).click()
        await page.waitForFunction(count => document.querySelectorAll('.react-flow__node').length === count, count, { timeout: 180000 }).catch(async error => {
          const actual = await page.locator('.react-flow__node').count()
          throw new Error(`节点规模不匹配：期望 ${count}，实际 ${actual}。${error.message}`)
        })
        console.log('[canvas-scale-performance] mounted', count)
        clearTimeout(pauseTimer)
        if (probe) { await probe.send('Debugger.disable'); await probe.detach() }
        await page.waitForFunction(() => [...document.querySelectorAll('.react-flow__node img')].some(image => image.complete && image.naturalWidth > 0), undefined, { timeout: 30000 })
        const openMs = performance.now() - begin
        const run = { count, edgeCount, openMs, samples: [] }
        report.runs.push(run)
        await fs.writeFile(out, JSON.stringify(report, null, 2))
        console.log('[canvas-scale-performance] opened', JSON.stringify({ count, openMs }))
        await page.waitForTimeout(1000)
        if (report.openOnly) {
          run.state = await readCanvasState(page)
          run.processes = await app.evaluate(({ app }) => app.getAppMetrics())
          await fs.writeFile(out, JSON.stringify(report, null, 2))
          await inspection.capture(`nodes-${count}`)
          continue
        }
        const session = await page.context().newCDPSession(page)
        await installPageDiagnostics(page)
        const diagnostics = await createPanDiagnostics(page, session)
        const samples = run.samples
        try {
          for (let round = 0; round < 5; round++) {
            const reset = await resetViewport(page, session, viewport)
            if (!reset.ok) throw new Error('画布基准视口无法复位')
            const grab = await findPanePoint(page)
            if (!grab) throw new Error('画布基准找不到真实平移命中位置')
            const before = await diagnostics.startRound()
            const sample = await sweep(page, session, { grab, durationMs: 1800, dx: -9, intervalMs: 10 })
            samples.push({ round, ...sample, diagnostics: await diagnostics.endRound(before) })
            await fs.writeFile(out, JSON.stringify(report, null, 2))
            if (!sample.valid) {
              await inspection.capture(`nodes-${count}-failed`)
              throw new Error(`画布采样无效：${sample.invalidReasons.join('；')}`)
            }
            await page.waitForTimeout(250)
          }
          run.state = await readCanvasState(page)
          run.processes = await app.evaluate(({ app }) => app.getAppMetrics())
          await fs.writeFile(out, JSON.stringify(report, null, 2))
          console.log('[canvas-scale-performance]', JSON.stringify({ count, edgeCount, openMs, samples: samples.map(({ round, p95Ms, p99Ms, fps, maxMs, diagnostics }) => ({ round, p95Ms, p99Ms, fps, maxMs, scriptMs: diagnostics.cdp.scriptDurationMs, longTasks: diagnostics.longTasks })) }))
          await inspection.capture(`nodes-${count}`)
        } finally { await diagnostics.dispose(); await session.detach() }
      }
    },
  }]
}

module.exports = { createCanvasScalePerformanceScenes }
