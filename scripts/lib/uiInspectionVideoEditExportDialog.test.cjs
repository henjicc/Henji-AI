const assert = require('node:assert/strict')
const test = require('node:test')
const vm = require('node:vm')
const { confirmVideoEditExport } = require('./uiInspectionVideoEditExportDialog.cjs')

test('onOpen等待弹窗面板与遮罩淡入结束；不等待预览内部的持续动画', async () => {
  let frame = 0; let opened = false
  const finished = new Error('截图完成')
  const surfaces = [{}, {}]
  for (const surface of surfaces) surface.getAnimations = () => [{ playState: frame < 4 ? 'running' : 'finished' }]
  const dialog = { waitFor: async () => {}, evaluate: async callback => vm.runInNewContext(`(${callback})`, {
    getComputedStyle: () => ({ opacity: frame < 3 ? String(frame / 3) : '1' }),
    requestAnimationFrame: callback => { frame++; callback() }, performance: { now: () => frame * 16 },
  })({ children: surfaces, getAnimations: () => [{ playState: 'running' }] }) }
  const page = { getByRole: role => role === 'dialog' ? dialog : { click: async () => {} } }
  await assert.rejects(confirmVideoEditExport(page, async actual => { opened = true; assert.equal(actual, dialog); assert.equal(frame, 4); throw finished }), error => error === finished)
  assert.equal(opened, true)
})
test('淡入未结束时超时失败，不截取动画中途画面', async () => {
  let frame = 0; let opened = false
  const dialog = { waitFor: async () => {}, evaluate: async callback => vm.runInNewContext(`(${callback})`, {
    getComputedStyle: () => ({ opacity: '0.5' }), requestAnimationFrame: callback => { frame++; callback() }, performance: { now: () => frame * 1000 },
  })({ children: [{ getAnimations: () => [] }] }) }
  const page = { getByRole: role => role === 'dialog' ? dialog : { click: async () => {} } }
  await assert.rejects(confirmVideoEditExport(page, async () => { opened = true }), /导出弹窗淡入未完成/)
  assert.equal(opened, false)
})
