'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const vm = require('node:vm')
const { findPanePoint } = require('./canvasPanInput.cjs')

test('平移抓取点排除 pane 内会阻止拖动的连线点击区域', async () => {
  const pane = { classList: { contains: (name) => name === 'react-flow__pane' }, closest: () => null }
  const edge = { classList: { contains: () => false }, closest: (selector) => selector === '.react-flow__pane' ? pane : null }
  const page = {
    evaluate: (fn, args) => vm.runInNewContext(`(${fn.toString()})(args)`, {
      args,
      document: {
        querySelector: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0, right: 1000, bottom: 600, width: 1000, height: 600 }) }),
        elementFromPoint: (x) => x === 860 ? edge : pane,
      },
    }),
  }
  const point = await findPanePoint(page)
  assert.equal(point.x, 800)
  assert.equal(point.y, 300)
})
