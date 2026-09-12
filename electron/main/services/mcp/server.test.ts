// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { request as httpRequest } from 'node:http'
import { randomUUID } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { LocalMcpServer } from './server'
import { McpConnections } from './connections'
import { ApplicationHostBridge } from './applicationHostBridge'
import { EXTERNAL_CONTRACT_VERSION, EXTERNAL_PROTOCOL_VERSIONS, type LocalHostRequest } from '../../../../src/core/application-control/localHostContracts'

const closers: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of closers.reverse()) await close(); closers.length = 0 })
async function fixture(options: { ready?: boolean; pending?: boolean; result?: Record<string, unknown> } = {}) {
  let saved: string | null = null
  let now = Date.now()
  const connections = new McpConnections({ read: () => saved, write: (value) => { saved = value } }, () => now)
  const first = connections.create('客户端甲')
  const second = connections.create('客户端乙')
  const host = new ApplicationHostBridge((id) => connections.assertActive(id))
  const calls: LocalHostRequest[] = []
  const cancellations: string[] = []
  host.register({ sessionId: randomUUID(), generation: 1, ready: options.ready ?? true, tools: [{ id: 'read_application_entity', version: 1, title: '读取', description: '读取实体', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }] }, {
    send: (channel, payload) => {
      if (channel === 'mcp:host:cancel') cancellations.push(payload as string)
      if (channel !== 'mcp:host:request') return
      const request = payload as LocalHostRequest
      calls.push(request)
      if (!options.pending) host.complete({ requestId: request.requestId, sessionId: request.sessionId, result: options.result ?? { ok: true, data: { name: '隔离工程' } } })
    },
  })
  const server = new LocalMcpServer(connections, host)
  await server.start(0)
  closers.push(() => server.stop())
  const url = () => `http://127.0.0.1:${server.listeningPort}/mcp`
  const connect = async (id = first.id) => {
    const transport = new StreamableHTTPClientTransport(new URL(url()), { requestInit: { headers: { Authorization: `Bearer ${connections.token(id)}` } } })
    const client = new Client({ name: '协议验收', version: '1' })
    closers.push(() => client.close())
    await client.connect(transport)
    return { client, transport }
  }
  return { server, connections, first, second, host, calls, cancellations, url, connect, advance: () => { now += 31 * 86400_000 } }
}

