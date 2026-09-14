// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { LocalMcpServer } from '../../../electron/main/services/mcp/server'
import { McpConnections } from '../../../electron/main/services/mcp/connections'
import { ApplicationHostBridge } from '../../../electron/main/services/mcp/applicationHostBridge'
import { MCP_WRITE_CAPABILITY_IDS, type McpPlatform, type LocalHostRequest } from '@/core/application-control/localHostContracts'
const { JSDOM } = createRequire(import.meta.url)('jsdom') as { JSDOM: new (html: string, options: { url: string }) => { window: Window } }

it('真实 MCP → 中立桥 → Session → 领域注册表读取正式设置，禁止内部实体与写入', async () => {
  const dom = new JSDOM('', { url: 'http://localhost' })
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('navigator', dom.window.navigator)
  vi.stubGlobal('localStorage', dom.window.localStorage)
  const { attachLocalApplicationHost } = await import('./localApplicationHost')
  const { useSettingsStore } = await import('@/stores/settingsStore')
  const connections = new McpConnections({ read: () => null, write: () => {} })
  const identity = connections.create('集成客户端')
  const bridge = new ApplicationHostBridge((id) => connections.assertActive(id))
  let handler: (request: LocalHostRequest) => void = () => {}
  const unused = async (): Promise<never> => { throw new Error('此管理路径不属于集成调用') }
  const platform: McpPlatform = {
    status: unused, configure: unused, authorize: unused, revoke: unused, connectionConfig: unused,
    onRequest: (value) => { handler = value; return () => {} }, onCancel: () => () => {}, onRevoke: () => () => {},
    registerHost: async (registration) => bridge.register(registration, { send: (channel, payload) => { if (channel === 'mcp:host:request') handler(payload as LocalHostRequest) } }),
    complete: async (reply) => bridge.complete(reply),
  }
  const detach = attachLocalApplicationHost(platform, true)
  const server = new LocalMcpServer(connections, bridge)
  const client = new Client({ name: '领域集成', version: '1' })
  try {
    await server.start(0)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.listeningPort}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${connections.token(identity.id)}` } } }))
    // 只读连接可见的每个工具都必须是读取工具；写能力一个都不许出现在清单里。
    const listed = (await client.listTools()).tools
    expect(listed.map((tool) => tool.name)).toEqual(expect.arrayContaining(['describe_application_entities', 'list_application_entities', 'read_application_entity']))
    expect(listed.filter((tool) => tool.annotations?.readOnlyHint !== true).map((tool) => tool.name)).toEqual([])
    expect(listed.map((tool) => tool.name).filter((name) => MCP_WRITE_CAPABILITY_IDS.some((id) => id === name))).toEqual([])
    const result = await client.callTool({ name: 'read_application_entity', arguments: { ref: { kind: 'settings.registry', id: 'singleton' }, propertyIds: ['interface.theme_tone'] } })
    expect(result.isError, JSON.stringify(result)).toBe(false)
    expect(result.structuredContent).toMatchObject({ ok: true, data: { properties: { 'interface.theme_tone': useSettingsStore.getState().themeTonePreset } } })
    const denied = await client.callTool({ name: 'read_application_entity', arguments: { ref: { kind: 'assistant.run', id: 'unknown' } } })
    expect(denied.isError).toBe(true)
    expect((await client.callTool({ name: 'change_application_entities', arguments: {} })).isError).toBe(true)

    // 契约发现：域清单由真实反射注册表派生，八个业务写域可写，助手运行目录不出现。
    const contract = await client.callTool({ name: 'describe_application_contract', arguments: {} })
    expect(contract.isError, JSON.stringify(contract)).toBe(false)
    const discovered = (contract.structuredContent as { data: { domains: Array<{ id: string; writable: boolean }> } }).data.domains
    expect(discovered.filter((domain) => domain.writable).map((domain) => domain.id).sort())
      .toEqual(['assets', 'camera_stage', 'canvas', 'generation', 'image_edit', 'image_mark', 'models', 'settings'])
    expect(discovered.map((domain) => domain.id)).not.toContain('assistant_runtime')
    expect(discovered.every((domain) => !('entities' in domain))).toBe(true)
    const expanded = await client.callTool({ name: 'describe_application_contract', arguments: { domains: ['toolbox'] } })
    const toolbox = (expanded.structuredContent as { data: { domains: Array<{ id: string; entities?: Array<{ readOnlyReason?: string }> }> } }).data.domains.find((domain) => domain.id === 'toolbox')!
    expect(toolbox.entities?.[0].readOnlyReason).toBeTruthy()

    // 分页：普通客户端用 cursor/limit 就能翻完大目录，不需要任何扩展。
    const page = await client.callTool({ name: 'list_application_entities', arguments: { entityType: 'settings.registry', limit: 1 } })
    expect(page.isError, JSON.stringify(page)).toBe(false)
    expect((page.structuredContent as { data: { refs: unknown[]; nextCursor: string | null } }).data).toMatchObject({ nextCursor: null })

    // 未知字段：严格拒绝，并且点名是哪个字段，不给一句无法行动的兜底文案。
    const unknownField = await client.callTool({ name: 'read_application_entity', arguments: { ref: { kind: 'settings.registry', id: 'singleton' }, unexpected: 1 } })
    expect(unknownField.isError).toBe(true)
    expect(JSON.stringify(unknownField)).toContain('unexpected')
  } finally { await client.close(); await server.stop(); detach(); vi.unstubAllGlobals(); dom.window.close() }
}, 30_000)
