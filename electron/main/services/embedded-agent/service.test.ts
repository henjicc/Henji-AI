import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EmbeddedAgentPrompt } from '../../../../src/core/assistant/embeddedAgent'
import type { EngineCommand } from './contracts'

const mocks = vi.hoisted(() => ({ fork: vi.fn(), resolveModel: vi.fn(), prepare: vi.fn(), close: vi.fn() }))
vi.mock('electron', () => ({ utilityProcess: { fork: mocks.fork } }))
vi.mock('../../ipc/mcp', () => ({ createEmbeddedApplicationClient: () => ({ catalog: () => [], close: mocks.close }) }))
vi.mock('../system', () => ({ getAppLocalDataDir: () => '/fixture' }))
vi.mock('../../window', () => ({ getMainWindow: () => undefined }))
vi.mock('../assistant/user-instructions', () => ({ getAssistantUserInstructions: async () => ({ content: '' }) }))
vi.mock('../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), error: vi.fn() }) }))
vi.mock('./models', () => ({ resolveEmbeddedModel: mocks.resolveModel }))
vi.mock('./attachments', () => ({ prepareEmbeddedAttachments: mocks.prepare }))
import { EmbeddedAgentService, withGenerationOrigin } from './service'

it('默认生成落点固定为消息原项目，明确目标优先，非画布不借用后台项目', () => {
  const context = JSON.stringify({ workspace: { id: 'nodes' }, project: { id: 'original', selectedNodeId: 'reference' } })
  expect(withGenerationOrigin('create_visible_generation_task', { prompt: '图' }, context)).toMatchObject({ destination: { mode: 'canvas', projectId: 'original', sourceNodeIds: ['reference'] } })
  const explicit = { destination: { mode: 'history' } }
  expect(withGenerationOrigin('create_visible_generation_task', explicit, context)).toBe(explicit)
  expect(withGenerationOrigin('prepare_generation_task', {}, JSON.stringify({ workspace: { id: 'tools' }, project: { id: 'background' } }))).toEqual({ destination: { mode: 'history' } })
  expect(withGenerationOrigin('read_application_entity', {}, context)).toEqual({})
})

function setup() {
  const child = new EventEmitter() as EventEmitter & { postMessage: (value: { id: string; command: EngineCommand }) => void; kill: () => void }
  const prompts: string[] = []
  let active: string | undefined
  let cancelId: string | undefined
  const reply = (id: string) => child.emit('message', { type: 'result', id })
  child.postMessage = ({ id, command }) => {
    if (command.action === 'prompt') { prompts.push(command.input.text); active = id }
    else if (command.action === 'cancel') { cancelId = id }
    else queueMicrotask(() => reply(id))
  }
  child.kill = () => child.emit('exit', 0)
  mocks.fork.mockReturnValue(child)
  mocks.resolveModel.mockResolvedValue({})
  mocks.prepare.mockResolvedValue([])
  const service = new EmbeddedAgentService()
  const send = (text: string, delivery: EmbeddedAgentPrompt['delivery'] = 'wait') => service.prompt({ text, delivery,
    model: { providerId: 'test', modelId: 'fixture' }, access: 'read', context: '' })
  const finish = () => { if (active) { reply(active); active = undefined } }
  return { service, send, prompts, finish, finishCancel: () => { finish(); if (cancelId) { reply(cancelId); cancelId = undefined } } }
}
afterEach(() => { vi.clearAllMocks() })

describe('内置助手消息调度', () => {
  it('退出时不启动等待消息或重新创建运行进程', async () => {
    const f = setup()
    await f.send('当前消息')
    await vi.waitFor(() => expect(f.prompts).toHaveLength(1))
    await f.send('等待消息')
    f.service.dispose()
    await vi.waitFor(() => expect(f.service.snapshot().busy).toBe(false))
    expect(f.prompts).toEqual(['当前消息'])
    expect(mocks.fork).toHaveBeenCalledTimes(1)
    await expect(f.send('退出后消息')).rejects.toThrow('助手已关闭')
  })
  it('接收即返回，等待消息按顺序发送且 busy 不提前结束', async () => {
    const f = setup()
    await f.send('第一条')
    await vi.waitFor(() => expect(f.prompts).toEqual(['第一条']))
    await f.send('第二条'); await f.send('第三条')
    expect(f.service.snapshot().pendingMessages?.map(item => item.text)).toEqual(['第二条', '第三条'])
    expect(f.prompts).toEqual(['第一条'])
    f.finish()
    await vi.waitFor(() => expect(f.prompts).toEqual(['第一条', '第二条']))
    expect(f.service.snapshot().busy).toBe(true)
    f.finish()
    await vi.waitFor(() => expect(f.prompts).toHaveLength(3))
    f.finish()
    await vi.waitFor(() => expect(f.service.snapshot().busy).toBe(false))
  })
  it('打断先停止原请求，再优先发送插入消息，保留等待消息', async () => {
    const f = setup()
    await f.send('原请求')
    await vi.waitFor(() => expect(f.prompts).toHaveLength(1))
    await f.send('等待消息'); await f.send('插入消息', 'interrupt')
    expect(f.prompts).toEqual(['原请求'])
    expect(f.service.snapshot().pendingMessages?.map(item => item.text)).toEqual(['插入消息', '等待消息'])
    f.finishCancel()
    await vi.waitFor(() => expect(f.prompts).toEqual(['原请求', '插入消息']))
    f.finish()
    await vi.waitFor(() => expect(f.prompts).toEqual(['原请求', '插入消息', '等待消息']))
    f.finish()
    await vi.waitFor(() => expect(f.service.snapshot().busy).toBe(false))
  })
  it('准备失败保留消息供恢复，后续消息仍能发送', async () => {
    const f = setup()
    mocks.prepare.mockRejectedValueOnce(new Error('附件不可读取'))
    await f.send('带附件的消息'); await f.send('后续消息')
    await vi.waitFor(() => expect(f.prompts).toEqual(['后续消息']))
    expect(f.service.snapshot().pendingMessages).toEqual([expect.objectContaining({ text: '带附件的消息', error: '附件不可读取' })])
    f.finish()
    await vi.waitFor(() => expect(f.service.snapshot().busy).toBe(false))
    await f.service.navigate({ action: 'new' })
    expect(f.service.snapshot().pendingMessages).toEqual([])
  })
})
