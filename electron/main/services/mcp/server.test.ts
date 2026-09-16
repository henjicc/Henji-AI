// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { request as httpRequest } from 'node:http'
import { randomUUID } from 'node:crypto'
import { Client } from '@modelcontextprotocol/client'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { LocalMcpServer } from './server'
import { McpConnections } from './connections'
import { ApplicationHostBridge } from '../application-runtime/applicationHostBridge'
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
      if (channel === 'application:host:cancel') cancellations.push(payload as string)
      if (channel !== 'application:host:request') return
      const request = payload as LocalHostRequest
      calls.push(request)
      if (!options.pending) host.complete({ requestId: request.requestId, sessionId: request.sessionId, result: options.result ?? { ok: true, data: { ref: { kind: 'settings.registry', id: 'singleton' }, entityType: 'settings.registry', properties: { name: '隔离工程' }, revisions: {}, capturedAt: new Date(0).toISOString(), revision: 0, scopeRevisions: { navigation: 0, generation: 0, canvas: 0, toolbox: 0, assets: 0 } } } })
    },
  })
  const server = new LocalMcpServer(connections, host)
  await server.start(0)
  closers.push(() => server.stop())
  const url = () => `http://127.0.0.1:${server.listeningPort}/mcp`
  const connect = async (id = first.id) => {
    const transport = new StreamableHTTPClientTransport(new URL(url()), { requestInit: { headers: { Authorization: `Bearer ${connections.token(id)}` } } })
    const client = new Client({ name: '协议验收', version: '1' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } })
    closers.push(() => client.close())
    await client.connect(transport)
    return { client, transport }
  }
  return { server, connections, first, second, host, calls, cancellations, url, connect, advance: () => { now += 31 * 86400_000 } }
}

