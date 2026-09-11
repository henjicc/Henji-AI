// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { LocalMcpServer } from '../../../electron/main/services/mcp/server'
import { McpConnections } from '../../../electron/main/services/mcp/connections'
import { ApplicationHostBridge } from '../../../electron/main/services/mcp/applicationHostBridge'
import type { McpPlatform, LocalHostRequest } from '@/core/application-control/localHostContracts'
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
    expect((await client.listTools()).tools).toHaveLength(3)
    const result = await client.callTool({ name: 'read_application_entity', arguments: { ref: { kind: 'settings.registry', id: 'singleton' }, propertyIds: ['interface.theme_tone'] } })
    expect(result.isError, JSON.stringify(result)).toBe(false)
    expect(result.structuredContent).toMatchObject({ ok: true, data: { properties: { 'interface.theme_tone': useSettingsStore.getState().themeTonePreset } } })
    const denied = await client.callTool({ name: 'read_application_entity', arguments: { ref: { kind: 'assistant.run', id: 'unknown' } } })
    expect(denied.isError).toBe(true)
    expect((await client.callTool({ name: 'change_application_entities', arguments: {} })).isError).toBe(true)
  } finally { await client.close(); await server.stop(); detach(); vi.unstubAllGlobals(); dom.window.close() }
}, 30_000)
