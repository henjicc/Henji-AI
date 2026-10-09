const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const { scanContract } = require('./check-ipc-contract.cjs')

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-ipc-'))
  fs.cpSync(path.join(__dirname, '__fixtures__/ipc-contract'), root, { recursive: true })
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}
test('字面量、导入常量别名、映射、事件与端口分表对账', t => {
  const result = scanContract(fixture(t))
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.tables.invokes, ['fixture:read'])
  assert.deepEqual(result.tables.messages, ['fixture:port'])
  assert.deepEqual(result.tables.subscriptions, ['fixture:changed'])
})
test('新增没有 preload 消费的 handler 失败', t => {
  const root = fixture(t)
  fs.appendFileSync(path.join(root, 'electron/main/ipc/registry.ts'), "\nregisterIpcHandler('fixture:orphan')\n")
  assert.ok(scanContract(root).errors.includes('请求未消费: fixture:orphan'))
})
test('preload 调用未注册通道失败', t => {
  const root = fixture(t)
  fs.appendFileSync(path.join(root, 'electron/preload/index.ts'), "\nnativeInvoke('fixture:missing')\n")
  assert.ok(scanContract(root).errors.includes('请求未注册: fixture:missing'))
})
test('动态未解析的端点不能静默漏过，事件与请求不混为消费', t => {
  const root = fixture(t)
  fs.appendFileSync(path.join(root, 'electron/preload/index.ts'), "\nnativeInvoke(getChannel())\nipcRenderer.on('fixture:read', () => undefined)\n")
  const errors = scanContract(root).errors
  assert.ok(errors.some(error => error.startsWith('无法解析 IPC 通道:')))
  assert.ok(errors.includes('事件未发送: fixture:read'))
})
