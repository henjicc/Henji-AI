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
// Settings are an isolated storage boundary; never read the user's actual payment preferences.
vi.mock('../../../electron/main/services/settings/store', () => ({ getSettingsStore: () => ({ get: () => null, set: () => { throw new Error('此测试未授权写入设置') } }) }))
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
    onRequest: (value) => { handler = value; return () => {} }, reviewOperations: async () => ({ items: [] }), onReviews: () => () => {}, onCancel: () => () => {}, onRevoke: () => () => {},
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

      // t168 外部客户端契约：仅替换像素/媒体仓库边界，MCP、反射、Session 与账本均真实。
      const video = await import('@/features/videoEdit/application/videoEditService')
      const observation = await import('@/features/videoEdit/application/videoEditFrameObservation')
      const mediaResources = await import('../../../electron/main/services/application-runtime/mediaResources')
      const { getPlatform } = await import('@/platform/runtime')
      const createdVideo = await client.callTool({ name: 'create_document', arguments: { operationId: randomUUID(), kind: 'video_edit', name: 'MCP 未打开剪辑' } })
      expect(createdVideo.isError, JSON.stringify(createdVideo)).toBe(false)
      const documentRef = (createdVideo.structuredContent as { result: { data: { resultRef: { id: string } } } }).result.data.resultRef
      const createSequence = { operationId: randomUUID(), summary: '后台创建主序列', changes: [{ kind: 'create_items', entityType: 'video_edit.sequence',
        parent: { kind: 'video_edit.document', id: documentRef.id }, items: [{ properties: {
          'video_edit.sequence.name': '主序列', 'video_edit.sequence.frame_rate': { numerator: 30, denominator: 1 },
        } }] }] }
      // 只在文档 I/O 边界模拟一次未打开文档的读取失败，业务执行尚未开始。
      const unavailable = vi.spyOn(harnessDocumentStore(), 'readDocument').mockRejectedValueOnce(new Error('目标剪辑暂不可读取'))
      try {
        const rejected = await client.callTool({ name: 'change_application_entities', arguments: createSequence })
        expect(JSON.stringify(rejected)).toContain('目标剪辑暂不可读取')
        expect(rejected.structuredContent, JSON.stringify(rejected)).toMatchObject({ executionState: 'not_executed' })
        const fact = await client.callTool({ name: 'get_application_operation', arguments: { operationId: createSequence.operationId } })
        expect(fact.structuredContent).toMatchObject({ executionState: 'not_executed' })
      } finally { unavailable.mockRestore() }
      const createdSequence = await client.callTool({ name: 'change_application_entities', arguments: createSequence })
      expect(createdSequence.structuredContent, JSON.stringify(createdSequence)).toMatchObject({ executionState: 'completed' })
      // t169：完整证据/修订选项仅改变交付，不进入幂等摘要，也不重放已创建序列。
      const detailedSequence = await client.callTool({ name: 'change_application_entities', arguments: { ...createSequence, includeEvidence: true, includeRevisions: true } })
      const compactReceipt = createdSequence.structuredContent as { revision: number; scopeRevisions: Record<string, number>; result: { data: Record<string, unknown> } }
      const detailedReceipt = detailedSequence.structuredContent as typeof compactReceipt
      expect(detailedSequence.isError, JSON.stringify(detailedSequence)).toBe(false)
      expect(compactReceipt.scopeRevisions).toEqual({ video_edit: detailedReceipt.scopeRevisions.video_edit })
      expect(compactReceipt.revision).toBe(detailedReceipt.revision)
      expect(compactReceipt.result.data).not.toHaveProperty('evidence')
      expect(detailedReceipt.result.data).toHaveProperty('evidence')
      expect(detailedReceipt.scopeRevisions).toHaveProperty('canvas')
      expect(operations.store.get(createSequence.operationId, identity.id)?.input).not.toHaveProperty('includeRevisions')
      const owner = await video.openVideoEditDocument(documentRef, { focus: false })
      expect(owner.document.sequences).toHaveLength(1)
      const sequenceRef = { kind: 'video_edit.sequence', id: `${owner.document.id}:${owner.document.sequences[0].id}` }
      expect(useNavigationStore.getState().activeWorkspace).toBe('nodes')
      expect(video.activeVideoEditInstance()).toBeUndefined()
      const asset = { id: 'mcp-observed-frame', filePath: path.join(os.tmpdir(), 'private', 'frame.png'), displayUrl: '', mediaType: 'image' as const, displayName: '观察画面', source: 'video-edit' as const, mimeType: 'image/png', sizeBytes: 4, width: 320, height: 180, durationSeconds: 0, thumbnailPath: null, thumbnailUrl: null, inspectionStatus: 'ready' as const, inspectionError: null, fileModifiedAt: 1, contentIdentity: 'd'.repeat(64), lastUsedAt: null, createdAt: 1, updatedAt: 1, tags: [], libraryIds: [] }
      const observe = vi.spyOn(observation, 'observeVideoEditFrame').mockResolvedValue({ asset, byteLength: 4, width: 320, height: 180, sourceWidth: 320, sourceHeight: 180, documentRevision: 0, documentVersion: 'renderer:document:0' })
      const inspect = vi.spyOn(getPlatform().assetLibrary, 'inspectAsset').mockResolvedValue(asset)
      const jpeg = await (await import('sharp')).default({ create: { width: 32, height: 18, channels: 3, background: { r: 0, g: 0, b: 0 } } }).jpeg().toBuffer()
      const media = vi.spyOn(mediaResources, 'readApplicationMediaResource').mockResolvedValue({ mode: 'image', mimeType: 'image/jpeg', base64: jpeg.toString('base64'), width: 32, height: 18, offset: 0, byteLength: jpeg.length, totalBytes: jpeg.length, eof: true })
      try {
        const frame = await client.callTool({ name: 'observe_video_edit_frame', arguments: { documentRef: { kind: 'video_edit.document', id: owner.document.id }, target: { kind: 'program', frame: 0 } } })
        expect(frame.isError, JSON.stringify(frame)).toBe(false)
        expect(JSON.stringify(frame)).toContain(asset.id)
        const image = await client.callTool({ name: 'read_application_media', arguments: { ref: { kind: 'asset', id: asset.id }, mode: 'image' } })
        expect(image.isError, JSON.stringify(image)).toBe(false)
        expect(image.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'image', mimeType: 'image/jpeg', data: jpeg.toString('base64') })]))
        expect(JSON.stringify(image.structuredContent)).not.toContain(jpeg.toString('base64'))
        expect(JSON.stringify(image)).not.toContain(asset.filePath)
        expect(media).toHaveBeenCalledWith(expect.objectContaining({ mode: 'image' }), false)
        const compact = await client.callTool({ name: 'describe_application_entities', arguments: { domains: ['video_edit'] } })
        expect(compact.isError, JSON.stringify(compact)).toBe(false)
        const catalog = (compact.structuredContent as { data: { properties: Array<Record<string, unknown>>; nextCursor: string | null } }).data
        expect(catalog.properties.length).toBeLessThanOrEqual(40)
        expect(catalog.nextCursor).toBeTruthy()
        expect(JSON.stringify(compact).length).toBeLessThan(25000)
        expect(catalog.properties[0]).toHaveProperty('valueShape')
        expect(catalog.properties[0]).not.toHaveProperty('value')
        const shape = await client.callTool({ name: 'describe_application_entities', arguments: { entityType: 'video_edit.sequence', propertyIds: ['video_edit.sequence.frame_rate'], detail: 'full' } })
        expect(JSON.stringify(shape)).toContain('numerator')
        expect(JSON.stringify(shape)).toContain('denominator')
        const read = await client.callTool({ name: 'read_application_entity', arguments: { ref: sequenceRef, propertyIds: ['video_edit.sequence.frame_rate'] } })
        expect(read.isError, JSON.stringify(read)).toBe(false)
        const baseline = read.structuredContent as { baselineId: string; data: { revisions: Record<string, number> } }
        expect(operations.store.readBaseline(baseline.baselineId, identity.id)).toMatchObject({ refs: [sequenceRef], revisions: baseline.data.revisions })
        await video.closeVideoEditProject(owner.document.id)
        const wrong = await client.callTool({ name: 'change_application_entities', arguments: { operationId: randomUUID(), summary: '修改帧率', changes: [{ kind: 'set_properties', entityType: sequenceRef.kind, target: sequenceRef, properties: { 'video_edit.sequence.frame_rate': 60 } }] } })
        expect(wrong.structuredContent, JSON.stringify(wrong)).toMatchObject({ executionState: 'not_executed' })
        expect(JSON.stringify(wrong)).toContain('video_edit.sequence.frame_rate')
        expect(JSON.stringify(wrong)).toContain('numerator')
        expect(JSON.stringify(wrong)).toContain('denominator')
        const fresh = await client.callTool({ name: 'read_application_entity', arguments: { ref: sequenceRef, propertyIds: ['video_edit.sequence.frame_rate'] } })
        expect(fresh.isError, JSON.stringify(fresh)).toBe(false)
        await video.closeVideoEditProject(owner.document.id)
        const changed = await client.callTool({ name: 'change_application_entities', arguments: { operationId: randomUUID(), summary: '修改帧率', changes: [{ kind: 'set_properties', entityType: sequenceRef.kind, target: sequenceRef, properties: { 'video_edit.sequence.frame_rate': { numerator: 60, denominator: 1 } } }] } })
        expect(changed.structuredContent, JSON.stringify(changed)).toMatchObject({ executionState: 'completed' })
        expect((await video.openVideoEditDocument(documentRef, { focus: false })).document.sequences[0].frameRate).toEqual({ numerator: 60, denominator: 1 })
      } finally { observe.mockRestore(); inspect.mockRestore(); media.mockRestore(); await video.closeVideoEditProject(owner.document.id) }

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
    const excluded = await client.callTool({ name: 'change_application_entities', arguments: { operationId: randomUUID(), baselineIds, summary: '越界写入', changes: [{ kind: 'set_properties', entityType: 'image_edit.preview', target: { kind: 'image_edit.preview', id: 'preview-1' }, properties: { name: 'x' } }] } })
    expect(excluded.isError).toBe(true)
    expect(JSON.stringify(excluded)).toContain('不属于公开业务写入范围')
    expect(JSON.stringify(excluded)).toContain('describe_application_contract')
    expect(bridge.writableEntityTypes().has('settings.registry')).toBe(true)
    expect(bridge.writableEntityTypes().has('image_edit.preview')).toBe(false)

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
    onRequest: value => { handler = value; return () => {} }, reviewOperations: async () => ({ items: [] }), onReviews: () => () => {}, onCancel: () => () => {}, onRevoke: () => () => {},
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

