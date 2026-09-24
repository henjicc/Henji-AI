const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { findPanePoint, readCanvasState, resetViewport, sweep } = require('./canvasPanBench.cjs')
const { createPanDiagnostics, installPageDiagnostics } = require('./canvasPanDiagnostics.cjs')
const { checkCanvasViewport } = require('./uiInspectionCanvasViewport.cjs')

function createCanvasScalePerformanceScenes(context) {
  if (process.env.CANVAS_SCALE_BENCH !== '1') return []
  const counts = (process.env.CANVAS_SCALE_COUNTS || '100,500,1000').split(',').map(Number)
  if (counts.some(count => !Number.isInteger(count) || count < 50 || count > 5000)) throw new Error('CANVAS_SCALE_COUNTS 必须在 50 到 5000 之间')
  const offscreenDiagnostic = process.env.CANVAS_SCALE_OFFSCREEN_DIAGNOSE || null
  if (offscreenDiagnostic && !['hit-test', 'paint'].includes(offscreenDiagnostic)) throw new Error('CANVAS_SCALE_OFFSCREEN_DIAGNOSE 只支持 hit-test 或 paint')
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
        cpuProfileDiagnostic: process.env.CANVAS_SCALE_CPU_PROFILE === '1',
        traceDiagnostic: process.env.CANVAS_SCALE_TRACE === '1',
        offscreenDiagnostic,
        subscriptionDiagnostic: process.env.CANVAS_SCALE_SUBSCRIPTIONS === '1',
        checkHeaderInteraction: process.env.CANVAS_SCALE_HEADER_CHECK === '1',
        checkViewportInteraction: process.env.CANVAS_SCALE_VIEWPORT_CHECK === '1',
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
        if (report.subscriptionDiagnostic) run.viewportSubscribers = await page.evaluate(async () => {
          const element = document.querySelector('.react-flow__node')
          let fiber = element[Object.keys(element).find(key => key.startsWith('__reactFiber$'))]
          let store
          let root = fiber
          while (fiber) {
            for (let dependency = fiber.dependencies?.firstContext; dependency; dependency = dependency.next) {
              const value = dependency.memoizedValue
              if (value?.getState?.().nodeLookup && value?.getState?.().transform) store = value
            }
            root = fiber
            fiber = fiber.return
          }
          if (!store) throw new Error('找不到 ReactFlow 诊断订阅源')
          let changed
          const unsubscribe = store.subscribe((state, previous) => {
            if (state.transform === previous.transform) return
            unsubscribe()
            const counts = {}
            const pending = [root]
            while (pending.length) {
              const item = pending.pop()
              for (let hook = item.memoizedState; hook; hook = hook.next) {
                const queue = hook.queue
                if (typeof queue?.getSnapshot !== 'function') continue
                if (!Object.is(queue.value, queue.getSnapshot())) {
                  const type = item.type?.displayName || item.type?.name || item.type?.type?.name || 'unknown'
                  counts[type] = (counts[type] || 0) + 1
                }
              }
              if (item.child) pending.push(item.child)
              if (item.sibling) pending.push(item.sibling)
            }
            changed = counts
          })
          const panZoom = store.getState().panZoom
          const original = panZoom.getViewport()
          try {
            await panZoom.setViewport({ ...original, x: original.x + 1 })
            await new Promise(resolve => setTimeout(resolve, 0))
          } finally {
            unsubscribe()
            await panZoom.setViewport(original)
          }
          if (!changed) throw new Error('视口诊断未捕获订阅变化')
          return changed
        })
        if (report.openOnly) {
          run.state = await readCanvasState(page)
          run.processes = await app.evaluate(({ app }) => app.getAppMetrics())
          if (report.checkViewportInteraction) {
            const session = await page.context().newCDPSession(page)
            try { run.viewportInteraction = await checkCanvasViewport(page, session, inspection, context, projectId) }
            finally { await session.detach() }
          }
          await fs.writeFile(out, JSON.stringify(report, null, 2))
          await inspection.capture(`nodes-${count}`)
          continue
        }
        const session = await page.context().newCDPSession(page)
        await installPageDiagnostics(page)
        const diagnostics = await createPanDiagnostics(page, session)
        const samples = run.samples
        try {
          for (let round = 0; round < (offscreenDiagnostic ? 10 : 5); round++) {
            const reset = await resetViewport(page, session, viewport)
            if (!reset.ok) throw new Error('画布基准视口无法复位')
            // 仅用于归因：交替隔离整个扫掠区域之外的命中或绘制，不作为产品优化验收。
            // 预留完整单向扫掠距离；节点内容和订阅保持原样。
            const offscreenProbe = offscreenDiagnostic ? await page.evaluate(({ enabled, mode }) => {
              document.querySelectorAll('[data-hit-test-probe]').forEach(element => element.removeAttribute('data-hit-test-probe'))
              if (!document.getElementById('canvas-hit-test-probe-style')) {
                const style = document.createElement('style')
                style.id = 'canvas-hit-test-probe-style'
                style.textContent = `[data-hit-test-probe], [data-hit-test-probe] * { ${mode === 'paint' ? 'visibility: hidden' : 'pointer-events: none'} !important; }`
                document.head.append(style)
              }
              if (!enabled) return { enabled, excluded: 0 }
              const bounds = document.querySelector('.react-flow').getBoundingClientRect()
              const outside = [...document.querySelectorAll('.react-flow__node, [data-node-header-drag-surface]')].filter(element => {
                const box = element.getBoundingClientRect()
                return box.right < bounds.left - 200 || box.left > bounds.right + 2400
                  || box.bottom < bounds.top - 200 || box.top > bounds.bottom + 200
              })
              outside.forEach(element => element.setAttribute('data-hit-test-probe', 'true'))
              return { enabled, excluded: outside.length }
            }, { enabled: round % 2 === 1, mode: offscreenDiagnostic }) : undefined
            if (offscreenDiagnostic) await page.waitForTimeout(500)
            const grab = await findPanePoint(page)
            if (!grab) throw new Error('画布基准找不到真实平移命中位置')
            const before = await diagnostics.startRound()
            const traceRound = report.traceDiagnostic && round < (offscreenDiagnostic ? 2 : 1)
            if (traceRound) await session.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline.frame', transferMode: 'ReturnAsStream' })
            if (report.cpuProfileDiagnostic) { await session.send('Profiler.enable'); await session.send('Profiler.start') }
            let sample
            try {
              sample = await sweep(page, session, { grab, durationMs: 1800, dx: -9, intervalMs: 10 })
            } finally {
              if (traceRound) {
                const completed = new Promise(resolve => session.once('Tracing.tracingComplete', resolve))
                await session.send('Tracing.end')
                const { stream } = await completed
                const traceFile = await fs.open(`${out}.${count}${offscreenDiagnostic ? `.${round}` : ''}.trace.json`, 'w')
                try {
                  let part
                  do {
                    part = await session.send('IO.read', { handle: stream })
                    await traceFile.write(part.base64Encoded ? Buffer.from(part.data, 'base64') : part.data)
                  } while (!part.eof)
                } finally { await traceFile.close(); await session.send('IO.close', { handle: stream }) }
              }
              if (report.cpuProfileDiagnostic) {
                const { profile } = await session.send('Profiler.stop')
                await fs.writeFile(`${out}.${count}.${round}.cpuprofile`, JSON.stringify(profile))
                await session.send('Profiler.disable')
              }
            }
            samples.push({ round, offscreenProbe, ...sample, diagnostics: await diagnostics.endRound(before) })
            if (offscreenProbe?.enabled) {
              const visibleExcluded = await page.evaluate(() => {
                const bounds = document.querySelector('.react-flow').getBoundingClientRect()
                return [...document.querySelectorAll('[data-hit-test-probe]')].filter(element => {
                  const box = element.getBoundingClientRect()
                  return box.right > bounds.left && box.left < bounds.right && box.bottom > bounds.top && box.top < bounds.bottom
                }).length
              })
              offscreenProbe.visibleExcluded = visibleExcluded
              if (visibleExcluded) throw new Error(`屏外诊断误排除了 ${visibleExcluded} 个可见元素`)
            }
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
          if (report.checkHeaderInteraction) {
            await resetViewport(page, session, viewport)
            const header = page.locator('[data-node-header-drag-surface="scale-0"]')
            const node = page.locator('.react-flow__node[data-id="scale-0"]')
            const before = await node.evaluate(element => {
              const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform)
              return { x: matrix.m41, y: matrix.m42 }
            })
            const box = await header.boundingBox()
            if (!box) throw new Error('节点标题命中层缺失')
            const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
            await page.mouse.move(point.x, point.y)
            await page.mouse.down()
            await page.mouse.move(point.x + 40, point.y + 20, { steps: 8 })
            await page.mouse.up()
            const after = await node.evaluate(element => {
              const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform)
              return { x: matrix.m41, y: matrix.m42, selected: element.classList.contains('selected') }
            })
            // 原生拖拽跨过启动阈值才建立起点，不能把首段激活位移也算进节点位移。
            // 核对命中的确是节点、方向/距离正确，且没有把手势误交给画布平移。
            const canvasAfterDrag = await readCanvasState(page)
            if (!after.selected || after.x - before.x < 40 || after.y - before.y < 20
              || Math.abs(canvasAfterDrag.x - viewport.x) > 4 || Math.abs(canvasAfterDrag.y - viewport.y) > 4) {
              throw new Error(`标题拖动或选中异常：${JSON.stringify({ before, after })}`)
            }
            await header.dblclick()
            const titleInput = node.locator('[data-node-header="true"] input')
            await titleInput.waitFor({ state: 'visible' })
            const originalTitle = await titleInput.inputValue()
            await titleInput.fill('临时标题草稿')
            await titleInput.press('Escape')
            await titleInput.waitFor({ state: 'hidden' })
            if (!await node.getByRole('button', { name: originalTitle, exact: true }).count()) throw new Error('取消标题编辑未恢复原名称')
            run.headerInteraction = { before, after, titleEditCancelled: true }
            await fs.writeFile(out, JSON.stringify(report, null, 2))
            await inspection.capture(`nodes-${count}-header`)
          }
          if (report.checkViewportInteraction) {
            run.viewportInteraction = await checkCanvasViewport(page, session, inspection, context, projectId)
            await fs.writeFile(out, JSON.stringify(report, null, 2))
          }
        } finally {
          if (offscreenDiagnostic) await page.evaluate(() => {
            document.querySelectorAll('[data-hit-test-probe]').forEach(element => element.removeAttribute('data-hit-test-probe'))
            document.getElementById('canvas-hit-test-probe-style')?.remove()
          })
          await diagnostics.dispose(); await session.detach()
        }
      }
    },
  }]
}

module.exports = { createCanvasScalePerformanceScenes }
