import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import type { IpcMainInvokeEvent } from 'electron'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { SHARED_MEMORY_ID, type SharedMemorySnapshot, type SharedMemoryUpdate } from '@/core/assistant/memory'
import type { ApplicationPlannedStep } from '@/core/application-control'
import type { LocalHostRequest } from '@/core/application-control/localHostContracts'
import type { AgentMemoryStore } from '../../../../electron/main/services/assistant/memory-store'

if (!process.versions.electron) throw new Error('共享记忆订阅测试必须使用 Electron 原生 SQLite 运行器。')

type IpcReply = { ok: true; data: SharedMemorySnapshot } | { ok: false; error: { message: string } }
const boundary = vi.hoisted(() => ({ store: undefined as AgentMemoryStore | undefined,
  handlers: new Map<string, (event: IpcMainInvokeEvent, input: unknown) => Promise<IpcReply>>(),
  window: { isDestroyed: () => false },
}))
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => { throw new Error('测试禁止访问真实应用目录') } },
  ipcMain: { handle: (channel: string, handler: (event: IpcMainInvokeEvent, input: unknown) => Promise<IpcReply>) => boundary.handlers.set(channel, handler) },
  BrowserWindow: { fromWebContents: () => boundary.window },
}))
vi.mock('../../../../electron/main/window', () => ({ getMainWindow: () => boundary.window }))
vi.mock('../../../../electron/main/services/logging', () => ({ createMainLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))
vi.mock('../../../../electron/main/services/assistant/memory', () => ({
  getAgentMemoryStore: () => { if (!boundary.store) throw new Error('记忆夹具未初始化'); return boundary.store },
  clearAgentMemories: () => { throw new Error('不应调用其他 IPC') },
  updateAgentMemorySettings: () => { throw new Error('不应调用其他 IPC') },
  updateAgentMemory: () => { throw new Error('不应调用其他 IPC') },
}))
vi.mock('../../../../electron/main/services/assistant/user-instructions', () => ({}))
vi.mock('../../../../electron/main/services/assistant/skills/install', () => ({}))
vi.mock('../../../../electron/main/services/assistant/skills/registry', () => ({}))
vi.mock('../../../../electron/main/services/assistant/skills/state', () => ({}))
vi.mock('@/platform/runtime', () => ({ getPlatform: () => ({ assistant: {
  getSharedMemory: () => invoke('assistant:memory:getShared'),
  updateSharedMemory: (input: SharedMemoryUpdate) => invoke('assistant:memory:updateShared', input),
} }) }))

import { AgentMemoryStore as MemoryStore } from '../../../../electron/main/services/assistant/memory-store'
import { createAssistantMemoryTablesV1 } from '../../../../electron/main/services/assistant/storageSchema'
import { registerAssistantIpc } from '../../../../electron/main/ipc/assistant'
import { McpConnections } from '../../../../electron/main/services/mcp/connections'
import { ApplicationHostBridge } from '../../../../electron/main/services/application-runtime/applicationHostBridge'
import { LocalMcpServer } from '../../../../electron/main/services/mcp/server'
import { createSharedMemoryRegistration, SharedMemoryExecutor } from './sharedMemoryReflection'

const ref = { kind: 'assistant.shared_memory', id: 'singleton' }
const uri = 'henji://entity/assistant.shared_memory/singleton'
const textUri = 'henji://text/assistant.shared_memory/singleton'
const frame = { url: 'file:///fixture/index.html' }
const event = { sender: { mainFrame: frame }, senderFrame: frame } as unknown as IpcMainInvokeEvent
async function invoke(channel: string, input?: unknown): Promise<SharedMemorySnapshot> {
  const handler = boundary.handlers.get(channel)
  if (!handler) throw new Error(`IPC 未注册：${channel}`)
  const reply = await handler(event, input)
  if (!reply.ok) throw new Error(reply.error.message)
  return reply.data
}

describe('共享记忆权威事件与现代 MCP 订阅', () => {
  let database: Database.Database
  let store: MemoryStore
  const closers: Array<() => Promise<void>> = []
  beforeEach(() => {
    vi.stubEnv('ELECTRON_RENDERER_URL', '')
    database = new Database(':memory:')
    createAssistantMemoryTablesV1(database)
    store = new MemoryStore(database)
    boundary.store = store
    boundary.handlers.clear()
    registerAssistantIpc()
  })
  afterEach(async () => {
    for (const close of closers.reverse()) await close()
    closers.length = 0
    boundary.store = undefined
    database.close()
    vi.unstubAllEnvs()
  })

  async function fixture() {
    let saved: string | null = null
    const connections = new McpConnections({ read: () => saved, write: value => { saved = value } })
    const host = new ApplicationHostBridge(id => connections.assertActive(id))
    const registration = createSharedMemoryRegistration()
    host.register({ rendererEpoch: randomUUID(), attachmentSequence: 1, ready: true, tools: [],
      domains: [{ id: 'memory', readable: true, writable: true, entities: [{ id: ref.kind, title: '共享记忆', writableProperties: 1, creatable: false, removable: false }] }],
    }, { send(channel, payload) {
      if (channel !== 'application:host:request') return
      const request = payload as LocalHostRequest
      void registration.provider!.readEntity(request.input.ref as typeof ref, {}).then(data => {
        host.complete({ requestId: request.requestId, rendererEpoch: request.rendererEpoch, result: { ok: true, data } })
      }).catch(error => {
        host.complete({ requestId: request.requestId, rendererEpoch: request.rendererEpoch, result: { ok: false, error: { message: String(error) } } })
      })
    } })
    const errors = vi.fn()
    const server = new LocalMcpServer(connections, host, errors, undefined, undefined, undefined, store)
    await server.start(0)
    closers.push(() => server.stop())
    async function connect(uris: string[]) {
      const owner = connections.create('订阅测试客户端')
      const client = new Client({ name: '共享记忆回归', version: '1' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } })
      closers.push(() => client.close())
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.listeningPort}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${connections.token(owner.id)}` } },
      }))
      const updated = vi.fn()
      client.setNotificationHandler('notifications/resources/updated', updated)
      const subscription = await client.listen({ resourceSubscriptions: uris })
      return { client, updated, subscription }
    }
    return { server, host, connect, errors }
  }

  it('手动 IPC 保存、助手写入、撤销与补偿都通知对应资源的多客户端，未订阅者不收', async () => {
    const f = await fixture()
    const a = await f.connect([uri]); const b = await f.connect([uri, textUri])
    const textOnly = await f.connect([textUri]); const none = await f.connect([])
    async function expectUpdates(count: number) {
      await vi.waitFor(() => {
        expect(a.updated).toHaveBeenCalledTimes(count)
        expect(b.updated).toHaveBeenCalledTimes(count * 2)
        expect(textOnly.updated).toHaveBeenCalledTimes(count)
      }, { timeout: 2000 })
      expect(a.updated.mock.calls.every(([notification]) => notification.params.uri === uri)).toBe(true)
      expect(textOnly.updated.mock.calls.every(([notification]) => notification.params.uri === textUri)).toBe(true)
      expect(none.updated).not.toHaveBeenCalled()
      expect(f.errors).not.toHaveBeenCalled()
    }
    const before = await invoke('assistant:memory:getShared')
    await invoke('assistant:memory:updateShared', { content: '偏好水墨。', expectedRevision: before.revision })
    await expectUpdates(1)
    const executor = new SharedMemoryExecutor()
    const step: Extract<ApplicationPlannedStep, { kind: 'mutation' }> = { kind: 'mutation', target: ref, entityType: ref.kind,
      expectedRevisions: { assistant_memory: store.getSharedMemory().revision },
      mutations: [{ propertyId: 'assistant.shared_memory.content', operation: 'set', value: '偏好胶片。' }],
    }
    const result = await executor.apply(step)
    expect(store.getSharedMemory().content).toBe('偏好胶片。')
    await expectUpdates(2)
    await executor.undo(result.undoToken!)
    expect(store.getSharedMemory().content).toBe('偏好水墨。')
    await expectUpdates(3)
    const again = await executor.apply({ ...step, expectedRevisions: { assistant_memory: store.getSharedMemory().revision } })
    await expectUpdates(4)
    await executor.compensate(step, again)
    expect(store.getSharedMemory().content).toBe('偏好水墨。')
    await expectUpdates(5)
    await a.subscription.close()
    await invoke('assistant:memory:updateShared', { content: '偏好素描。', expectedRevision: store.getSharedMemory().revision })
    await vi.waitFor(() => expect(b.updated).toHaveBeenCalledTimes(12), { timeout: 2000 })
    expect(a.updated).toHaveBeenCalledTimes(5)
    expect(none.updated).not.toHaveBeenCalled()
  })

  it('无变化、冲突、策略拒绝和 SQLite 写入失败都不推进修订或通知', async () => {
    store.updateSharedMemory({ content: '偏好水墨。', expectedRevision: store.getSharedMemory().revision })
    const f = await fixture(); const a = await f.connect([uri])
    const before = store.getSharedMemory()
    await invoke('assistant:memory:updateShared', { content: '  偏好水墨。  ', expectedRevision: before.revision })
    await expect(invoke('assistant:memory:updateShared', { content: '覆盖', expectedRevision: before.revision - 1 })).rejects.toThrow('记忆已改变')
    await expect(invoke('assistant:memory:updateShared', { content: '字'.repeat(801), expectedRevision: before.revision })).rejects.toThrow()
    await expect(invoke('assistant:memory:updateShared', { content: 'api_key=sk-abcdefghijklmnopqrstuvwxyz123456', expectedRevision: before.revision })).rejects.toThrow()
    database.exec("CREATE TRIGGER reject_memory_write BEFORE UPDATE ON agent_memories BEGIN SELECT RAISE(ABORT, 'fixture write failed'); END")
    await expect(invoke('assistant:memory:updateShared', { content: '新偏好', expectedRevision: before.revision })).rejects.toThrow('fixture write failed')
    expect(store.getSharedMemory()).toEqual(before)
    await new Promise(resolve => setTimeout(resolve, 350))
    expect(a.updated).not.toHaveBeenCalled()
  })

  it('宿主上下文变化不覆盖记忆修订；服务停止释放监听、重启只建立一次监听', async () => {
    const detachments: Array<Mock<[], void>> = []
    const subscribe = store.onSharedMemoryChange.bind(store)
    const onChange = vi.spyOn(store, 'onSharedMemoryChange').mockImplementation(listener => {
      const detach = vi.fn(subscribe(listener)); detachments.push(detach); return detach
    })
    const f = await fixture(); const a = await f.connect([uri])
    store.updateSharedMemory({ content: '上下文前的偏好', expectedRevision: store.getSharedMemory().revision })
    await vi.waitFor(() => expect(a.updated).toHaveBeenCalledOnce(), { timeout: 2000 })
    f.host.publishContext({ schemaVersion: 'application-host/v1', rendererEpoch: f.host.rendererEpoch, revision: 1,
      scopeRevisions: { navigation: 1, surface: 1, generation: 0, canvas: 0, toolbox: 0, assets: 0 },
      workspace: { id: 'nodes', activeToolId: null }, canvas: { id: null, selectedNodeId: null }, generation: { commandReady: true },
      assets: { view: 'closed', selectedAssetId: null }, uiReady: true, capturedAt: new Date().toISOString() })
    store.updateSharedMemory({ content: '上下文后的偏好', expectedRevision: store.getSharedMemory().revision })
    await vi.waitFor(() => expect(a.updated).toHaveBeenCalledTimes(2), { timeout: 2000 })
    await f.server.stop()
    expect(onChange).toHaveBeenCalledOnce()
    expect(detachments[0]).toHaveBeenCalledOnce()
    await f.server.start(0)
    const b = await f.connect([uri])
    store.updateSharedMemory({ content: '重启后的偏好', expectedRevision: store.getSharedMemory().revision })
    await vi.waitFor(() => expect(b.updated).toHaveBeenCalledOnce(), { timeout: 2000 })
    expect(a.updated).toHaveBeenCalledTimes(2)
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('共享记忆开关、旧编辑入口、删除及清空复用同一事件，空清理和重复设置不通知', async () => {
    const f = await fixture(); const a = await f.connect([uri])
    const first = store.updateSharedMemory({ content: '原偏好', expectedRevision: store.getSharedMemory().revision })
    await vi.waitFor(() => expect(a.updated).toHaveBeenCalledTimes(1), { timeout: 2000 })
    store.update({ memoryId: SHARED_MEMORY_ID, content: '新偏好' })
    await vi.waitFor(() => expect(a.updated).toHaveBeenCalledTimes(2), { timeout: 2000 })
    expect(store.getSharedMemory().revision).toBeGreaterThan(first.revision)
    store.updateSettings({ enabled: false })
    await vi.waitFor(() => expect(a.updated).toHaveBeenCalledTimes(3), { timeout: 2000 })
    store.updateSettings({ enabled: false })
    expect(store.clear({ type: 'project', id: 'other-project' })).toBe(0)
    await new Promise(resolve => setTimeout(resolve, 350))
    expect(a.updated).toHaveBeenCalledTimes(3)
    store.delete(SHARED_MEMORY_ID)
    await vi.waitFor(() => expect(a.updated).toHaveBeenCalledTimes(4), { timeout: 2000 })
    store.updateSettings({ enabled: true })
    await vi.waitFor(() => expect(a.updated).toHaveBeenCalledTimes(5), { timeout: 2000 })
    store.updateSharedMemory({ content: '清理前偏好', expectedRevision: store.getSharedMemory().revision })
    await vi.waitFor(() => expect(a.updated).toHaveBeenCalledTimes(6), { timeout: 2000 })
    expect(store.clear()).toBe(1)
    await vi.waitFor(() => expect(a.updated).toHaveBeenCalledTimes(7), { timeout: 2000 })
    expect(store.getSharedMemory().content).toBe('')
    expect(store.clear()).toBe(0)
    await new Promise(resolve => setTimeout(resolve, 350))
    expect(a.updated).toHaveBeenCalledTimes(7)
  })

  it('高频写入沿原总线合并，冲突撤销不会覆盖新内容或多发事件', async () => {
    const f = await fixture(); const a = await f.connect([uri])
    const stale = JSON.stringify({ content: '', expectedRevision: store.getSharedMemory().revision })
    for (let index = 0; index < 20; index++) {
      store.updateSharedMemory({ content: `第 ${index} 次明确偏好`, expectedRevision: store.getSharedMemory().revision })
    }
    await vi.waitFor(() => expect(a.updated).toHaveBeenCalledOnce(), { timeout: 2000 })
    const before = store.getSharedMemory()
    await expect(new SharedMemoryExecutor().undo(stale)).rejects.toThrow('记忆已改变')
    expect(store.getSharedMemory()).toEqual(before)
    await new Promise(resolve => setTimeout(resolve, 350))
    expect(a.updated).toHaveBeenCalledOnce()
    const result = await a.client.readResource({ uri })
    const content = result.contents[0]
    if (!('text' in content)) throw new Error('记忆资源必须返回文本快照')
    expect(JSON.parse(content.text)).toMatchObject({ revisions: { assistant_memory: before.revision }, properties: { 'assistant.shared_memory.content': before.content } })
  })
})
