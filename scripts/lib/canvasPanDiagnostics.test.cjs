'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const vm = require('node:vm')
const {
  diffMetrics,
  diffTargetListeners,
  layerCounts,
  metricMap,
  installPageDiagnostics,
} = require('./canvasPanDiagnostics.cjs')

test('metricMap 只提取画布诊断需要的指标并为缺失值补零', () => {
  const result = metricMap({
    metrics: [
      { name: 'LayoutCount', value: 12 },
      { name: 'JSHeapUsedSize', value: 4096 },
      { name: 'UnrelatedMetric', value: 99 },
    ],
  })

  assert.equal(result.LayoutCount, 12)
  assert.equal(result.JSHeapUsedSize, 4096)
  assert.equal(result.RecalcStyleCount, 0)
  assert.equal('UnrelatedMetric' in result, false)
})

test('diffTargetListeners 按签名多重集找出新增与移除监听器', () => {
  const result = diffTargetListeners(
    { window: ['mousemove:a', 'mousemove:a', 'mouseup:b'] },
    { window: ['mousemove:a', 'mouseup:b', 'click:c'] }
  )

  assert.deepEqual(result.window, {
    before: 3,
    after: 3,
    delta: 0,
    added: ['click:c'],
    removed: ['mousemove:a'],
  })
})

test('diffMetrics 把秒转成毫秒并保留计数与堆差值', () => {
  const before = metricMap({
    metrics: [
      { name: 'LayoutCount', value: 2 },
      { name: 'LayoutDuration', value: 0.01 },
      { name: 'JSHeapUsedSize', value: 1000 },
      { name: 'Nodes', value: 200 },
    ],
  })
  const after = metricMap({
    metrics: [
      { name: 'LayoutCount', value: 5 },
      { name: 'LayoutDuration', value: 0.025 },
      { name: 'JSHeapUsedSize', value: 1800 },
      { name: 'Nodes', value: 205 },
    ],
  })

  const result = diffMetrics(before, after)
  assert.equal(result.layoutCount, 3)
  assert.equal(result.layoutDurationMs, 15)
  assert.equal(result.heapDeltaBytes, 800)
  assert.equal(result.nodesDelta, 5)
})

test('layerCounts 区分总层、绘制层和带 DOM 后端节点的层', () => {
  const result = layerCounts([
    { layerId: '1', drawsContent: true, backendNodeId: 12 },
    { layerId: '2', drawsContent: false },
    { layerId: '3', drawsContent: true },
  ])

  assert.deepEqual(result, {
    layerCount: 3,
    drawsContentCount: 2,
    backendNodeLayerCount: 1,
  })
})

test('CPU 计数区分墙钟、主线程与渲染进程，不按整机核心数稀释占用', () => {
  const metrics = (timestamp, thread, process) => metricMap({ metrics: [
    { name: 'Timestamp', value: timestamp },
    { name: 'ThreadTime', value: thread },
    { name: 'ProcessTime', value: process },
  ] })
  const result = diffMetrics(metrics(100, 5, 20), metrics(102, 6.5, 23))
  assert.equal(result.wallDurationMs, 2000)
  assert.equal(result.rendererMainThreadCpuMs, 1500)
  assert.equal(result.rendererProcessCpuMs, 3000)
  assert.equal(result.rendererMainThreadCpuPercent, 75)
})

test('CPU 计数缺失、非法或重置时标记不可用，不能伪装成空闲', () => {
  const missing = metricMap({ metrics: [] })
  const invalid = metricMap({ metrics: [{ name: 'ThreadTime', value: Number.NaN }] })
  assert.equal(missing.ThreadTime, null)
  assert.equal(invalid.ThreadTime, null)
  for (const result of [
    diffMetrics(missing, missing),
    diffMetrics({ Timestamp: 2, ThreadTime: 5, ProcessTime: 8 }, { Timestamp: 1, ThreadTime: 1, ProcessTime: 2 }),
  ]) {
    assert.equal(result.wallDurationMs, null)
    assert.equal(result.rendererMainThreadCpuMs, null)
    assert.equal(result.rendererProcessCpuMs, null)
    assert.equal(result.rendererMainThreadCpuPercent, null)
  }
  assert.equal(diffMetrics({ Timestamp: 1, ThreadTime: 0 }, { Timestamp: 1, ThreadTime: 0 }).rendererMainThreadCpuPercent, null)
})

test('节点挂载前安装尺寸探针，容器出现后补接监听且重复安装不叠加包装', async () => {
  let canvas = null
  const mutations = []
  class NativeResizeObserver { constructor(callback) { this.callback = callback } }
  class MutationObserver {
    constructor(callback) { this.callback = callback; mutations.push(this) }
    observe(target) { this.target = target }
    disconnect() { this.target = null }
  }
  const window = { ResizeObserver: NativeResizeObserver }
  const context = vm.createContext({ window, MutationObserver, document: {
    querySelector: selector => selector.startsWith('[data-application') ? canvas : null,
  } })
  const page = { evaluate: fn => vm.runInContext(`(${fn.toString()})()`, context) }
  await installPageDiagnostics(page)
  const wrapped = window.ResizeObserver
  let delivered = 0
  const observer = new wrapped(entries => { delivered += entries.length })
  observer.callback([{ target: { closest: () => ({}) } }], observer)
  const state = window.__HENJI_PAN_DIAGNOSTICS__
  assert.equal(delivered, 1)
  assert.equal(state.resizeObserver.nodeEntries, 1)
  assert.equal(mutations.length, 0)
  canvas = {}
  await installPageDiagnostics(page)
  assert.equal(window.ResizeObserver, wrapped)
  assert.equal(mutations.length, 1)
  assert.equal(mutations[0].target, canvas)
  mutations[0].callback([{}, {}])
  assert.equal(state.viewportClassMutations, 2)
  canvas = {}
  state.reset()
  assert.equal(mutations[0].target, null)
  assert.equal(mutations[1].target, canvas)
  assert.equal(state.resizeObserver.nodeEntries, 0)
  assert.equal(state.viewportClassMutations, 0)
})
