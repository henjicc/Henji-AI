import { ApplicationToolDispatcher } from '../../../electron/main/services/application-runtime/applicationToolDispatcher'
// @vitest-environment node
import { expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { PiEngine } from '../../../electron/main/services/embedded-agent/piEngine'
import { Client } from '@modelcontextprotocol/client'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { LocalMcpServer } from '../../../electron/main/services/mcp/server'
import { McpConnections } from '../../../electron/main/services/mcp/connections'
import { ApplicationHostBridge } from '../../../electron/main/services/application-runtime/applicationHostBridge'
import { ApplicationOperationStore } from '../../../electron/main/services/application-runtime/operationStore'
import { ApplicationOperationCoordinator } from '../../../electron/main/services/application-runtime/operationCoordinator'
import type { ApplicationHostPlatform, LocalHostRequest } from '@/core/application-control/localHostContracts'
if (!process.versions.electron) throw new Error('本测试必须由正式 Electron SQLite 原生运行器执行，不能跳过原生边界。')
const { JSDOM } = createRequire(import.meta.url)('jsdom') as { JSDOM: new (html: string, options: { url: string }) => { window: Window } }

async function removePiFixtureDirectory(directory: string): Promise<void> {
  if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('henji-pi-mcp-')) {
    throw new Error('临时会话目录越界')
  }
  await fs.rm(directory, { recursive: true, force: true })
}

