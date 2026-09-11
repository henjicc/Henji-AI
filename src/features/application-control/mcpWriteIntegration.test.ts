// @vitest-environment node
import { expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { LocalMcpServer } from '../../../electron/main/services/mcp/server'
import { McpConnections } from '../../../electron/main/services/mcp/connections'
import { ApplicationHostBridge } from '../../../electron/main/services/mcp/applicationHostBridge'
import { McpOperationStore } from '../../../electron/main/services/mcp/operationStore'
import { McpOperationCoordinator } from '../../../electron/main/services/mcp/operationCoordinator'
import type { McpPlatform, LocalHostRequest } from '@/core/application-control/localHostContracts'
if (!process.versions.electron) throw new Error('本测试必须由正式 Electron SQLite 原生运行器执行，不能跳过原生边界。')
const { JSDOM } = createRequire(import.meta.url)('jsdom') as { JSDOM: new (html: string, options: { url: string }) => { window: Window } }

it('真实 MCP 写入经过授权、SQLite操作账本、正式Session及设置保存；预检拒绝不会永久锁死目标', async () => {
  const dom = new JSDOM('', { url: 'http://localhost' })
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('navigator', dom.window.navigator); vi.stubGlobal('localStorage', dom.window.localStorage)
  const { attachLocalApplicationHost } = await import('./localApplicationHost')
  const { useSettingsStore } = await import('@/stores/settingsStore')
  const connections = new McpConnections({ read: () => null, write: () => {} })
  const identity = connections.create('受控集成客户端', { allowWrites: true })
  const db = new Database(':memory:')
  const operations = new McpOperationCoordinator(new McpOperationStore(db))
  const bridge = new ApplicationHostBridge((id) => connections.assertActive(id), operations)
  let handler: (request: LocalHostRequest) => void = () => {}
  const unused = async (): Promise<never> => { throw new Error('不使用管理接口') }
  const platform: McpPlatform = {
    status: unused, configure: unused, authorize: unused, revoke: unused, connectionConfig: unused,
    onRequest: (value) => { handler = value; return () => {} }, onCancel: () => () => {}, onRevoke: () => () => {},
    registerHost: async (registration) => bridge.register(registration, { send: (channel, payload) => { if (channel === 'mcp:host:request') handler(payload as LocalHostRequest) } }),
    complete: async (reply) => bridge.complete(reply),
  }
  const detach = attachLocalApplicationHost(platform, true)
  const server = new LocalMcpServer(connections, bridge, undefined, operations)
  const client = new Client({ name: '写入集成', version: '1' })
  try {
    await server.start(0)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.listeningPort}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${connections.token(identity.id)}` } } }))
    const ref = { kind: 'settings.registry', id: 'singleton' }
    const read = await client.callTool({ name: 'read_application_entity', arguments: { ref, propertyIds: ['interface.theme_tone'] } })
    const baselineIds = [(read.structuredContent as Record<string, unknown>).baselineId]
    const original = useSettingsStore.getState().themeTonePreset
    for (const properties of [{ 'interface.theme_tone': 'not-a-tone' }, { 'settings.not_registered': true }]) {
      const operationId = randomUUID()
      const rejected = await client.callTool({ name: 'change_application_entities', arguments: { operationId, baselineIds, summary: '非法输入', changes: [{ kind: 'set_properties', entityType: ref.kind, target: ref, properties }] } })
      expect(rejected.structuredContent, JSON.stringify(rejected)).toMatchObject({ executionState: 'not_executed' })
      expect(useSettingsStore.getState().themeTonePreset).toBe(original)
    }
    const operationId = randomUUID()
    const tone = original === 'warm' ? 'cool' : 'warm'
    const args = { operationId, baselineIds, summary: '修改主题', changes: [{ kind: 'set_properties', entityType: ref.kind, target: ref, properties: { 'interface.theme_tone': tone } }] }
    const result = await client.callTool({ name: 'change_application_entities', arguments: args })
    expect(result.structuredContent, JSON.stringify(result)).toMatchObject({ executionState: 'completed', verificationState: 'verified' })
    expect(JSON.parse(localStorage.getItem('settings-storage')!).state.themeTonePreset).toBe(tone)
    const revision = operations.store.get(operationId, identity.id)!.result
    expect((await client.callTool({ name: 'change_application_entities', arguments: args })).structuredContent).toEqual(result.structuredContent)
    expect(operations.store.get(operationId, identity.id)!.result).toEqual(revision)
  } finally { await client.close(); await server.stop(); detach(); db.close(); vi.unstubAllGlobals(); dom.window.close() }
}, 30_000)
