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
  // 写入范围经真实宿主注册从反射注册表派生，主进程不再维护 entityType 前缀白名单。
  const operations = new McpOperationCoordinator(new McpOperationStore(db), undefined, () => bridge.writableEntityTypes())
  const bridge: ApplicationHostBridge = new ApplicationHostBridge((id) => connections.assertActive(id), operations)
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
    /*
     * 公开写入范围来自反射注册表的派生结果，不是 MCP 侧的前缀白名单。
     * 声明了 writeExclusion 的实体在派发前就被拒绝，并且指得出改用哪条发现路径。
     */
    const excluded = await client.callTool({ name: 'change_application_entities', arguments: { operationId: randomUUID(), baselineIds, summary: '越界写入', changes: [{ kind: 'set_properties', entityType: 'image_edit.document', target: { kind: 'image_edit.document', id: 'doc-1' }, properties: { name: 'x' } }] } })
    expect(excluded.isError).toBe(true)
    expect(JSON.stringify(excluded)).toContain('不属于公开业务写入范围')
    expect(JSON.stringify(excluded)).toContain('describe_application_contract')
    expect(bridge.writableEntityTypes().has('settings.registry')).toBe(true)
    expect(bridge.writableEntityTypes().has('image_edit.document')).toBe(false)

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
