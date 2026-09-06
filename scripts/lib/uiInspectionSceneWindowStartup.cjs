const assert = require('node:assert/strict')

async function inspectRestore(electronApp, page, { initial = false } = {}) {
  const handle = await electronApp.browserWindow(page)
  const windowId = await handle.evaluate((win) => win.id)
  const result = await electronApp.evaluate(async ({ app, BrowserWindow, screen }, id) => {
    const win = BrowserWindow.fromId(id)
    const before = win.getBounds()
    const wasMinimized = win.isMinimized()
    const workArea = screen.getDisplayMatching(before).workArea
    const moves = []
    const onMove = () => moves.push(win.getBounds())
    const waitFor = (event, action) => new Promise((resolve, reject) => {
      const done = () => { clearTimeout(timer); resolve() }
      const timer = setTimeout(() => { win.off(event, done); reject(new Error(`Window ${event} timed out`)) }, 5000)
      win.once(event, done)
      action()
    })
    if (!wasMinimized) await waitFor('minimize', () => win.minimize())
    win.on('move', onMove)
    try {
      app.focus({ steal: true })
      await waitFor('restore', () => win.restore())
      win.focus()
      await new Promise((resolve) => setTimeout(resolve, 300))
      return { before, after: win.getBounds(), wasMinimized, workArea, moves }
    } finally {
      win.off('move', onMove)
    }
  }, windowId)
  console.log('Window restore:', JSON.stringify(result))
  assert.deepEqual(result.after, result.before, '展开后窗口位置/尺寸发生变化')
  for (const bounds of result.moves) assert.deepEqual(bounds, result.before, '展开期间窗口发生二次移动')
  if (initial) {
    assert.equal(result.wasMinimized, true, '启动场景必须从未显示过的后台窗口开始')
    assert.ok(result.before.y >= result.workArea.y,
      `初始窗口侵入菜单栏区域：${JSON.stringify(result)}`)
    assert.ok(result.before.x >= result.workArea.x, '初始窗口超出工作区左侧')
  }
  return result
}

function createWindowStartupScene() {
  return {
    id: 'window-startup', surface: '窗口', name: '窗口-首次展开与再次恢复',
    launchArgs: ['--background'],
    launchEnv: { HENJI_UI_INSPECTION_ALLOW_OVERSIZE: '0' },
    // 单独选择此场景时检查真正的首次展开；全套巡检仍覆盖普通窗口恢复。
    inspectLaunch: (app, page) => inspectRestore(app, page, { initial: true }),
    setup: (page, app) => inspectRestore(app, page),
  }
}

module.exports = { createWindowStartupScene }