it('真实 MCP 与 Pi 写入经过授权、SQLite账本、正式Session及设置保存；拒绝后可恢复并读回实际结果', async () => {
  const dom = new JSDOM('', { url: 'http://localhost' })
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('navigator', dom.window.navigator); vi.stubGlobal('localStorage', dom.window.localStorage)
  const { attachLocalApplicationHost } = await import('./localApplicationHost')
  const { useSettingsStore } = await import('@/stores/settingsStore')
  const connections = new McpConnections({ read: () => null, write: () => {} })
  const identity = connections.create('受控集成客户端', { allowWrites: true })
  const db = new Database(':memory:')
  // 写入范围经真实宿主注册从反射注册表派生，主进程不再维护 entityType 前缀白名单。
  const operations = new ApplicationOperationCoordinator(new ApplicationOperationStore(db), undefined, () => bridge.writableEntityTypes())
  const bridge: ApplicationHostBridge = new ApplicationHostBridge((id) => connections.assertActive(id), operations)
  let handler: (request: LocalHostRequest) => void = () => {}
  const platform: ApplicationHostPlatform = {
    publishContext: async snapshot => bridge.publishContext(snapshot),
    onRequest: (value) => { handler = value; return () => {} }, onCancel: () => () => {}, onRevoke: () => () => {},
    registerHost: async (registration) => bridge.register(registration, { send: (channel, payload) => { if (channel === 'application:host:request') handler(payload as LocalHostRequest) } }),
    complete: async (reply) => bridge.complete(reply),
  }
  const detach = attachLocalApplicationHost(platform, true)
  const server = new LocalMcpServer(connections, bridge, undefined, operations)
  const client = new Client({ name: '写入集成', version: '1' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } })
  try {
    await server.start(0)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.listeningPort}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${connections.token(identity.id)}` } } }))
    const published = (await client.listTools()).tools.map(tool => tool.name)
    expect(published.length).toBeGreaterThan(32)
    expect(published).toEqual(expect.arrayContaining(['create_canvas_project', 'duplicate_canvas_node', 'open_application_surface']))
    const navigation = await client.callTool({ name: 'open_application_surface', arguments: { operationId: randomUUID(), surfaceId: 'workspace.canvas' } })
    expect(navigation.structuredContent, JSON.stringify(navigation)).toMatchObject({ executionState: 'completed' })
    const { useNavigationStore } = await import('@/stores/navigationStore')
    expect(useNavigationStore.getState().activeWorkspace).toBe('nodes')
    const { installHarnessNativeStorage, uninstallHarnessNativeStorage } = await import('@/tests/harnessNativeStorage')
    installHarnessNativeStorage()
    try {
      const { useProjectStore } = await import('@/stores/projectStore')
      await useProjectStore.getState().hydrate()
      const currentProjectId = useProjectStore.getState().currentProjectId
      const createId = randomUUID()
      const create = { operationId: createId, name: 'MCP 生命周期测试' }
      const created = await client.callTool({ name: 'create_canvas_project', arguments: create })
      expect(created.structuredContent, JSON.stringify(created)).toMatchObject({ executionState: 'completed' })
      const projectId = (created.structuredContent as { result: { data: { projectId: string } } }).result.data.projectId
      expect(projectId).toBeTruthy()
      const { getProjectRecord } = await import('@/commands/projectState')
      expect(await getProjectRecord(projectId)).toMatchObject({ id: projectId, name: create.name })
      expect((await client.callTool({ name: 'create_canvas_project', arguments: create })).structuredContent).toEqual(created.structuredContent)
      expect(useProjectStore.getState().currentProjectId).toBe(currentProjectId)
      expect(operations.store.get(createId, identity.id)?.state).toBe('completed')
    } finally { uninstallHarnessNativeStorage() }
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

    // 官方 Pi 真实序列化、HTTP 模型响应和 MCP 客户端均保留，只替换外部模型。
    const rejectedId = randomUUID(); const acceptedId = randomUUID()
    const plan = [
      { name: 'change_application_entities', arguments: { operationId: rejectedId, summary: '无效主题', changes: [
        { kind: 'set_properties', entityType: ref.kind, target: ref, properties: { 'interface.theme_tone': 'invalid' } },
      ] } },
      { name: 'change_application_entities', arguments: { operationId: acceptedId, summary: '恢复原主题', changes: [
        { kind: 'set_properties', entityType: ref.kind, target: ref, properties: { 'interface.theme_tone': original } },
      ] } },
      { name: 'read_application_entity', arguments: { ref, propertyIds: ['interface.theme_tone'] } },
    ]
    const requests: Array<{ messages: Array<{ role: string; content: unknown }> }> = []
    const modelServer = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const body = JSON.parse(Buffer.concat(chunks).toString()) as typeof requests[number]
      requests.push(body)
      const index = body.messages.filter(message => message.role === 'tool').length
      const next = plan[index]
      const delta = next ? { tool_calls: [{ index: 0, id: `call_${index}`, type: 'function', function: {
        name: next.name, arguments: JSON.stringify(next.arguments),
      } }] } : { content: '设置修改已完成。' }
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'fixture', created: 1,
        choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`)
      response.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'fixture', created: 1,
        choices: [{ index: 0, delta: {}, finish_reason: next ? 'tool_calls' : 'stop' }] })}\n\n`)
      response.end('data: [DONE]\n\n')
    })
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-pi-mcp-'))
    const calls: string[] = []
    const dispatcher = new ApplicationToolDispatcher(connections, bridge, operations, 0, 'embedded')
    const engine = new PiEngine(() => undefined, async (_id, name, input, signal) => {
      calls.push(name)
      return dispatcher.call(identity.id, name, input, signal ?? new AbortController().signal)
    })
    try {
      await new Promise<void>(resolve => modelServer.listen(0, '127.0.0.1', resolve))
      const address = modelServer.address()
      if (!address || typeof address === 'string') throw new Error('模型响应替身未启动')
      await engine.command({ action: 'initialize', input: directory })
      await engine.command({ action: 'configure', input: { directory, instructions: '使用应用工具完成设置修改并读取结果。',
        tools: dispatcher.catalog(identity.id).tools,
        model: { providerId: 'fixture', api: 'openai-completions', apiKey: 'local-fixture', baseUrl: `http://127.0.0.1:${address.port}/v1`,
          model: { providerId: 'fixture', modelId: 'fixture', displayName: 'Fixture', adapter: 'openai-compatible', enabled: true,
            capabilities: { text: true, image: false, video: false, audio: false, streaming: true, toolCall: true, parallelTools: false,
              jsonOutput: false, structuredOutputMode: 'none', reasoning: false, sampling: true, contextWindow: 32768, maxOutputTokens: 1024, usage: false } } },
      } })
      await client.close()
      await server.stop()
      expect(server.listening).toBe(false)
      await engine.command({ action: 'prompt', input: { text: '恢复原主题并读取结果', context: '' } })
      expect(calls).toEqual(plan.map(item => item.name))
      expect(operations.store.get(rejectedId, identity.id)?.state).toBe('not_executed')
      expect(operations.store.get(acceptedId, identity.id)?.state).toBe('completed')
      expect(useSettingsStore.getState().themeTonePreset).toBe(original)
      expect(JSON.parse(localStorage.getItem('settings-storage')!).state.themeTonePreset).toBe(original)
      const toolResults = requests.at(-1)!.messages.filter(message => message.role === 'tool')
      expect(toolResults).toHaveLength(3)
      expect(JSON.stringify(toolResults[0].content)).toContain('not_executed')
      expect(JSON.stringify(toolResults[1].content)).toContain('verified')
      expect(JSON.stringify(toolResults[2].content)).toContain(original)
      expect(await engine.command({ action: 'snapshot' })).toMatchObject({ busy: false, error: null })
    } finally {
      await engine.dispose()
      modelServer.closeAllConnections()
      await new Promise<void>(resolve => modelServer.close(() => resolve()))
      await removePiFixtureDirectory(directory)
    }
  } finally { await client.close(); await server.stop(); detach(); db.close(); vi.unstubAllGlobals(); dom.window.close() }
}, 30_000)

