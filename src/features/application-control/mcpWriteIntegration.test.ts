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
import { ApplicationOperationStore, createApplicationOperationTablesV1 } from '../../../electron/main/services/application-runtime/operationStore'
import { ApplicationOperationCoordinator } from '../../../electron/main/services/application-runtime/operationCoordinator'
import type { ApplicationHostPlatform, LocalHostRequest } from '@/core/application-control/localHostContracts'
if (!process.versions.electron) throw new Error('本测试必须由正式 Electron SQLite 原生运行器执行，不能跳过原生边界。')
const { JSDOM } = createRequire(import.meta.url)('jsdom') as { JSDOM: new (html: string, options: { url: string }) => { window: Window } }

it('真实 MCP 与 Pi 写入经过授权、SQLite账本、正式Session及设置保存；拒绝后可恢复并读回实际结果', async () => {
  const dom = new JSDOM('', { url: 'http://localhost' })
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('navigator', dom.window.navigator); vi.stubGlobal('localStorage', dom.window.localStorage)
  const { attachLocalApplicationHost } = await import('./localApplicationHost')
  const { useSettingsStore } = await import('@/stores/settingsStore')
  const connections = new McpConnections({ read: () => null, write: () => {} })
  const identity = connections.create('受控集成客户端', { allowWrites: true })
  const db = new Database(':memory:')
  createApplicationOperationTablesV1(db)
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
    expect(published).toEqual(expect.arrayContaining(['create_document', 'duplicate_canvas_node', 'open_application_surface']))
    expect(published).not.toContain('create_canvas_project')
    const navigation = await client.callTool({ name: 'open_application_surface', arguments: { operationId: randomUUID(), surfaceId: 'workspace.canvas' } })
    expect(navigation.structuredContent, JSON.stringify(navigation)).toMatchObject({ executionState: 'completed' })
    const { useNavigationStore } = await import('@/stores/navigationStore')
    expect(useNavigationStore.getState().activeWorkspace).toBe('nodes')
    const { installHarnessNativeStorage, uninstallHarnessNativeStorage } = await import('@/tests/harnessNativeStorage')
    installHarnessNativeStorage()
    try {
      const { useProjectStore } = await import('@/stores/projectStore')
      const currentProjectId = useProjectStore.getState().currentProjectId
      const createId = randomUUID()
      // 画布是通用文档（3.4）：经 create_document 新建，幂等重放返回同一回执
      const create = { operationId: createId, kind: 'canvas', name: 'MCP 生命周期测试' }
      const created = await client.callTool({ name: 'create_document', arguments: create })
      expect(created.structuredContent, JSON.stringify(created)).toMatchObject({ executionState: 'completed' })
      const projectId = (created.structuredContent as { result: { data: { resultRef: { id: string } } } }).result.data.resultRef.id
      expect(projectId).toBeTruthy()
      const { harnessDocumentStore } = await import('@/tests/harnessNativeStorage')
      expect(harnessDocumentStore().stored(projectId)?.meta).toMatchObject({ id: projectId, kind: 'canvas', name: create.name })
      expect((await client.callTool({ name: 'create_document', arguments: create })).structuredContent).toEqual(created.structuredContent)
      expect(useProjectStore.getState().currentProjectId).toBe(currentProjectId)
      expect(operations.store.get(createId, identity.id)?.state).toBe('completed')
    } finally { uninstallHarnessNativeStorage() }
    const ref = { kind: 'settings.registry', id: 'singleton' }
    const read = await client.callTool({ name: 'read_application_entity', arguments: { ref, propertyIds: ['interface.theme_contrast'] } })
    const baselineIds = [(read.structuredContent as Record<string, unknown>).baselineId]
    const original = useSettingsStore.getState().themeSelection.contrast
    for (const properties of [{ 'interface.theme_contrast': 'not-a-level' }, { 'settings.not_registered': true }]) {
      const operationId = randomUUID()
      const rejected = await client.callTool({ name: 'change_application_entities', arguments: { operationId, baselineIds, summary: '非法输入', changes: [{ kind: 'set_properties', entityType: ref.kind, target: ref, properties }] } })
      expect(rejected.structuredContent, JSON.stringify(rejected)).toMatchObject({ executionState: 'not_executed' })
      expect(useSettingsStore.getState().themeSelection.contrast).toBe(original)
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
    const contrast = original === 'soft' ? 'strong' : 'soft'
    const args = { operationId, baselineIds, summary: '修改主题', changes: [{ kind: 'set_properties', entityType: ref.kind, target: ref, properties: { 'interface.theme_contrast': contrast } }] }
    const result = await client.callTool({ name: 'change_application_entities', arguments: args })
    expect(result.structuredContent, JSON.stringify(result)).toMatchObject({ executionState: 'completed', verificationState: 'verified' })
    expect(JSON.parse(localStorage.getItem('settings-storage')!).state.themeSelection.contrast).toBe(contrast)
    const revision = operations.store.get(operationId, identity.id)!.result
    expect((await client.callTool({ name: 'change_application_entities', arguments: args })).structuredContent).toEqual(result.structuredContent)
    expect(operations.store.get(operationId, identity.id)!.result).toEqual(revision)

    // 官方 Pi 真实序列化、HTTP 模型响应和 MCP 客户端均保留，只替换外部模型。
    const rejectedId = randomUUID(); const acceptedId = randomUUID()
    const plan = [
      { name: 'change_application_entities', arguments: { operationId: rejectedId, summary: '无效主题', changes: [
        { kind: 'set_properties', entityType: ref.kind, target: ref, properties: { 'interface.theme_contrast': 'invalid' } },
      ] } },
      { name: 'change_application_entities', arguments: { operationId: acceptedId, summary: '恢复原主题', changes: [
        { kind: 'set_properties', entityType: ref.kind, target: ref, properties: { 'interface.theme_contrast': original } },
      ] } },
      { name: 'read_application_entity', arguments: { ref, propertyIds: ['interface.theme_contrast'] } },
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
      expect(useSettingsStore.getState().themeSelection.contrast).toBe(original)
      expect(JSON.parse(localStorage.getItem('settings-storage')!).state.themeSelection.contrast).toBe(original)
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
  createApplicationOperationTablesV1(db)
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
      kind: 'set_properties', entityType: 'settings.registry', target: { kind: 'settings.registry', id: 'singleton' }, properties: { 'interface.theme_contrast': 'strong' },
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

it('t82：超长素材名的零提交拒绝不锁文档；丢失回执可只读核对成功与拒绝并解除屏障', async () => {
  const dom = new JSDOM('', { url: 'http://localhost' })
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('navigator', dom.window.navigator); vi.stubGlobal('localStorage', dom.window.localStorage)
  const { attachLocalApplicationHost } = await import('./localApplicationHost')
  const { installHarnessNativeStorage, uninstallHarnessNativeStorage } = await import('@/tests/harnessNativeStorage')
  const { createLegacyTrackVideoEditProject, failVideoEditSaves } = await import('@/features/videoEdit/application/videoEditDocumentTestKit')
  const { closeVideoEditProject } = await import('@/features/videoEdit/application/videoEditService')
  const { databaseService } = await import('@/services/database')
  const naming = await import('@/core/documents/generatedMediaName')
  const { getPlatform } = await import('@/platform/runtime')
  const prompt = '长提示词😀'.repeat(80)
  installHarnessNativeStorage()
  const assets = new Map<string, import('@/platform/contracts/assetLibrary').AssetRecord>()
  const files = new Map<string, string>()
  const platform = getPlatform()
  const content = { sizeBytes: 4096, fileModifiedAt: 1000, contentIdentity: 'c'.repeat(64) }
  vi.spyOn(platform.system.dialog, 'save').mockResolvedValue('D:/t82.henji-video')
  vi.spyOn(platform.system.fs, 'writeTextFile').mockImplementation(async (file, text) => { files.set(file, text) })
  vi.spyOn(platform.system.fs, 'readTextFile').mockImplementation(async file => files.get(file)!)
  vi.spyOn(platform.system.fs, 'exists').mockResolvedValue(true)
  vi.spyOn(platform.system.paths, 'dirname').mockResolvedValue('D:/generated')
  vi.spyOn(platform.media, 'allowRoot').mockResolvedValue(undefined)
  vi.spyOn(platform.assetLibrary, 'inspectFileContent').mockResolvedValue(content)
  vi.spyOn(platform.assetLibrary, 'createAsset').mockImplementation(async input => {
    const existing = [...assets.values()].find(asset => asset.filePath === input.filePath)
    if (existing) return existing
    const asset: import('@/platform/contracts/assetLibrary').AssetRecord = { id: randomUUID(), filePath: input.filePath, mediaType: input.mediaType, displayName: input.displayName ?? '结果', displayUrl: '', source: input.source, mimeType: 'image/png', ...content, width: 1920, height: 1080, durationSeconds: 0, thumbnailPath: null, thumbnailUrl: null, inspectionStatus: 'ready', inspectionError: null, lastUsedAt: null, createdAt: 1, updatedAt: 1, tags: [], libraryIds: [] }
    assets.set(asset.id, asset); return asset
  })
  vi.spyOn(platform.assetLibrary, 'inspectAsset').mockImplementation(async id => structuredClone(assets.get(id)!))
  vi.spyOn(databaseService, 'getHistoryById').mockResolvedValue({ id: 't82-result', type: 'image', status: 'success', resultPaths: ['D:/generated/poster.png'], prompt, modelId: 'fixture', providerId: 'fixture', taskId: null, duration: null, errorMessage: null, cost: null, params: {}, createdAt: '2026-10-08T00:00:00Z', updatedAt: '2026-10-08T00:00:00Z' })
  const owner = await createLegacyTrackVideoEditProject()
  const id = owner.document.id
  const db = new Database(':memory:'); createApplicationOperationTablesV1(db)
  const callerId = randomUUID()
  const operations = new ApplicationOperationCoordinator(new ApplicationOperationStore(db), undefined, () => bridge.writableEntityTypes())
  const bridge: ApplicationHostBridge = new ApplicationHostBridge(() => undefined, operations)
  let handler: (request: LocalHostRequest) => void = () => {}
  let dropped: AbortController | undefined
  const hostPlatform: ApplicationHostPlatform = {
    publishContext: async snapshot => bridge.publishContext(snapshot),
    onRequest: value => { handler = value; return () => {} }, onCancel: () => () => {}, onRevoke: () => () => {},
    registerHost: async registration => bridge.register(registration, { send: (channel, payload) => { if (channel === 'application:host:request') handler(payload as LocalHostRequest) } }),
    complete: async reply => {
      if (dropped && reply.result.ok !== undefined) { const waiting = dropped; dropped = undefined; waiting.abort(); return }
      bridge.complete(reply)
    },
  }
  const detach = attachLocalApplicationHost(hostPlatform, true)
  const dispatcher = new ApplicationToolDispatcher({ assertActive: () => undefined, access: () => ({ allowWrites: true, allowDestructive: false, allowPaid: false }) }, bridge, operations)
  const input = { documentRef: { kind: 'video_edit.document', id }, sequenceRef: { kind: 'video_edit.sequence', id: `${id}:${owner.activeSequenceId}` }, placement: { mode: 'library' }, result: { type: 'generation', resultRef: { kind: 'generation.result', id: 't82-result' }, outputIndex: 0 } }
  try {
    // 故障注入复现旧生产方把全文当名称；仍经真实副本schema、Session和SQLite回执。
    const faultyName = vi.spyOn(naming, 'generatedMediaName').mockReturnValue(prompt)
    const before = owner.document
    const failedId = randomUUID()
    const failed = await dispatcher.call(callerId, 'place_video_edit_creative_result', { ...input, operationId: failedId }, new AbortController().signal)
    expect(failed).toMatchObject({ executionState: 'not_executed', verificationState: 'verified' })
    expect(JSON.stringify(failed)).toContain('200')
    expect(owner.document).toBe(before)
    expect(operations.store.unresolved()).toHaveLength(0)

    // 失败回执也能补取；查询不得再派发放入。
    dropped = new AbortController()
    const lostFailureId = randomUUID()
    await dispatcher.call(callerId, 'place_video_edit_creative_result', { ...input, operationId: lostFailureId }, dropped.signal)
    const lostFailure = operations.store.get(lostFailureId, callerId)!
    operations.interrupted(lostFailure.requestId!, lostFailure.rendererEpoch!)
    expect(operations.store.get(lostFailureId, callerId)?.state).toBe('unknown')
    expect(await dispatcher.call(callerId, 'get_application_operation', { operationId: lostFailureId }, new AbortController().signal)).toMatchObject({ executionState: 'not_executed' })
    // 新宿主没有旧内存回执：未保留的原子放入按真实文档解除屏障。
    operations.store.save({ ...operations.store.get(lostFailureId, callerId)!, state: 'unknown', requestId: randomUUID(), rendererEpoch: randomUUID(), result: undefined })
    expect(await dispatcher.call(callerId, 'get_application_operation', { operationId: lostFailureId }, new AbortController().signal)).toMatchObject({ executionState: 'not_executed' })
    faultyName.mockRestore()

    dropped = new AbortController()
    const successId = randomUUID()
    await dispatcher.call(callerId, 'place_video_edit_creative_result', { ...input, operationId: successId }, dropped.signal)
    const lostSuccess = operations.store.get(successId, callerId)!
    operations.interrupted(lostSuccess.requestId!, lostSuccess.rendererEpoch!)
    expect(operations.store.get(successId, callerId)?.state).toBe('unknown')
    const count = owner.document.items.length
    expect(await dispatcher.call(callerId, 'get_application_operation', { operationId: successId }, new AbortController().signal)).toMatchObject({ executionState: 'completed', verificationState: 'verified' })
    expect(owner.document.items).toHaveLength(count)
    expect(owner.document.media[0].name.length).toBeLessThanOrEqual(80)
    expect(owner.document.media[0].creativeSource).toMatchObject({ recordId: 't82-result', prompt })
    // 模拟旧会话退出、回执完全消失，仅以保存文档里的原子身份与实际素材核对。
    operations.store.save({ ...operations.store.get(successId, callerId)!, state: 'unknown', requestId: randomUUID(), rendererEpoch: randomUUID(), result: undefined })
    expect(await dispatcher.call(callerId, 'get_application_operation', { operationId: successId }, new AbortController().signal)).toMatchObject({ executionState: 'completed', verificationState: 'verified' })
    expect(owner.document.items).toHaveLength(count)
    expect(await dispatcher.call(callerId, 'save_video_edit', { documentRef: input.documentRef, operationId: randomUUID() }, new AbortController().signal)).toMatchObject({ executionState: 'completed' })
    expect(operations.store.unresolved()).toHaveLength(0)
    failVideoEditSaves(true)
    const saveFailureId = randomUUID()
    expect(await dispatcher.call(callerId, 'place_video_edit_creative_result', { ...input, operationId: saveFailureId }, new AbortController().signal)).toMatchObject({ executionState: 'partial' })
    expect(await dispatcher.call(callerId, 'save_video_edit', { documentRef: input.documentRef, operationId: randomUUID() }, new AbortController().signal)).toMatchObject({ ok: false })
    failVideoEditSaves(false)
    const saveRecovery = await dispatcher.call(callerId, 'retry_application_operation_save', { originalOperationId: saveFailureId, operationId: randomUUID() }, new AbortController().signal)
    expect(saveRecovery, JSON.stringify(saveRecovery)).toMatchObject({ executionState: 'completed', verificationState: 'verified' })
    expect(operations.store.get(saveFailureId, callerId)?.state).toBe('completed')
    expect(owner.document.items).toHaveLength(count)
    expect(operations.store.unresolved()).toHaveLength(0)
  } finally {
    failVideoEditSaves(false)
    detach(); bridge.disconnect(); db.close()
    await closeVideoEditProject(id)
    vi.restoreAllMocks(); uninstallHarnessNativeStorage(); vi.unstubAllGlobals()
  }
}, 15_000)

async function removePiFixtureDirectory(directory: string): Promise<void> {
  if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('henji-pi-mcp-')) {
    throw new Error('临时会话目录越界')
  }
  await fs.rm(directory, { recursive: true, force: true })
}
