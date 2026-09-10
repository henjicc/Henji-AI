'use strict'

const path = require('node:path')
const { build } = require('esbuild')

// 复用正式动画入口；只合成“这些现有连线正在运行”的视觉负载，不启动付费生成任务。
async function installEdgeFlowBench(page, root) {
  const bundle = await build({
    entryPoints: [path.join(root, 'src/features/canvas/edges/edgeFlowAnimation.ts')],
    bundle: true, write: false, format: 'iife', globalName: '__edgeFlowRuntime', platform: 'browser',
  })
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
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
      edge.style.stroke = 'rgb(var(--accent-rgb) / 0.94)'
      edge.style.strokeWidth = '2.2'
      cleanups.push(() => oldStyle === null ? edge.removeAttribute('style') : edge.setAttribute('style', oldStyle))
      if (nextMode === 'flow-pulse') {
        const bounds = document.createElement('div')
        bounds.dataset.edgeFlow = edge.id
        bounds.setAttribute('aria-hidden', 'true')
        labelLayer.appendChild(bounds)
        const dispose = window.__edgeFlowRuntime.mountEdgeFlowPulse(bounds, edge.getAttribute('d'))
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
      runningCount: flows.filter((flow) => flow.getAnimations({ subtree: true }).some((animation) => animation.playState === 'running')).length,
      legacyCount: document.querySelectorAll('.bench-legacy-edge-flow').length,
    }
  })
}

module.exports = { installEdgeFlowBench, applyEdgeFlowBench, readEdgeFlowBench }

async function verifyEdgeFlowBench(page, session) {
  const geometry = await page.evaluate(async () => {
    const bounds = Array.from(document.querySelectorAll('[data-edge-flow]')).find((element) => {
      const rect = element.getBoundingClientRect()
      return rect.right > 0 && rect.left < innerWidth && rect.bottom > 0 && rect.top < innerHeight
        && element.getAnimations({ subtree: true }).some((animation) => animation.playState === 'running')
    })
    if (!bounds) throw new Error('没有可见且正在播放的正式光点')
    const pulse = bounds.firstElementChild
    const edge = document.getElementById(bounds.dataset.edgeFlow)
    const animation = pulse.getAnimations()[0]
    const duration = animation.effect.getTiming().duration
    const initialTime = animation.currentTime
    animation.pause()
    await animation.ready
    animation.currentTime = duration * 0.37
    const point = edge.getPointAtLength(edge.getTotalLength() * 0.37).matrixTransform(edge.getScreenCTM())
    const rect = pulse.getBoundingClientRect()
    const errorPx = Math.hypot(rect.x + rect.width / 2 - point.x, rect.y + rect.height / 2 - point.y)
    if (errorPx > 2) throw new Error(`光点偏离连线 ${errorPx}px`)
    animation.currentTime = initialTime
    animation.play()
    const wrapper = document.querySelector('.canvas-lod-low') || document.querySelector('.react-flow').parentElement
    wrapper.classList.add('canvas-viewport-moving')
    const before = animation.currentTime
    await new Promise((resolve) => setTimeout(resolve, 150))
    const advancedDuringPanMs = animation.currentTime - before
    wrapper.classList.remove('canvas-viewport-moving')
    if (advancedDuringPanMs < 50) throw new Error('平移状态下光点意外暂停')
    pulse.dataset.flowCompositorProbe = 'true'
    return { errorPx, advancedDuringPanMs }
  })
  let layers = []
  const collect = (event) => { if (event.layers?.length) layers = event.layers }
  session.on('LayerTree.layerTreeDidChange', collect)
  // 基准可能已启用 LayerTree；重新订阅必须请求一份完整树，而非等待下一次树变更。
  await session.send('LayerTree.disable')
  await session.send('LayerTree.enable')
  await page.waitForTimeout(700)
  const { root } = await session.send('DOM.getDocument')
  const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector: '[data-flow-compositor-probe]' })
  const { node } = await session.send('DOM.describeNode', { nodeId })
  const layer = layers.find((item) => item.backendNodeId === node.backendNodeId)
  const reasons = layer ? await session.send('LayerTree.compositingReasons', { layerId: layer.layerId }) : null
  session.off('LayerTree.layerTreeDidChange', collect)
  if (!reasons?.compositingReasons?.some((reason) => /active accelerated.*(transform|opacity)/i.test(reason))) {
    throw new Error(`光点未验证为合成动画：${JSON.stringify({ backendNodeId: node.backendNodeId, layers, reasons })}`)
  }
  return { ...geometry, compositor: reasons }
}
module.exports.verifyEdgeFlowBench = verifyEdgeFlowBench