it('关闭现代 HTTP 监听只结束等待，已登记写入仍可完成并从原账本查询', async () => {
  const connections = new McpConnections({ read: () => null, write: () => {} })
  const caller = connections.create('断线写入验收', { allowWrites: true })
  const db = new Database(':memory:')
  const operations = new ApplicationOperationCoordinator(new ApplicationOperationStore(db), undefined, () => new Set(['settings.registry']))
  const host = new ApplicationHostBridge(id => connections.assertActive(id), operations)
  const requests: LocalHostRequest[] = []
  const channels: string[] = []
  const rendererEpoch = randomUUID()
  host.register({ rendererEpoch, attachmentSequence: 1, ready: true, tools: [], domains: [] }, { send(channel, value) {
    channels.push(channel)
    if (channel === 'application:host:request') requests.push(value as LocalHostRequest)
  } })
  const server = new LocalMcpServer(connections, host, undefined, operations)
  const client = new Client({ name: '断线验收', version: '1' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } })
  try {
    await server.start(0)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.listeningPort}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${connections.token(caller.id)}` } } }))
    const operationId = randomUUID()
    const waiting = client.callTool({ name: 'change_application_entities', arguments: { operationId, summary: '保存修改', changes: [{
      kind: 'set_properties', entityType: 'settings.registry', target: { kind: 'settings.registry', id: 'singleton' }, properties: { 'interface.theme_tone': 'cool' },
    }] } }).catch(() => undefined)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    await server.stop()
    await waiting
    expect(channels).toEqual(['application:host:request'])
    expect(operations.store.get(operationId, caller.id)?.state).toBe('executing')
    host.complete({ rendererEpoch, requestId: requests[0].requestId, result: { ok: true, data: { verification: { verified: true } } } })
    const direct = new ApplicationToolDispatcher(connections, host, operations)
    expect(await direct.call(caller.id, 'get_application_operation', { operationId }, new AbortController().signal)).toMatchObject({ executionState: 'completed', verificationState: 'verified' })
  } finally { await client.close(); await server.stop(); host.disconnect(); db.close() }
}, 15_000)
