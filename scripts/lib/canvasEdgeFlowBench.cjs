'use strict'

const path = require('node:path')
const { build } = require('esbuild')
const { execFileSync } = require('node:child_process')

// 复用正式动画入口；只合成“这些现有连线正在运行”的视觉负载，不启动付费生成任务。
async function installEdgeFlowBench(page, root) {
  const bundle = await build({
    entryPoints: [path.join(root, 'src/features/canvas/edges/edgeFlowAnimation.ts')],
    bundle: true, write: false, format: 'iife', globalName: '__edgeFlowRuntime', platform: 'browser',
  })
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  if ((process.env.BENCH_SET || '').split(',').includes('flow-dot')) {
    // 按需读取已提交的单光点版本作同场对照，不让基准维护一份近似动画。
    const revision = process.env.BENCH_DOT_REF || '71b7eed5'
    const baseline = await build({
      entryPoints: ['edgeFlowAnimation'], bundle: true, write: false, format: 'iife',
      globalName: '__edgeFlowDotRuntime', platform: 'browser',
      plugins: [{ name: 'committed-edge-flow', setup(builder) {
        builder.onResolve({ filter: /^(\.\/)?edgeFlow(Animation|Playback)$/ }, (args) => ({ path: args.path.replace('./', ''), namespace: 'baseline' }))
        builder.onLoad({ filter: /.*/, namespace: 'baseline' }, (args) => ({
          contents: execFileSync('git', ['show', `${revision}:src/features/canvas/edges/${args.path}.ts`], { cwd: root, encoding: 'utf8' }), loader: 'ts',
        }))
      } }],
    })
    await page.addScriptTag({ content: baseline.outputFiles[0].text })
  }
}

async function applyEdgeFlowBench(page, mode) {
  return page.evaluate((nextMode) => {
    window.__edgeFlowBenchCleanup?.()
    window.__edgeFlowBenchCleanup = null
    if (!nextMode.startsWith('flow-')) return null
    const labelLayer = document.querySelector('.react-flow__edgelabel-renderer')
    if (!labelLayer) throw new Error('缺少正式连线标签层')
    const edges = Array.from(document.querySelectorAll('.react-flow__edge .react-flow__edge-path'))
    if (!edges.length) throw new Error('基准工程没有连线，不能测试流动性能')
    const cleanups = []
    for (const edge of edges) {
      const oldStyle = edge.getAttribute('style')
      edge.style.stroke = nextMode === 'flow-pulse' ? 'rgb(var(--accent-rgb) / 0.25)' : 'rgb(var(--accent-rgb) / 0.94)'
      edge.style.strokeWidth = '2.2'
      cleanups.push(() => oldStyle === null ? edge.removeAttribute('style') : edge.setAttribute('style', oldStyle))
      if (nextMode === 'flow-pulse' || nextMode === 'flow-dot') {
        const bounds = document.createElement('div')
        bounds.dataset.edgeFlow = edge.id
        bounds.setAttribute('aria-hidden', 'true')
        labelLayer.appendChild(bounds)
        const runtime = nextMode === 'flow-dot' ? window.__edgeFlowDotRuntime : window.__edgeFlowRuntime
        const dispose = runtime.mountEdgeFlowPulse(bounds, edge.getAttribute('d'))
        cleanups.push(() => { dispose(); bounds.remove() })
      } else if (nextMode.startsWith('flow-legacy')) {
        const flow = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        for (const [key, value] of Object.entries({
          d: edge.getAttribute('d'), fill: 'none', stroke: 'rgb(var(--accent-rgb) / 1)',
          'stroke-width': '2.1', 'stroke-linecap': 'round', 'stroke-dasharray': '8 10',
          class: 'bench-legacy-edge-flow',
        })) flow.setAttribute(key, value)
        flow.style.pointerEvents = 'none'
        // 保留原版的绘制顺序和手势暂停，不能人为放大旧版成本。
        edge.before(flow)
        cleanups.push(() => flow.remove())
      }
    }
    window.__edgeFlowBenchCleanup = () => cleanups.forEach((dispose) => dispose())
    return { mode: nextMode, edgeCount: edges.length }
  }, mode)
}

async function readEdgeFlowBench(page) {
  return page.evaluate(() => {
    const flows = Array.from(document.querySelectorAll('[data-edge-flow]'))
    return {
      pulseCount: flows.length,
      segmentCount: flows.reduce((count, flow) => count + flow.childElementCount, 0),
      runningCount: flows.filter((flow) => flow.getAnimations({ subtree: true }).some((animation) => animation.playState === 'running')).length,
      legacyCount: document.querySelectorAll('.bench-legacy-edge-flow').length,
      canvas: window.__edgeFlowRuntime.readEdgeFlowDiagnostics(document.querySelector('.react-flow')),
    }
  })
}

module.exports = { installEdgeFlowBench, applyEdgeFlowBench, readEdgeFlowBench }

async function verifyEdgeFlowBench(page) {
  return page.evaluate(async () => {
    const flow = document.querySelector('.react-flow')
    const canvas = flow.querySelector('canvas.canvas-edge-flow-layer')
    if (!canvas || flow.querySelectorAll('canvas.canvas-edge-flow-layer').length !== 1) throw new Error('流动虚线必须共用一个 Canvas')
    const read = () => window.__edgeFlowRuntime.readEdgeFlowDiagnostics(flow)
    const before = read()
    flow.parentElement.classList.add('canvas-viewport-moving')
    await new Promise((resolve) => setTimeout(resolve, 180))
    const after = read()
    flow.parentElement.classList.remove('canvas-viewport-moving')
    if (!after || after.drawCount <= before.drawCount || after.offset === before.offset) throw new Error('平移状态下虚线没有继续流动')
    const actual = new DOMMatrix(flow.querySelector('.react-flow__viewport').style.transform)
    const matrixError = Math.max(Math.abs(after.matrix.x - actual.e), Math.abs(after.matrix.y - actual.f), Math.abs(after.matrix.zoom - actual.a))
    if (matrixError > 0.001) throw new Error(`虚线视口不同步：${matrixError}`)
    // 完成计时后才读像素，避免读回造成的 GPU 同步污染性能样本。
    const rect = canvas.getBoundingClientRect()
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    let hits = 0
    for (const anchor of flow.querySelectorAll('[data-edge-flow]')) {
      const edge = document.getElementById(anchor.dataset.edgeFlow)
      const length = edge.getTotalLength()
      for (let i = 1; i < 50; i++) {
        const point = edge.getPointAtLength(length * i / 50).matrixTransform(edge.getScreenCTM())
        const x = Math.round((point.x - rect.x) * canvas.width / rect.width)
        const y = Math.round((point.y - rect.y) * canvas.height / rect.height)
        if (x < 2 || y < 2 || x >= canvas.width - 2 || y >= canvas.height - 2) continue
        if ([-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => pixels[((y + dy) * canvas.width + x + dx) * 4 + 3] > 20))) hits++
      }
    }
    if (hits < 5) throw new Error(`没有在实际连线路径上找到虚线像素：${hits}`)
    return { canvasCount: 1, matrixError, pathPixelHits: hits, drawsDuringPan: after.drawCount - before.drawCount, visiblePaths: after.visibleCount }
  })
}
module.exports.verifyEdgeFlowBench = verifyEdgeFlowBench
