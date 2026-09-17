/**
 * MCP 场景共用的客户端夹具。
 *
 * 只有一份连接、握手与调用封装：场景各自再写一遍，迟早会在某个场景里把 `isError` 忘掉，
 * 变成"调用失败也算通过"。授权路径有意留两条——走设置界面的那条是界面本身的证据，
 * 走 `mcp.authorize` 的那条给不关心界面的领域场景省时间，两者都经正式可信 IPC。
 */
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { Client } = require('@modelcontextprotocol/client')
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/client')

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
  const client = new Client({ name, version: '1' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } })
  await client.connect(new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers } }))
  return client
}

/**
 * 收尾：撤销本轮全部连接，再关掉对外服务。
 *
 * 撤销不是可选项。场景各自新建授权却没人收，跨窗口尺寸重跑时会一直堆积——第二个尺寸里
 * 「复制连接配置」按钮涨到 9 个，按名字定位的严格匹配当场失败，而失败现场看起来
 * 跟被测功能毫无关系。隔离资料目录里，场景本来就不该留下任何连接。
 */
async function disableMcp(page) {
  await page.evaluate(async () => {
    const state = await window.henjiNative.mcp.status()
    for (const connection of state.connections ?? []) {
      await window.henjiNative.mcp.revoke({ id: connection.id })
    }
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

/**
 * 分块读回媒体并拼成完整字节。**这一份是唯一实现，调用方不要再抄。**
 *
 * `read_application_media` 的结果和其他能力一样包在 `{ ok, data }` 里，块字段在 `data` 上。
 * 付费闭环脚本曾经各写一份，重构把结果投影收敛到 `data` 之后只改了场景那份，
 * 于是付费脚本从此每次都在 `Buffer.from(undefined)` 上崩掉——而它平时不跑，
 * 没人发现。两个调用方合到这里，形状再变就只会有一处要改。
 */
async function readAllMedia(client, ref, { chunkBytes = 4096, maxChunks = 4096 } = {}) {
  const chunks = []
  let offset = 0
  let mimeType = null
  let totalBytes = 0
  // 刻意用远小于 256 KiB 的块，逼出 offset/eof 续读协议本身；一次读完证明不了分块。
  for (let guard = 0; guard < maxChunks; guard += 1) {
    const chunk = (await callTool(client, 'read_application_media', { ref, offset, length: chunkBytes })).data
    mimeType = chunk.mimeType
    totalBytes = chunk.totalBytes
    const bytes = Buffer.from(chunk.base64, 'base64')
    chunks.push(bytes)
    assert.equal(chunk.offset, offset, `分块起点与请求不一致：${JSON.stringify({ ...chunk, base64: undefined })}`)
    assert.equal(chunk.byteLength, bytes.length, '声明长度与实际字节数不一致')
    offset += chunk.byteLength
    if (chunk.eof) return { bytes: Buffer.concat(chunks), mimeType, totalBytes }
    assert.ok(chunk.byteLength > 0, '未到 eof 却返回空块，续读会死循环')
  }
  throw new Error('分块读取没有在限定次数内到达 eof')
}

function operationEnvelope(baselines, extra = {}) {
  return { operationId: randomUUID(), baselineIds: baselines.map((item) => item.baselineId), ...extra }
}

module.exports = { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, expectToolRefusal, operationEnvelope, readAllMedia, waitMcpReady }