it.each(['external', 'embedded'] as const)('%s：真实字幕能力弹窗不挂起工具，查询和确认/拒绝共用原 SQLite 操作', async callerKind => {
  const dom = new JSDOM('', { url: 'http://localhost' })
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('navigator', dom.window.navigator); vi.stubGlobal('localStorage', dom.window.localStorage)
  const { installHarnessNativeStorage, uninstallHarnessNativeStorage } = await import('@/tests/harnessNativeStorage')
  const { createVideoEditTestProject } = await import('@/features/videoEdit/application/videoEditDocumentTestKit')
  const { editVideoProject, closeVideoEditProject, videoEditBusyReason } = await import('@/features/videoEdit/application/videoEditService')
  const { loadAudioEditProject, resetAudioEditProjectInstancesForTests } = await import('@/features/audioEdit/application/audioEditProjectInstances')
  const { useAlertDialogStore } = await import('@/stores/alertDialogStore')
  const { getPlatform } = await import('@/platform/runtime')
  const { attachLocalApplicationHost } = await import('./localApplicationHost')
  const { executePiTool } = await import('../../../electron/main/services/embedded-agent/toolResult')
  const { default: i18n } = await import('@/i18n')
  const previousLanguage = i18n.language
  await i18n.changeLanguage(callerKind === 'external' ? 'en-US' : 'zh-CN')
  installHarnessNativeStorage()
  const fileContent = { sizeBytes: 4096, fileModifiedAt: 1000, contentIdentity: 'a'.repeat(64) }
  vi.spyOn(getPlatform().assetLibrary, 'inspectFileContent').mockResolvedValue(fileContent)
  const owner = await createVideoEditTestProject()
  editVideoProject(owner.document.id, document => {
    document.media.push({ id: 'audio', name: '声音', kind: 'audio', path: 'D:/voice.wav', durationSeconds: 12, width: 0, height: 0, assetContent: fileContent })
    document.items.push({ id: 'audio-item', name: '声音', kind: 'audio', mediaId: 'audio' })
    document.sequences[0].clips.push({ id: 'voice', itemId: 'audio-item', name: '声音', kind: 'audio', start: 0, duration: 300, track: 0, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '' })
    return document
  })
  const audio = getPlatform().audioEdit
  vi.spyOn(audio, 'probeSource').mockResolvedValue({ mediaType: 'audio', sourcePath: 'D:/voice.wav', audioPath: 'D:/voice.wav', sampleRate: 1000, channels: 1, durationFrames: 12000 })
  vi.spyOn(audio, 'listAsrModels').mockResolvedValue([{ id: 'test-asr', providerId: 'test', timestamps: true, configured: true, longAudio: true }])
  vi.spyOn(audio, 'listTasks').mockResolvedValue([])
  vi.spyOn(audio, 'preflightTranscription').mockResolvedValue({ modelId: 'test-asr', requiresConfirmation: true })
  // This test exercises real approval/SQLite persistence; only the acoustic decode boundary is simulated.
  vi.spyOn(audio, 'detectSilence').mockResolvedValue({ revision: 0, suggestions: [], energy: { resolutionMs: 10, thresholdDb: -50, highThresholdDb: -70, pauses: [] } })
  const transcribe = vi.spyOn(audio, 'transcribe').mockImplementation(async request => {
    const project = await loadAudioEditProject(request.projectId)
    return { project: { ...project.document, transcript: [{ id: 'word', text: 'Hello', startFrame: 0, endFrame: 1000, included: true, locked: false, granularity: 'word' }] }, modelId: 'test-asr', granularity: 'word' }
  })
  const connections = new McpConnections({ read: () => null, write: () => {} })
  const identity = connections.create('确认回执测试', { allowWrites: true, allowPaid: true })
  const db = new Database(':memory:'); createApplicationOperationTablesV1(db)
  const operations = new ApplicationOperationCoordinator(new ApplicationOperationStore(db), undefined, () => bridge.writableEntityTypes())
  const bridge: ApplicationHostBridge = new ApplicationHostBridge(id => connections.assertActive(id), operations)
  let handler: (request: LocalHostRequest) => void = () => {}
  let cancel: (id: string) => void = () => {}
  const pendingSubtitles = new Set<string>()
  const detach = attachLocalApplicationHost({
    publishContext: async value => bridge.publishContext(value), onRequest: value => { handler = value; return () => {} },
    reviewOperations: async () => ({ items: [] }), onReviews: () => () => {}, onCancel: value => { cancel = value; return () => {} }, onRevoke: () => () => {},
    registerHost: async value => bridge.register(value, { send: (channel, payload) => {
      if (channel === 'application:host:request') {
        const request = payload as LocalHostRequest
        if (request.capabilityId === 'generate_video_edit_subtitles') pendingSubtitles.add(request.requestId)
        handler(request)
      }
      if (channel === 'application:host:cancel') cancel(payload as string)
    } }), complete: async value => {
      const result = bridge.complete(value)
      if (!value.progress) pendingSubtitles.delete(value.requestId)
      return result
    },
  }, true)
  const dispatcher = new ApplicationToolDispatcher({ assertActive: id => connections.assertActive(id), access: id => connections.access(id) }, bridge, operations, 0, callerKind)
  const server = new LocalMcpServer(connections, bridge, undefined, operations)
  const client = new Client({ name: '确认测试', version: '1' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } })
  try {
    await server.start(0)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.listeningPort}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${connections.token(identity.id)}` } } }))
    await client.listTools()
    const args = { documentRef: { kind: 'video_edit.document', id: owner.document.id }, sequenceRef: { kind: 'video_edit.sequence', id: `${owner.document.id}:${owner.document.sequences[0].id}` }, clipRef: { kind: 'video_edit.clip', id: `${owner.document.id}:voice` }, originalText: 'Hello', timeSource: 'auto' }
    for (const decision of ['confirm', 'reject', 'cancel'] as const) {
      const accepted = decision === 'confirm'
      const operationId = randomUUID()
      let returned = false
      const invoke = callerKind === 'external'
        ? client.callTool({ name: 'generate_video_edit_subtitles', arguments: { ...args, operationId } }).then(result => { expect(result.isError).toBe(false); return result.structuredContent })
        : executePiTool({ id: randomUUID(), name: 'generate_video_edit_subtitles', args: { ...args, operationId }, vision: false }, (_id, name, input) => dispatcher.call(identity.id, name, input, new AbortController().signal)).then(result => {
          const content = result.content[0]; if (content.type !== 'text') throw new Error('缺少回执'); return JSON.parse(content.text) as Record<string, unknown>
        })
      const pending = invoke.then(result => { returned = true; return result })
      await vi.waitFor(() => expect(returned).toBe(true), { timeout: 2000 })
      const waiting = await pending
      const title = i18n.t('paidApproval.alignSpeech', { ns: 'common' })
      expect(waiting, JSON.stringify(waiting)).toMatchObject({ executionState: 'awaiting_user_confirmation', operationId, confirmation: { title } })
      await vi.waitFor(() => expect(useAlertDialogStore.getState().queue).toHaveLength(1))
      expect(useAlertDialogStore.getState().queue[0].title).toBe(title)
      const query = () => dispatcher.call(identity.id, 'get_application_operation', { operationId }, new AbortController().signal)
      expect(await query()).toMatchObject({ executionState: 'awaiting_user_confirmation' })
      expect(transcribe).toHaveBeenCalledTimes(accepted ? 0 : 1)
      const captionsBefore = owner.document.sequences[0].captions?.length ?? 0
      if (decision === 'cancel') cancel(operations.store.get(operationId, identity.id)!.requestId!)
      else if (accepted) useAlertDialogStore.getState().confirmCurrent()
      else useAlertDialogStore.getState().dismissCurrent()
      await vi.waitFor(() => expect(operations.store.get(operationId, identity.id)?.state).toBe(accepted ? 'completed' : 'not_executed'), { timeout: 3000 })
      expect(await query()).toMatchObject({ executionState: accepted ? 'completed' : 'not_executed', verificationState: 'verified' })
      expect(owner.document.sequences[0].captions?.length ?? 0).toBe(captionsBefore + (accepted ? 1 : 0))
      expect(transcribe).toHaveBeenCalledTimes(1)
      expect(useAlertDialogStore.getState().queue).toHaveLength(0)
      expect(videoEditBusyReason(owner.document.id)).toBeNull()
    }
  } finally {
    // detach aborts the host tasks, but their final replies still need the open SQLite ledger.
    detach()
    try {
      await vi.waitFor(() => {
        expect(pendingSubtitles.size).toBe(0)
        expect(useAlertDialogStore.getState().queue).toHaveLength(0)
        expect(videoEditBusyReason(owner.document.id)).toBeNull()
      })
      await resetAudioEditProjectInstancesForTests(); await closeVideoEditProject(owner.document.id)
    } finally {
      await client.close(); await server.stop(); bridge.disconnect(); db.close()
      await i18n.changeLanguage(previousLanguage)
      vi.restoreAllMocks(); uninstallHarnessNativeStorage(); vi.unstubAllGlobals()
      dom.window.close()
    }
  }
}, 15_000)
