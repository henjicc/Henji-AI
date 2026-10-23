const assert = require('node:assert/strict')
const { test } = require('node:test')
const { readAllMedia, assignIsolatedMcpPort } = require('./uiInspectionMcpClient.cjs')

test('隔离场景使用空闲端口，不接管另一个应用的默认监听', async () => {
  const net = require('node:net'), occupied = net.createServer()
  await new Promise(resolve => occupied.listen(0, '127.0.0.1', resolve))
  try {
    let configured
    const port = await assignIsolatedMcpPort({ evaluate: async (_fn, input) => { configured = input } })
    assert.equal(configured, port); assert.notEqual(port, occupied.address().port)
    const reuse = net.createServer(); await new Promise(resolve => reuse.listen(port, '127.0.0.1', resolve)); await new Promise(resolve => reuse.close(resolve))
  } finally { await new Promise(resolve => occupied.close(resolve)) }
})

test('完整字节读取显式选择chunk模式，图片默认附件不能替代分块字节', async () => {
  const original = Buffer.from('一张图片的完整二进制数据'); const calls = []
  const ref = { kind: 'asset', id: 'image' }
  const client = { callTool: async request => {
    calls.push(request)
    const { mode, offset, length } = request.arguments
    if (mode !== 'chunk') return { isError: false, structuredContent: { ok: true, data: { mode: 'image', mimeType: 'image/png' } }, content: [{ type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' }] }
    const bytes = original.subarray(offset, offset + length)
    return { isError: false, structuredContent: { ok: true, data: { mode: 'chunk', mimeType: 'image/png', offset, byteLength: bytes.length, totalBytes: original.length, base64: bytes.toString('base64'), eof: offset + bytes.length === original.length } } }
  } }
  const result = await readAllMedia(client, ref, { chunkBytes: 7 })
  assert.deepEqual(result.bytes, original); assert.equal(result.totalBytes, original.length)
  assert.equal(result.mimeType, 'image/png'); assert.ok(calls.length > 1)
  assert.ok(calls.every(call => call.name === 'read_application_media' && call.arguments.mode === 'chunk' && call.arguments.ref === ref))
})
test('字节模式缺少base64时点名契约，不以空数据冒充完整图片', async () => {
  const client = { callTool: async () => ({ isError: false, structuredContent: { ok: true, data: { mode: 'image', mimeType: 'image/png' } } }) }
  await assert.rejects(readAllMedia(client, { kind: 'asset', id: 'image' }), /base64/)
})
