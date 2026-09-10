const { readFile, writeFile } = require('node:fs/promises')
const { installEdgeFlowBench } = require('./canvasEdgeFlowBench.cjs')
const { dispatch, releasePointer } = require('./canvasPanInput.cjs')
const { captureInspectionPage } = require('./uiInspectionCapture.cjs')

/** 正式 Electron 中拖动真实媒体/参数节点；不提交生成请求，不操作用户工程。 */
function createNodeDragPerformanceScene(context) {
  if (!process.env.DRAG_BENCH_IMAGE) return null
  return {
    id: 'canvas-node-drag-performance', surface: '画布',
    name: '画布-节点拖动性能', writesUserData: true,
    async setup(page, app) {
      const { projectId } = await context.seedAndOpenCanvasPanoramaProject(page)
      // 导入隔离 profile 的正式媒体目录，不能绕过媒体协议直接访问仓库文件。
      const imagePath = process.env.DRAG_BENCH_IMAGE
      if (!imagePath) throw new Error('节点拖动性能场景需要 DRAG_BENCH_IMAGE 指向本地真实 JPG 图片')
      const imageBytes = [...await readFile(imagePath)]
      const image = await page.evaluate(bytes => window.henjiNative.image.persistImageBinary(new Uint8Array(bytes), 'jpg'), imageBytes)
      await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
      await page.locator(`[data-project-id="${projectId}"]:visible`).waitFor()
      await page.evaluate(async ({ projectId, image }) => {
        const nodes = [{ id: 'drag-source', type: 'uploadNode', position: { x: 60, y: 120 },
          style: { width: 180, height: 260 }, data: { imageUrl: image, aspectRatio: '9:13', displayName: '拖动参考图' } },
        { id: 'drag-generator', type: 'imageNode', position: { x: 400, y: 120 },
          style: { width: 340, height: 380 }, data: { prompt: '保留人物与构图', aspectRatio: 'auto' } },
        { id: 'drag-result', type: 'exportImageNode', position: { x: 960, y: 120 },
          style: { width: 180, height: 260 }, data: { imageUrl: null, aspectRatio: '9:13', isGenerating: false, displayName: '等待结果' } }]
        for (let i = 0; i < 30; i++) nodes.push({ id: `drag-neighbor-${i}`, type: 'uploadNode',
          position: { x: 60 + (i % 10) * 260, y: 650 + Math.floor(i / 10) * 360 },
          style: { width: 180, height: 260 }, data: { imageUrl: image, aspectRatio: '9:13' } })
        const edges = [{ id: 'drag-input', source: 'drag-source', target: 'drag-generator', sourceHandle: 'source', targetHandle: 'param:__image', type: 'disconnectableEdge' },
          { id: 'drag-output', source: 'drag-generator', target: 'drag-result', sourceHandle: 'source', targetHandle: 'target', type: 'disconnectableEdge' }]
        await window.henjiNative.db.execute(
          'UPDATE storyboard_projects SET node_count = ?, nodes_json = ?, edges_json = ?, viewport_json = ?, history_json = ? WHERE id = ?',
          [nodes.length, JSON.stringify(nodes), JSON.stringify(edges), JSON.stringify({ x: 40, y: 30, zoom: 0.7 }), JSON.stringify({ past: [], future: [], imagePool: [] }), projectId])
      }, { projectId, image })
      await page.locator(`[data-project-id="${projectId}"]:visible`).click()
      await page.locator('.react-flow__edge[data-id="drag-output"] .react-flow__edge-path').waitFor()
      await page.waitForFunction(() => {
        const image = document.querySelector('.react-flow__node[data-id="drag-source"] img')
        return image?.complete && image.naturalWidth > 0
      })
      await installEdgeFlowBench(page, process.cwd(), { sourceRevision: process.env.DRAG_BENCH_SOURCE_REF })
      await page.evaluate(() => {
        const edge = document.querySelector('.react-flow__edge[data-id="drag-output"] .react-flow__edge-path')
        const anchor = document.createElement('div')
        document.querySelector('.react-flow__edgelabel-renderer').appendChild(anchor)
        let registration = window.__edgeFlowRuntime.mountEdgeFlowPulse(anchor, edge.getAttribute('d'))
        const observer = new MutationObserver(() => {
          const next = edge.getAttribute('d')
          if (registration.update) registration.update(next)
          else { registration(); registration = window.__edgeFlowRuntime.mountEdgeFlowPulse(anchor, next) }
        })
        observer.observe(edge, { attributes: true, attributeFilter: ['d'] })
        window.__nodeDragFlowCleanup = () => { observer.disconnect(); registration(); anchor.remove() }
      })
      await page.waitForTimeout(700)
      const session = await page.context().newCDPSession(page)
      await session.send('Performance.enable')
      const runs = []
      try {
        // 交替两个节点、左右单向拖动，避免输入驱动等待每帧而人为限速。
        for (let round = 0; round < 6; round++) {
          const nodeId = round % 2 ? 'drag-generator' : 'drag-source'
          const direction = Math.floor(round / 2) % 2 ? -1 : 1
          const node = page.locator(`.react-flow__node[data-id="${nodeId}"]`)
          const start = await node.evaluate(element => {
            const box = element.getBoundingClientRect()
            for (const dy of [3, 6, 10, 20]) {
              const x = box.left + box.width / 2, y = box.top + dy
              const hit = document.elementFromPoint(x, y)
              if (hit?.closest('.react-flow__node') === element && !hit.closest('.nodrag')) return { x, y }
            }
            throw new Error('没有找到节点真实拖动命中区域')
          })
          const beforeBox = await node.boundingBox()
          await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...start, buttons: 0 })
          await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, button: 'left', buttons: 1, clickCount: 1 })
          await page.evaluate(() => {
            const state = { intervals: [], last: 0, raf: 0, replacements: 0 }
            const tick = time => { if (state.last) state.intervals.push(time - state.last); state.last = time; state.raf = requestAnimationFrame(tick) }
            state.raf = requestAnimationFrame(tick)
            state.observer = new MutationObserver(records => {
              for (const record of records) for (const element of record.addedNodes) {
                if (element.nodeType === 1 && element.classList.contains('canvas-edge-flow-layer')) state.replacements++
              }
            })
            state.observer.observe(document.querySelector('.react-flow__pane'), { childList: true })
            window.__nodeDragSample = state
          })
          const before = await session.send('Performance.getMetrics')
          const begin = performance.now()
          const duration = 1000
          const distance = 140 * direction
          while (performance.now() - begin < duration) {
            dispatch(session, { type: 'mouseMoved', x: start.x + distance * Math.min(1, (performance.now() - begin) / duration), y: start.y, button: 'left', buttons: 1 })
            await new Promise(resolve => setTimeout(resolve, 8))
          }
          await releasePointer(session, { x: start.x + distance, y: start.y })
          const after = await session.send('Performance.getMetrics')
          const sample = await page.evaluate(() => {
            const state = window.__nodeDragSample
            cancelAnimationFrame(state.raf); state.observer.disconnect(); delete window.__nodeDragSample
            const sorted = state.intervals.sort((a, b) => a - b)
            return { frames: sorted.length, p95Ms: sorted[Math.floor(sorted.length * 0.95)],
              meanMs: sorted.reduce((sum, value) => sum + value, 0) / sorted.length, canvasReplacements: state.replacements }
          })
          const delta = name => (after.metrics.find(m => m.name === name).value - before.metrics.find(m => m.name === name).value) * 1000
          const afterBox = await node.boundingBox()
          if (Math.abs(afterBox.x - beforeBox.x - distance) > 6 || Math.abs(afterBox.y - beforeBox.y) > 3) {
            throw new Error(`节点拖动距离异常：${JSON.stringify({ beforeBox, afterBox, distance })}`)
          }
          if (!sample.frames) throw new Error('拖动采样没有有效帧')
          runs.push({ nodeId, round, ...sample, taskMs: delta('TaskDuration'), scriptMs: delta('ScriptDuration'), layoutMs: delta('LayoutDuration') })
          await page.waitForTimeout(250)
        }
        if (process.env.DRAG_BENCH_BASELINE !== '1' && runs.some(run => run.canvasReplacements > 0)) throw new Error('拖动端点重建了动画画布')
        const report = { nodeCount: 33, edgeCount: 2, zoom: 0.7, runs }
        const suffix = process.env.DRAG_BENCH_BASELINE === '1' ? 'before' : 'after'
        await writeFile(`.ui-tour/node-drag-${suffix}.json`, JSON.stringify(report, null, 2))
        await writeFile(`.ui-tour/node-drag-${suffix}.png`, await captureInspectionPage(app, page))
        console.log('[node-drag-performance]', JSON.stringify(report))
      } finally { await page.evaluate(() => { window.__nodeDragFlowCleanup?.(); delete window.__nodeDragFlowCleanup }); await session.detach() }
    },
  }
}
module.exports = { createNodeDragPerformanceScene }
