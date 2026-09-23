const assert = require('node:assert/strict')
const test = require('node:test')
const { sweep } = require('./canvasPanBench.cjs')

test('繁忙页面确认采样启动后才发送拖动，读取结果后释放句柄', async () => {
  let samplerReady = false, pressedBeforeReady = false, disposed = false
  const sample = { frames: 3, elapsedMs: 50, intervals: [16, 17, 17],
    startViewport: { x: 40, y: 80, zoom: 0.5 }, endViewport: { x: -460, y: 80, zoom: 0.5 },
    startVisibleNodeCount: 10, endVisibleNodeCount: 10 }
  const page = {
    // 原实现的 evaluate(Promise) 会让输入先发出；保留该路径使回归测试真正变红。
    evaluate: async (_callback, duration) => {
      if (typeof duration !== 'number') return { left: 0, top: 0, right: 1000, bottom: 800 }
      await new Promise(resolve => setTimeout(resolve, 50))
      samplerReady = true
      return sample
    },
    evaluateHandle: async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
      samplerReady = true
      return { evaluate: async () => sample, dispose: async () => { disposed = true } }
    },
  }
  const session = { send: async (_method, params) => {
    if (params.type === 'mousePressed' && !samplerReady) pressedBeforeReady = true
  } }
  const result = await sweep(page, session, { grab: { x: 500, y: 400 }, durationMs: 50, dx: -9, intervalMs: 5 })
  assert.equal(pressedBeforeReady, false)
  assert.equal(result.valid, true)
  assert.equal(result.netMove, 500)
  assert.equal(disposed, true)
})

test('读取采样失败仍释放页面句柄，不把故障转成有效帧数据', async () => {
  let disposed = false
  const page = {
    evaluate: async () => ({ left: 0, top: 0, right: 1000, bottom: 800 }),
    evaluateHandle: async () => ({
      evaluate: async () => { throw new Error('采样页面已关闭') },
      dispose: async () => { disposed = true },
    }),
  }
  await assert.rejects(sweep(page, { send: async () => {} }, {
    grab: { x: 500, y: 400 }, durationMs: 20, intervalMs: 5,
  }), /采样页面已关闭/)
  assert.equal(disposed, true)
})
