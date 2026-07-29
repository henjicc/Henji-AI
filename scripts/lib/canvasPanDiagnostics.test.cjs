'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  diffMetrics,
  diffTargetListeners,
  layerCounts,
  metricMap,
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
