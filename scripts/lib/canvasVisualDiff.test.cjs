'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { passesRasterControl } = require('./canvasVisualDiff.cjs')

const matchingGeometry = {
  nodeBoxesEqual: true,
  minimapRectsEqual: true,
  edgePathsEqual: true,
}

test('逐像素已通过时无需负控制', () => {
  assert.equal(passesRasterControl({ passed: true }), true)
})

test('分数缩放栅格差异显著小于 will-change 负例时接受', () => {
  const candidate = {
    passed: false,
    pixels: { changedPct: 0.38 },
    geometry: matchingGeometry,
  }
  const control = { pixels: { changedPct: 0.63 } }
  assert.equal(passesRasterControl(candidate, control), true)
})

test('几何变化、差异接近负例或负例无效时拒绝', () => {
  const control = { pixels: { changedPct: 0.5 } }
  assert.equal(passesRasterControl({
    passed: false,
    pixels: { changedPct: 0.2 },
    geometry: { ...matchingGeometry, nodeBoxesEqual: false },
  }, control), false)
  assert.equal(passesRasterControl({
    passed: false,
    pixels: { changedPct: 0.4 },
    geometry: matchingGeometry,
  }, control), false)
  assert.equal(passesRasterControl({
    passed: false,
    pixels: { changedPct: 0.1 },
    geometry: matchingGeometry,
  }, { pixels: { changedPct: 0 } }), false)
})
