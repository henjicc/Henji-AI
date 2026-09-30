const assert = require('node:assert/strict')
const test = require('node:test')
const { assertLayoutRestored } = require('./videoEditLayoutRestart.cjs')

function nonDefaultLayout() {
  return { panels: { program: { id: 'program' }, project: { id: 'project' }, timeline: { id: 'timeline' } },
    grid: { width: 1440, height: 800, orientation: 'HORIZONTAL', root: { type: 'branch', data: [
      { type: 'leaf', size: 520, data: { id: 'program-group', views: ['program'], activeView: 'program' } },
      { type: 'leaf', size: 280, data: { id: 'timeline-group', views: ['timeline'], activeView: 'timeline' } },
    ] } }, activeGroup: 'floating-project',
    floatingGroups: [{ data: { id: 'floating-project', views: ['project'], activeView: 'project' }, position: { left: 120, top: 80, width: 260, height: 400 } }] }
}

test('冷重启恢复允许系统像素舍入，保留面板成员和浮动位置', () => {
  const saved = nonDefaultLayout()
  const restored = structuredClone(saved)
  restored.grid.root.data[0].size += 1
  restored.floatingGroups[0].position.left += 2
  assert.doesNotThrow(() => assertLayoutRestored(saved, restored))
})

test('恢复证据不能用默认布局、重开关闭面板或丢失浮动位置冒充通过', () => {
  const saved = nonDefaultLayout()
  const missingFloat = structuredClone(saved); missingFloat.floatingGroups = []
  const openedEffects = structuredClone(saved); openedEffects.panels.effects = { id: 'effects' }
  const shiftedFloat = structuredClone(saved); shiftedFloat.floatingGroups[0].position.left += 30
  const lostTab = structuredClone(saved); lostTab.grid.root.data[0].data.views = ['timeline']
  for (const restored of [missingFloat, openedEffects, shiftedFloat, lostTab]) {
    assert.throws(() => assertLayoutRestored(saved, restored), /布局/)
  }
})
