const { test } = require('node:test')
const assert = require('node:assert/strict')
const { summarize } = require('./uiInspectionSceneVideoEditFirstFrame.cjs')
const { authorizeMcpConnection } = require('./uiInspectionMcpClient.cjs')
test('巡检读取正式客户端 JSON 配置', async () => {
  const previous = global.window
  global.window = { henjiNative: { mcp: {
    status: async () => ({ enabled: true, ready: true }),
    authorize: async input => ({ id: 'fixture', ...input }),
    connectionConfig: async () => '{"mcpServers":{"henji":{"type":"http","url":"http://127.0.0.1:3000/mcp","headers":{"Authorization":"Bearer fixture"}}}}',
  } } }
  try {
    const identity = await authorizeMcpConnection({ evaluate: (fn, input) => fn(input) }, { name: 'fixture' })
    assert.equal(identity.config.url, 'http://127.0.0.1:3000/mcp')
  } finally { global.window = previous }
})
test('cold open is excluded from warm median; switching keeps all three samples', () => {
  const run = (reason, elapsedMs) => ({ reason, first: { elapsedMs }, window: { longTaskMaxMs: 60 } })
  const result = summarize([run('open', 2000), run('open', 200), run('open', 400), run('open', 300), run('switch', 50), run('switch', 20), run('switch', 80), run('switch-many', 400), run('switch-many', 300), run('switch-many', 500)])
  assert.equal(result.open.cold.first.elapsedMs, 2000)
  assert.equal(result.open.medianMs, 300)
  assert.equal(result.open.samples, 3)
  assert.equal(result.switch.medianMs, 50)
  assert.equal(result.switch.samples, 3)
  assert.equal(result['switch-many'].medianMs, 400)
  assert.equal(result['switch-many'].samples, 3)
})


test('起播汇总按四条路径分别取中位数，重复回到同一播放头的慢样本不能被剔除', () => {
  const { summarizePlayStart } = require('./uiInspectionSceneVideoEditPlayStart.cjs')
  const rows = (rest, delay, values) => values.map(pressToMoveMs => ({ afterDrag: { rest, delay }, pressToMoveMs }))
  assert.deepEqual(summarizePlayStart({ runs: [100, 80, 90].map(pressToMoveMs => ({ pressToMoveMs })), afterDrag: [...rows(0, 0, [250, 330, 310]), ...rows(0, 150, [140, 120, 130]), ...rows(200, 0, [170, 150, 160])] }), { settled: 90, 'drag-0-0': 310, 'drag-0-150': 130, 'drag-200-0': 160 })
})


test('独立进程冷打开采样不伪造热打开和切换中位数', () => {
  const cold = { reason: 'open', first: { elapsedMs: 900 }, window: { longTaskMaxMs: 100 } }
  const result = summarize([cold])
  assert.equal(result.open.cold, cold)
  assert.equal(result.open.samples, 0)
  assert.equal(result.open.medianMs, undefined)
  assert.equal(result.switch, undefined)
})
