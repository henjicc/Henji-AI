const assert = require('node:assert/strict')

/** Windows 最大化窗口外框超出工作区的不可见缩放边上限（DIP）；系统缩放 100%–200% 下为 7–9。 */
const WINDOWS_MAX_FRAME_INSET_DIP = 10

/** 最大化窗口外框相对工作区四边各向外多出的量（正数 = 超出工作区）。 */
function maximizedFrameInsets(bounds, workArea) {
  return {
    left: workArea.x - bounds.x,
    top: workArea.y - bounds.y,
    right: bounds.x + bounds.width - (workArea.x + workArea.width),
    bottom: bounds.y + bounds.height - (workArea.y + workArea.height),
  }
}

/**
 * 窗口首次展开与再次恢复。
 *
 * - 普通恢复（全套巡检里）：最小化再恢复，位置尺寸不变、期间不二次移动。
 * - 首次展开（只选中本场景时，`--background` 启动）：后台启动先最大化再最小化（64c15d8f），
 *   所以最小化时读到的是普通尺寸，恢复后是最大化尺寸——判据是“恢复后已最大化、一步到位、
 *   之后不再移动、不侵入工作区（菜单栏）”，不再要求与最小化时的普通尺寸相等。
 *
 * 最小化超时时先报出全部窗口的状态：1440 整批里出现过“Window minimize timed out”（4.1），
 * 前序场景留下的原生模态对话框、隐藏窗口或主进程阻塞都会在这里直接现形。
 */
async function inspectRestore(electronApp, page, { initial = false } = {}) {
  const handle = await electronApp.browserWindow(page)
  const windowId = await handle.evaluate((win) => win.id)
  const result = await electronApp.evaluate(async ({ app, BrowserWindow, screen }, { id, initial: firstShow }) => {
    const win = BrowserWindow.fromId(id)
    const describeWindows = () => BrowserWindow.getAllWindows().map((item) => ({
      id: item.id, title: item.getTitle(), visible: item.isVisible(), minimized: item.isMinimized(),
      maximized: item.isMaximized(), fullScreen: item.isFullScreen(), enabled: item.isEnabled(),
      minimizable: item.isMinimizable(), focused: item.isFocused(), modal: item.isModal(),
      parent: item.getParentWindow()?.id ?? null, alwaysOnTop: item.isAlwaysOnTop(), bounds: item.getBounds(),
    }))
    const measureEventLoopLag = () => new Promise((resolve) => {
      const startedAt = Date.now()
      setTimeout(() => resolve(Date.now() - startedAt), 0)
    })
    const preconditions = { eventLoopLagMs: await measureEventLoopLag(), windows: describeWindows() }
    if (!win.isEnabled()) {
      throw new Error(`主窗口被禁用（前序场景留下了原生模态对话框或模态子窗口），无法验证最小化与恢复：${JSON.stringify(preconditions)}`)
    }
    const before = win.getBounds()
    const wasMinimized = win.isMinimized()
    const workArea = screen.getDisplayMatching(before).workArea
    const moves = []
    const onMove = () => moves.push(win.getBounds())
    const waitFor = (event, action) => new Promise((resolve, reject) => {
      const done = () => { clearTimeout(timer); resolve() }
      const timer = setTimeout(() => {
        win.off(event, done)
        reject(new Error(`Window ${event} timed out：${JSON.stringify({ preconditions, after: describeWindows() })}`))
      }, 5000)
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
      const after = win.getBounds()
      // 首次展开再等一拍：一步到位之后不得再有迟到的移动（79543863 修过的二次跳动）
      if (firstShow) await new Promise((resolve) => setTimeout(resolve, 300))
      return { before, after, settled: win.getBounds(), wasMinimized, isMaximized: win.isMaximized(),
        workArea: screen.getDisplayMatching(after).workArea, initialWorkArea: workArea, moves, preconditions }
    } finally {
      win.off('move', onMove)
    }
  }, { id: windowId, initial })
  console.log('Window restore:', JSON.stringify(result))
  if (initial) {
    assert.equal(result.wasMinimized, true, '启动场景必须从后台最小化窗口开始')
    assert.equal(result.isMaximized, true, `首次从 Dock 展开时必须已经最大化：${JSON.stringify(result)}`)
    assert.deepEqual(result.settled, result.after, `首次展开后窗口又发生了迟到移动：${JSON.stringify(result)}`)
    for (const bounds of result.moves) {
      assert.deepEqual(bounds, result.after, `首次展开期间窗口经过了中间位置（二次移动）：${JSON.stringify(result)}`)
    }
    // 最大化后应恰好铺满工作区。Windows 的无边框 + thickFrame 窗口最大化时，四周各有一圈不可见缩放边
    // （实测 150% 缩放下左上 7、右下 9 DIP），外框因此比工作区大一圈且大致对称；macOS 没有这圈，必须为 0，
    // 否则就是侵入菜单栏（79543863 修过的问题）。
    const insets = maximizedFrameInsets(result.after, result.workArea)
    const maxInset = process.platform === 'win32' ? WINDOWS_MAX_FRAME_INSET_DIP : 0
    assert.ok(Object.values(insets).every((value) => value >= 0 && value <= maxInset)
      && Math.abs(insets.left - insets.right) <= 2 && Math.abs(insets.top - insets.bottom) <= 2,
    `首次展开的最大化窗口没有恰好铺满工作区（或侵入菜单栏）：${JSON.stringify({ insets, maxInset, result })}`)
    assert.ok(result.before.y >= result.initialWorkArea.y, `后台窗口的普通尺寸侵入菜单栏区域：${JSON.stringify(result)}`)
    assert.ok(result.before.x >= result.initialWorkArea.x, '后台窗口的普通尺寸超出工作区左侧')
    return result
  }
  assert.deepEqual(result.after, result.before, '展开后窗口位置/尺寸发生变化')
  for (const bounds of result.moves) assert.deepEqual(bounds, result.before, '展开期间窗口发生二次移动')
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

module.exports = { WINDOWS_MAX_FRAME_INSET_DIP, createWindowStartupScene, inspectRestore, maximizedFrameInsets }