describe('本地 MCP 协议与边界', () => {
  it('关闭 MCP 只取消自己的请求，不中断共享宿主的内置调用', async () => {
    const f = await fixture({ pending: true })
    const external = await f.connect()
    const reading = external.client.callTool({ name: 'read_application_entity', arguments: {} }).catch(() => ({ isError: true }))
    await vi.waitFor(() => expect(f.calls).toHaveLength(1))
    const embedded = f.host.execute(f.second.id, 'read_application_entity', {}, new AbortController().signal)
    const embeddedRequest = f.calls[1]
    await f.server.stop()
    expect((await reading).isError).toBe(true)
    expect(f.cancellations).toContain(f.calls[0].requestId)
    expect(f.cancellations).not.toContain(embeddedRequest.requestId)
    f.host.complete({ ...embeddedRequest, result: { ok: true, data: { name: '内置读取继续完成' } } })
    await expect(embedded).resolves.toMatchObject({ ok: true, data: { name: '内置读取继续完成' } })
  })
  it('SDK协商支持的当前与旧协议，返回标准初始化结果', async () => {
    const f = await fixture()
    for (const protocolVersion of ['2025-11-25', '2025-06-18', '2025-03-26']) {
      const response = await fetch(f.url(), { method: 'POST', headers: { Authorization: `Bearer ${f.connections.token(f.first.id)}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion, capabilities: {}, clientInfo: { name: '兼容探针', version: '1' } } }) })
      expect(response.status).toBe(200)
      expect((await response.json() as { result: { protocolVersion: string } }).result.protocolVersion).toBe(protocolVersion)
    }
  })
  it('真实握手、发现、调用；关闭再开启不丢失根宿主', async () => {
    const f = await fixture()
    const a = await f.connect()
    // 只读连接：宿主登记的读取工具 + 服务自带的协议工具；写工具一个都不出现。
    // 按语义断言而不是数量，扩容目录不会误报，权限泄漏仍然必红。
    const readOnlyTools = (await a.client.listTools()).tools
    expect(readOnlyTools.map((tool) => tool.name)).toEqual(expect.arrayContaining(['read_application_entity', 'read_application_media', 'describe_application_contract']))
    expect(readOnlyTools.filter((tool) => tool.annotations?.readOnlyHint !== true)).toEqual([])
    expect((await a.client.callTool({ name: 'read_application_entity', arguments: {} })).structuredContent).toEqual({ ok: true, data: { name: '隔离工程' } })
    expect((await a.client.callTool({ name: 'change_application_entities', arguments: {} })).isError).toBe(true)
    expect(f.calls).toHaveLength(1)
    await a.client.close()
    await f.server.stop()
    await expect(fetch(f.url())).rejects.toThrow()
    await f.server.start(0)
    const b = await f.connect()
    expect((await b.client.listTools()).tools.map((tool) => tool.name)).toEqual(readOnlyTools.map((tool) => tool.name))
    expect((await b.client.callTool({ name: 'read_application_entity', arguments: {} })).isError).toBe(false)
  })
  it('匿名、网页来源、伪造 Host、超大正文均在宿主前拒绝', async () => {
    const f = await fixture()
    const headers = { Authorization: `Bearer ${f.connections.token(f.first.id)}` }
    expect((await fetch(f.url())).status).toBe(401)
    expect((await fetch(f.url(), { headers: { ...headers, Origin: 'http://evil.test' } })).status).toBe(403)
    const badHostStatus = await new Promise<number | undefined>((resolve, reject) => { const request = httpRequest(f.url(), { headers: { ...headers, Host: 'evil.test' } }, (response) => { response.resume(); resolve(response.statusCode) }); request.on('error', reject); request.end() })
    expect(badHostStatus).toBe(403)
    expect((await fetch(f.url(), { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: 'x'.repeat(262145) })).status).toBe(413)
    expect(f.calls).toHaveLength(0)
  })
  it('跨客户端 session 不可借用；撤销和到期立即失效', async () => {
    const f = await fixture()
    const a = await f.connect()
    const stolen = await fetch(f.url(), { method: 'DELETE', headers: { Authorization: `Bearer ${f.connections.token(f.second.id)}`, 'mcp-session-id': a.transport.sessionId! } })
    expect(stolen.status).toBe(404)
    const token = f.connections.token(f.first.id)
    f.connections.revoke(f.first.id)
    await f.server.revoke(f.first.id)
    expect((await fetch(f.url(), { headers: { Authorization: `Bearer ${token}` } })).status).toBe(401)
    const tokenB = f.connections.token(f.second.id)
    f.advance()
    expect((await fetch(f.url(), { headers: { Authorization: `Bearer ${tokenB}` } })).status).toBe(401)
  })
  it('未就绪时拒绝协议握手', async () => {
    const f = await fixture({ ready: false })
    await expect(f.connect()).rejects.toThrow()
    expect(f.calls).toHaveLength(0)
  })
  it('页面重载终止读取，迟到回执不能泄漏结果', async () => {
    const f = await fixture({ pending: true })
    const a = await f.connect()
    const reading = a.client.callTool({ name: 'read_application_entity', arguments: {} })
    await vi.waitFor(() => expect(f.calls.length).toBe(1))
    const original = f.calls[0]
    f.host.disconnect()
    f.host.complete({ ...original, result: { ok: true, data: { private: 'late' } } })
    const result = await reading
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).not.toContain('late')
  })
  it('在途撤销后迟到回执不能返回业务内容', async () => {
    const f = await fixture({ pending: true })
    const a = await f.connect()
    const reading = a.client.callTool({ name: 'read_application_entity', arguments: {} }).catch(() => ({ isError: true }))
    await vi.waitFor(() => expect(f.calls.length).toBe(1))
    f.connections.revoke(f.first.id)
    await f.server.revoke(f.first.id)
    f.host.complete({ ...f.calls[0], result: { ok: true, data: { secret: 'late' } } })
    const result = await reading
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).not.toContain('late')
  })
  it('旧宿主注册晚到不能覆盖已经就绪的新代次', async () => {
    const f = await fixture()
    f.host.register({ sessionId: randomUUID(), generation: 3, ready: true, tools: [] }, { send: () => {} })
    f.host.register({ sessionId: randomUUID(), generation: 2, ready: false, tools: [] }, { send: () => {} })
    expect(f.host.ready).toBe(true)
  })
  /**
   * 兼容矩阵的下边界：**声明外的协议版本不能把客户端挡在门外**。
   *
   * 规范要求服务端在不认识请求版本时回落到自己支持的版本，由客户端决定是否继续；如果哪天
   * 变成直接报错，旧客户端会在握手阶段全部掉线，而这属于对外破坏性变更，必须被这条盯住。
   */
  it('声明外与畸形协议版本回落到本服务最新版本，不在握手阶段失败', async () => {
    const f = await fixture()
    const handshake = async (protocolVersion: string): Promise<string> => {
      const response = await fetch(f.url(), { method: 'POST', headers: { Authorization: `Bearer ${f.connections.token(f.first.id)}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion, capabilities: {}, clientInfo: { name: '兼容探针', version: '1' } } }) })
      expect(response.status, protocolVersion).toBe(200)
      return (await response.json() as { result: { protocolVersion: string } }).result.protocolVersion
    }
    // 未来版本与畸形字符串都回落到声明矩阵里的最新版本。
    expect(await handshake('2099-01-01')).toBe(EXTERNAL_PROTOCOL_VERSIONS[0])
    expect(await handshake('nonsense')).toBe(EXTERNAL_PROTOCOL_VERSIONS[0])
    // SDK 还接受比回归矩阵更旧的 2024-11-05：协商结果要么是请求版本，要么是矩阵最新版本。
    expect([...EXTERNAL_PROTOCOL_VERSIONS, '2024-11-05']).toContain(await handshake('2024-11-05'))
  })

  it('契约发现按授权档回答，并说明缺席与被拒的区别', async () => {
    const f = await fixture()
    // 宿主登记了写工具，但本连接只有读授权：写工具应当"缺席且说明缺哪一档"。
    f.host.register({ sessionId: randomUUID(), generation: 9, ready: true, tools: [
      { id: 'read_application_entity', version: 1, title: '读取', description: '读取实体', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
      { id: 'change_application_entities', version: 2, title: '修改', description: '修改实体', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    ] }, { send: () => {} })
    const a = await f.connect()
    const result = await a.client.callTool({ name: 'describe_application_contract', arguments: {} })
    expect(result.isError, JSON.stringify(result)).toBe(false)
    const data = (result.structuredContent as { data: Record<string, unknown> }).data
    expect((data.contract as { externalContractVersion: string }).externalContractVersion).toBe(EXTERNAL_CONTRACT_VERSION)
    expect((data.contract as { transport: { url: string } }).transport.url).toBe(`http://127.0.0.1:${f.server.listeningPort}/mcp`)
    const access = data.access as { write: boolean; hiddenTools: Array<{ name: string; requires: string }>; note: string }
    expect(access.write).toBe(false)
    expect(access.hiddenTools.map((item) => item.name)).toContain('change_application_entities')
    expect(access.note).toContain('PERMISSION_DENIED')
    // 缺席的工具直接点名调用：得到的是拒绝，而不是"没有这个能力"。
    const denied = await a.client.callTool({ name: 'change_application_entities', arguments: {} })
    expect(denied.isError).toBe(true)
    expect(f.calls).toHaveLength(0)
  })

  it('目录随宿主重新注册刷新，不依赖 listChanged 通知', async () => {
    const f = await fixture()
    const a = await f.connect()
    expect((await a.client.listTools()).tools.map((tool) => tool.name)).toContain('read_application_entity')
    f.host.register({ sessionId: randomUUID(), generation: 5, ready: true, tools: [{ id: 'list_application_entities', version: 1, title: '列出', description: '列出实例', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }] }, { send: () => {} })
    const refreshed = (await a.client.listTools()).tools.map((tool) => tool.name)
    expect(refreshed).toContain('list_application_entities')
    expect(refreshed).not.toContain('read_application_entity')
    // 服务端没有声明 listChanged；只支持普通工具调用的客户端重新列举即可拿到最新目录。
    expect(a.client.getServerCapabilities()?.tools).toEqual({})
  })

  it('协议工具拒绝未知字段并指名字段，超限结果不落到调用方', async () => {
    const unknownField = await (await fixture()).connect()
    const rejected = await unknownField.client.callTool({ name: 'read_application_media', arguments: { ref: { kind: 'asset', id: 'x' }, unexpected: 1 } })
    expect(rejected.isError).toBe(true)
    expect(JSON.stringify(rejected)).toContain('unexpected')
    // 协议自身的 _meta 不属于工具参数，不能被严格校验误伤。
    const meta = await unknownField.client.callTool({ name: 'describe_application_contract', arguments: {}, _meta: { progressToken: 'p1' } })
    expect(meta.isError, JSON.stringify(meta)).toBe(false)

    const oversized = await fixture({ result: { ok: true, data: { blob: 'x'.repeat(3 * 1024 * 1024) } } })
    const b = await oversized.connect()
    const big = await b.client.callTool({ name: 'read_application_entity', arguments: {} })
    expect(big.isError).toBe(true)
    expect(JSON.stringify(big)).not.toContain('xxxxxxxxxx')
    expect(JSON.stringify(big)).toContain('分页')
  })

  it('客户端取消通过真实协议中止宿主等待', async () => {
    const f = await fixture({ pending: true })
    const a = await f.connect()
    const controller = new AbortController()
    const reading = a.client.callTool({ name: 'read_application_entity', arguments: {} }, undefined, { signal: controller.signal }).catch(() => 'cancelled')
    await vi.waitFor(() => expect(f.calls).toHaveLength(1))
    controller.abort()
    expect(await reading).toBe('cancelled')
    await vi.waitFor(() => expect(f.cancellations).toContain(f.calls[0].requestId))
  })
})