describe('本地 MCP 协议与边界', () => {
  it('标准订阅只发送选中的资源更新，关闭与撤销释放流', async () => {
    const f = await fixture()
    const { client } = await f.connect()
    const uri = 'henji://entity/settings.registry/singleton'
    await client.readResource({ uri })
    const updates: string[] = []
    client.setNotificationHandler('notifications/resources/updated', message => { updates.push(message.params.uri) })
    const subscription = await client.listen({ resourceSubscriptions: [uri] })
    expect(subscription.honoredFilter.resourceSubscriptions).toEqual([uri])
    f.host.register({ sessionId: randomUUID(), generation: 5, ready: true, tools: [] }, { send: () => {} })
    await vi.waitFor(() => expect(updates).toContain(uri))
    await subscription.close()
    expect(await subscription.closed).toBe('local')
    const revoked = await client.listen({ toolsListChanged: true })
    f.connections.revoke(f.first.id)
    await f.server.revoke(f.first.id)
    expect(await revoked.closed).toBe('remote')
  })
  it('现代原始请求携带元信息且没有 initialize，Resources 共用读取权限', async () => {
    const f = await fixture()
    const messages: Array<{ method: string; params?: { _meta?: Record<string, unknown> } }> = []
    const client = new Client({ name: '现代报文验收', version: '1' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } })
    closers.push(() => client.close())
    const transport = new StreamableHTTPClientTransport(new URL(f.url()), {
      requestInit: { headers: { Authorization: `Bearer ${f.connections.token(f.first.id)}` } },
      fetch: async (url, init) => {
        if (typeof init?.body === 'string') messages.push(JSON.parse(init.body))
        return fetch(url, init)
      },
    })
    await client.connect(transport)
    await client.listTools()
    expect(messages.some(message => message.method === 'initialize')).toBe(false)
    expect(messages.some(message => message.method === 'server/discover')).toBe(true)
    expect(messages.every(message => message.params?._meta?.['io.modelcontextprotocol/protocolVersion'] === '2026-07-28')).toBe(true)
    expect(transport.sessionId).toBeUndefined()
    expect((await client.listResourceTemplates()).resourceTemplates).toHaveLength(3)
    const uri = 'henji://entity/settings.registry/singleton'
    const resource = await client.readResource({ uri })
    expect(resource.contents[0]).toMatchObject({ uri, mimeType: 'application/json' })
    expect(JSON.stringify(resource)).toContain('隔离工程')
    expect(f.calls.at(-1)?.capabilityId).toBe('read_application_entity')
    await expect(client.readResource({ uri: 'file:///secret.txt' })).rejects.toThrow()
  })
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
  it('拒绝旧握手与未支持的协议，不进行降级', async () => {
    const f = await fixture()
    for (const protocolVersion of ['2025-11-25', '2025-06-18', '2025-03-26', '2099-01-01']) {
      const response = await fetch(f.url(), { method: 'POST', headers: { Authorization: `Bearer ${f.connections.token(f.first.id)}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion, capabilities: {}, clientInfo: { name: '旧协议探针', version: '1' } } }) })
      const body = await response.json() as { error: { code: number; data: { supported: string[] } } }
      expect(body.error.code).toBe(-32022)
      expect(body.error.data.supported).toEqual(EXTERNAL_PROTOCOL_VERSIONS)
      expect(response.headers.has('mcp-session-id')).toBe(false)
    }
    expect(f.calls).toHaveLength(0)
  })
  it('现代发现与调用；关闭再开启不丢失根宿主', async () => {
    const f = await fixture()
    const a = await f.connect()
    // 只读连接：宿主登记的读取工具 + 服务自带的协议工具；写工具一个都不出现。
    // 按语义断言而不是数量，扩容目录不会误报，权限泄漏仍然必红。
    const readOnlyTools = (await a.client.listTools()).tools
    expect(readOnlyTools.map((tool) => tool.name)).toEqual(expect.arrayContaining(['read_application_entity', 'read_application_media', 'describe_application_contract']))
    expect(readOnlyTools.filter((tool) => tool.annotations?.readOnlyHint !== true)).toEqual([])
    expect((await a.client.callTool({ name: 'read_application_entity', arguments: {} })).structuredContent).toEqual({ ok: true, data: { ref: { kind: 'settings.registry', id: 'singleton' }, entityType: 'settings.registry', properties: { name: '隔离工程' }, revisions: {}, capturedAt: new Date(0).toISOString(), revision: 0, scopeRevisions: { navigation: 0, generation: 0, canvas: 0, toolbox: 0, assets: 0 } } })
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
  it('无协议会话；撤销和到期逐请求生效', async () => {
    const f = await fixture()
    const a = await f.connect()
    expect(a.transport.sessionId).toBeUndefined()
    const stolen = await fetch(f.url(), { method: 'DELETE', headers: { Authorization: `Bearer ${f.connections.token(f.second.id)}`, 'mcp-session-id': 'untrusted' } })
    expect(stolen.status).toBe(405)
    const token = f.connections.token(f.first.id)
    f.connections.revoke(f.first.id)
    await f.server.revoke(f.first.id)
    expect((await fetch(f.url(), { headers: { Authorization: `Bearer ${token}` } })).status).toBe(401)
    const tokenB = f.connections.token(f.second.id)
    f.advance()
    expect((await fetch(f.url(), { headers: { Authorization: `Bearer ${tokenB}` } })).status).toBe(401)
  })
  it('未就绪仍可发现目录，执行返回就绪失败', async () => {
    const f = await fixture({ ready: false })
    const { client } = await f.connect()
    expect((await client.listTools()).tools.length).toBeGreaterThan(0)
    expect((await client.callTool({ name: 'read_application_entity', arguments: {} })).isError).toBe(true)
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

  it('领域目录不随页面宿主注册改变，声明标准变更通知', async () => {
    const f = await fixture()
    const a = await f.connect()
    expect((await a.client.listTools()).tools.map((tool) => tool.name)).toContain('read_application_entity')
    f.host.register({ sessionId: randomUUID(), generation: 5, ready: true, tools: [{ id: 'list_application_entities', version: 1, title: '列出', description: '列出实例', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }] }, { send: () => {} })
    const refreshed = (await a.client.listTools()).tools.map((tool) => tool.name)
    expect(refreshed).toContain('list_application_entities')
    expect(refreshed).toContain('read_application_entity')
    // 服务端没有声明 listChanged；只支持普通工具调用的客户端重新列举即可拿到最新目录。
    expect(a.client.getServerCapabilities()?.tools).toEqual({ listChanged: true })
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
    const reading = a.client.callTool({ name: 'read_application_entity', arguments: {} }, { signal: controller.signal }).catch(() => 'cancelled')
    await vi.waitFor(() => expect(f.calls).toHaveLength(1))
    controller.abort()
    expect(await reading).toBe('cancelled')
    await vi.waitFor(() => expect(f.cancellations).toContain(f.calls[0].requestId))
  })
})
