/** 固定专项基准的窗口调度条件；成功或失败后恢复，避免污染后续场景。 */
function withUnthrottledBenchmark(run) {
  return async (page, app, ...args) => {
    const window = await app.browserWindow(page)
    try {
      const previous = await window.evaluate(win => win.webContents.getBackgroundThrottling())
      try {
        await window.evaluate(win => win.webContents.setBackgroundThrottling(false))
        return await run(page, app, ...args)
      } finally {
        await window.evaluate((win, value) => win.webContents.setBackgroundThrottling(value), previous)
      }
    } finally {
      await window.dispose()
    }
  }
}

module.exports = { withUnthrottledBenchmark }
