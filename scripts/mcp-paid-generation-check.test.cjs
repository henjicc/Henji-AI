const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')
const ts = require('typescript')

// 只执行正式脚本的 page.evaluate 回调；不加载或启动 Electron，不读取用户资料、不发请求。
const source = ts.createSourceFile('check.cjs', fs.readFileSync(path.join(__dirname, 'mcp-paid-generation-check.cjs'), 'utf8'), ts.ScriptTarget.Latest, true)
const callbacks = []
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(source) === 'page.evaluate') {
    const callback = node.arguments[0]
    if (callback?.getText(source).includes('window.henjiNative.ai.generate(')) callbacks.push(callback.getText(source))
  }
  ts.forEachChild(node, visit)
}
visit(source)
assert.equal(callbacks.length, 1, '必须覆盖唯一的生成提交重放回调')
async function replay(generate) {
  const callback = vm.runInNewContext(`(${callbacks[0]})`, { window: { henjiNative: { ai: { generate } } } })
  return JSON.parse(JSON.stringify(await callback({ id: 'request', modelId: 'test', prompt: 'test', params: {} })))
}

test('成功信封读取 data 中的提交身份与状态', async () => {
  assert.deepEqual(await replay(async input => {
    assert.equal(input.requestId, 'request')
    return { ok: true, data: { taskId: 'task', status: 'completed' } }
  }), { outcome: 'receipt', taskId: 'task', status: 'completed' })
})
test('失败信封记录拒绝和计费事实，不伪造成功回执', async () => {
  assert.deepEqual(await replay(async () => ({ ok: false, error: { message: '未提交', paidFailureFacts: { billing: 'not_charged' } } })),
    { outcome: 'refused', message: '未提交', paidFailureFacts: { billing: 'not_charged' } })
})
test('传输异常保留拒绝语义', async () => {
  assert.deepEqual(await replay(async () => { throw new Error('IPC disconnected') }), { outcome: 'refused', message: 'IPC disconnected' })
})
