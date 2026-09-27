const { test } = require('node:test')
const assert = require('node:assert/strict')
const { withUnthrottledBenchmark } = require('./withUnthrottledBenchmark.cjs')

for (const previous of [true, false]) {
  for (const failure of [false, true]) {
    test(`基准${failure ? '失败' : '成功'}后恢复节流=${previous}并释放窗口句柄`, async () => {
      let throttling = previous
      let disposed = false
      const window = { webContents: {
        getBackgroundThrottling: () => throttling,
        setBackgroundThrottling: value => { throttling = value },
      } }
      const page = {}
      const context = {}
      const error = new Error('场景失败')
      const app = { browserWindow: async value => {
        assert.equal(value, page)
        return { evaluate: async (callback, value) => callback(window, value), dispose: async () => { disposed = true } }
      } }
      const run = withUnthrottledBenchmark(async (actualPage, actualApp, actualContext) => {
        assert.equal(actualPage, page)
        assert.equal(actualApp, app)
        assert.equal(actualContext, context)
        assert.equal(throttling, false)
        if (failure) throw error
        return 42
      })
      if (failure) await assert.rejects(run(page, app, context), value => value === error)
      else assert.equal(await run(page, app, context), 42)
      assert.equal(throttling, previous)
      assert.equal(disposed, true)
    })
  }
}
