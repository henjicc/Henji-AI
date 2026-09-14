/**
 * MCP 场景共用的客户端夹具。
 *
 * 只有一份连接、握手与调用封装：场景各自再写一遍，迟早会在某个场景里把 `isError` 忘掉，
 * 变成"调用失败也算通过"。授权路径有意留两条——走设置界面的那条是界面本身的证据，
 * 走 `mcp.authorize` 的那条给不关心界面的领域场景省时间，两者都经正式可信 IPC。
 */
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { Client } = require('@modelcontextprotocol/sdk/client/index.js')
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js')

async function waitMcpReady(page, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await page.evaluate(async () => (await window.henjiNative.mcp.status()).ready)) return
    await page.waitForTimeout(100)
  }
  throw new Error('应用宿主未在限定时间内就绪')
}

/** 直接经可信 IPC 开启服务并授权一条连接；权限档位仍然只能由应用侧决定。 */
async function authorizeMcpConnection(page, { name, allowWrites = false, allowDestructive = false, allowPaid = false }) {
  const identity = await page.evaluate(async (input) => {
    const before = await window.henjiNative.mcp.status()
    if (!before.enabled) await window.henjiNative.mcp.configure({ enabled: true, port: before.port })
    const connection = await window.henjiNative.mcp.authorize(input)
    const raw = await window.henjiNative.mcp.connectionConfig({ id: connection.id })
    return { id: connection.id, allowWrites: connection.allowWrites === true, allowDestructive: connection.allowDestructive === true,
      allowPaid: connection.allowPaid === true, config: JSON.parse(raw).mcpServers.henji }
  }, { name, allowWrites, allowDestructive, allowPaid })
  assert.equal(identity.allowWrites, allowWrites, `连接 ${name} 的修改授权与请求不一致`)
  assert.equal(identity.allowDestructive, allowDestructive, `连接 ${name} 的删除授权与请求不一致`)
  assert.equal(identity.allowPaid, allowPaid, `连接 ${name} 的付费授权与请求不一致`)
  await waitMcpReady(page)
  return identity
}

async function connectMcpClient(config, name = 'Henji Reality') {
  const client = new Client({ name, version: '1' })
  await client.connect(new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers } }))
  return client
}

async function disableMcp(page) {
  await page.evaluate(async () => {
    const state = await window.henjiNative.mcp.status()
    await window.henjiNative.mcp.configure({ enabled: false, port: state.port })
  })
}

/** 成功调用；失败直接把完整结果抛出来，不让 `isError:true` 被当成通过。 */
async function callTool(client, name, args) {
  const result = await client.callTool({ name, arguments: args })
  assert.equal(result.isError, false, `${name} 调用失败：${JSON.stringify(result)}`)
  return result.structuredContent
}

/** 期待被拒绝的调用；返回文本供断言错误码，不要求调用方自己区分抛异常与 isError。 */
async function expectToolRefusal(client, name, args) {
  const result = await client.callTool({ name, arguments: args }).catch((error) => ({ isError: true, content: [{ text: String(error) }] }))
  assert.equal(result.isError, true, `${name} 本应被拒绝，实际成功：${JSON.stringify(result)}`)
  return (result.content ?? []).map((item) => item.text ?? '').join('')
}

function operationEnvelope(baselines, extra = {}) {
  return { operationId: randomUUID(), baselineIds: baselines.map((item) => item.baselineId), ...extra }
}

module.exports = { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, expectToolRefusal, operationEnvelope, waitMcpReady }
