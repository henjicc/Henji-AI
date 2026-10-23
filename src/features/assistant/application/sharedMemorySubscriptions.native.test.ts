import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import type { IpcMainInvokeEvent } from 'electron'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemorySnapshot } from '@/core/assistant/memoryEntries'
import type { MemoryWrite } from '@/core/assistant/memoryOperations'
import type { LocalHostRequest } from '@/core/application-control/localHostContracts'
import type { MemoryEntryStore } from '../../../../electron/main/services/assistant/entry-store'

if (!process.versions.electron) throw new Error('三层记忆订阅测试必须使用 Electron 原生 SQLite 运行器。')

type IpcReply = { ok: true; data: MemorySnapshot } | { ok: false; error: { message: string } }
const boundary = vi.hoisted(() => ({ store: undefined as MemoryEntryStore | undefined,
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
  getMemoryState: () => invoke('assistant:memory:getState'),
  writeMemory: (input: MemoryWrite) => invoke('assistant:memory:write', input),
} }) }))

import { MemoryEntryStore as MemoryStore } from '../../../../electron/main/services/assistant/entry-store'
import { replaceAssistantMemoryTablesV22 } from '../../../../electron/main/services/assistant/storageSchema'
import { registerAssistantIpc } from '../../../../electron/main/ipc/assistant'
import { McpConnections } from '../../../../electron/main/services/mcp/connections'
import { ApplicationHostBridge } from '../../../../electron/main/services/application-runtime/applicationHostBridge'
import { LocalMcpServer } from '../../../../electron/main/services/mcp/server'
import { createMemoryRegistrations } from './memoryReflection'
vi.mock('@/features/videoEdit/application/videoEditStyleLibrary', () => ({ videoEditStyleLibrary: {} }))

const ref = { kind: 'assistant.memory_settings', id: 'singleton' }
const uri = 'henji://entity/assistant.memory_settings/singleton'
const frame = { url: 'file:///fixture/index.html' }
const event = { sender: { mainFrame: frame }, senderFrame: frame } as unknown as IpcMainInvokeEvent
async function invoke(channel: string, input?: unknown): Promise<MemorySnapshot> {
  const handler = boundary.handlers.get(channel)
  if (!handler) throw new Error(`IPC 未注册：${channel}`)
  const reply = await handler(event, input)
  if (!reply.ok) throw new Error(reply.error.message)
  return reply.data
}

describe('三层记忆权威事件与现代 MCP 订阅', () => {
  let database: Database.Database
  let store: MemoryStore
  const closers: Array<() => Promise<void>> = []
  beforeEach(() => {
    vi.stubEnv('ELECTRON_RENDERER_URL', '')
    database = new Database(':memory:')
    replaceAssistantMemoryTablesV22(database)
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
    const registration = createMemoryRegistrations()[0]
    host.register({ rendererEpoch: randomUUID(), attachmentSequence: 1, ready: true, tools: [],
      domains: [{ id: 'memory', readable: true, writable: true, entities: [{ id: ref.kind, title: '三层记忆', writableProperties: 1, creatable: false, removable: false }] }],
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
      const client = new Client({ name: '三层记忆回归', version: '1' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } })
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

  it('IPC逐条写入、撤回通知现代MCP，初始化包含全局快照', async () => {
    const write: MemoryWrite = { target: { layer: 'global' }, id: 'font', expectedRevision: 0, actor: 'assistant', reason: '用户明确要求。', entry: { section: 'creative', content: '中文默认思源黑体。', source: 'assistant' } }
    await invoke('assistant:memory:write', write)
    const f = await fixture(); const a = await f.connect([uri]); const none = await f.connect([])
    expect(a.client.getInstructions()).toContain('中文默认思源黑体。')
    expect(a.client.getInstructions()).toContain('每个新任务先读取')
    const before = store.read()
    store.revert(before.history[0].id, 'user')
    await vi.waitFor(() => expect(a.updated).toHaveBeenCalledOnce(), { timeout: 2000 })
    expect(none.updated).not.toHaveBeenCalled()
    expect(store.read().entries).toEqual([])
    expect(store.read().history).toHaveLength(2)
  })
  it('策略拒绝与SQLite失败不发通知、不推进修订', async () => {
    const listener = vi.fn(); store.onMemoryChange(listener)
    const before = store.read()
    const write: MemoryWrite = { target: { layer: 'global' }, id: 'font', expectedRevision: 0, actor: 'user', reason: '用户指定。', entry: { section: 'creative', content: '中文默认思源黑体。', source: 'user' } }
    await expect(invoke('assistant:memory:write', { ...write, entry: { ...write.entry, content: 'api_key=sk-abcdefghijklmnopqrstuvwxyz123456' } })).rejects.toThrow()
    database.exec("CREATE TRIGGER reject_memory_write BEFORE UPDATE ON assistant_memory BEGIN SELECT RAISE(ABORT, 'fixture write failed'); END")
    await expect(invoke('assistant:memory:write', write)).rejects.toThrow('fixture write failed')
    expect(store.read()).toEqual(before)
    expect(listener).not.toHaveBeenCalled()
  })
})
