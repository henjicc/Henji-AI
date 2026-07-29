'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  planSweepViewport,
  resolveNodeCenters,
  scoreSweepPath,
} = require('./canvasPanViewport.cjs')

test('子节点使用叠加父节点后的绝对坐标', () => {
  const centers = resolveNodeCenters([
    { id: 'parent', position: { x: 1000, y: 500 }, width: 200, height: 100 },
    { id: 'child', parentId: 'parent', position: { x: 50, y: 20 }, width: 100, height: 60 },
  ])
  assert.deepEqual(centers, [
    { x: 1100, y: 550 },
    { x: 1100, y: 550 },
  ])
})

test('路径评分采用整段扫掠中的最低可见节点数', () => {
  const score = scoreSweepPath(
    [{ x: 20, y: 50 }, { x: 120, y: 50 }, { x: 220, y: 50 }],
    { startFlowX: 0, centerY: 50, flowWidth: 100, flowHeight: 100, sweepFlowDistance: 200 },
  )
  assert.equal(score.min, 1)
  assert.ok(score.average >= 1)
})

test('扫掠规划优先选择整段都有内容的密集路径', () => {
  const nodes = Array.from({ length: 12 }, (_, index) => ({
    id: `dense-${index}`,
    position: { x: index * 80, y: 500 },
    width: 40,
    height: 40,
  })).concat([
    { id: 'isolated', position: { x: 0, y: 0 }, width: 40, height: 40 },
  ])
  const plan = planSweepViewport(nodes, {
    innerWidth: 320,
    innerHeight: 240,
    zoom: 1,
    sweepScreenDistance: 320,
  })
  assert.ok(plan.pathMinVisibleNodeCount >= 3)
  assert.ok(plan.y < 0)
})
