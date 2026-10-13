const { test } = require('node:test')
const assert = require('node:assert/strict')
const { summarize } = require('./uiInspectionSceneVideoEditFirstFrame.cjs')
const { authorizeMcpConnection } = require('./uiInspectionMcpClient.cjs')
test('巡检读取正式连接说明内的 JSON 配置，不把整段说明当 JSON', async () => {
  const previous = global.window
  global.window = { henjiNative: { mcp: {
    status: async () => ({ enabled: true, ready: true }),
    authorize: async input => ({ id: 'fixture', ...input }),
    connectionConfig: async () => '连接说明\n```json\n{"mcpServers":{"henji":{"type":"http","url":"http://127.0.0.1:3000/mcp"}}}\n```',
  } } }
  try {
    const identity = await authorizeMcpConnection({ evaluate: (fn, input) => fn(input) }, { name: 'fixture', allowWrites: true })
    assert.equal(identity.allowWrites, true)
    assert.equal(identity.config.url, 'http://127.0.0.1:3000/mcp')
  } finally { global.window = previous }
})
test('cold open is excluded from warm median; switching keeps all three samples', () => {
  const run = (reason, elapsedMs) => ({ reason, first: { elapsedMs }, window: { longTaskMaxMs: 60 } })
  const result = summarize([run('open', 2000), run('open', 200), run('open', 400), run('open', 300), run('switch', 50), run('switch', 20), run('switch', 80)])
  assert.equal(result.open.cold.first.elapsedMs, 2000)
  assert.equal(result.open.medianMs, 300)
  assert.equal(result.open.samples, 3)
  assert.equal(result.switch.medianMs, 50)
  assert.equal(result.switch.samples, 3)
})
