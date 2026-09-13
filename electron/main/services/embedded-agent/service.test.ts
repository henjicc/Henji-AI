vi.mock('./skills', () => ({ embeddedSkillCatalog: mocks.skills, callEmbeddedSkill: mocks.loadSkill }))
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EmbeddedAgentPrompt } from '../../../../src/core/assistant/embeddedAgent'
import type { EngineCommand } from './contracts'

const mocks = vi.hoisted(() => ({ skills: vi.fn(), loadSkill: vi.fn(), fork: vi.fn(), resolveModel: vi.fn(), prepare: vi.fn(), close: vi.fn(), call: vi.fn(), info: vi.fn(), error: vi.fn() }))
vi.mock('electron', () => ({ utilityProcess: { fork: mocks.fork } }))
vi.mock('../../ipc/mcp', () => ({ createEmbeddedApplicationClient: () => ({ catalog: () => [], close: mocks.close, call: mocks.call }) }))
vi.mock('../system', () => ({ getAppLocalDataDir: () => '/fixture' }))
vi.mock('../../window', () => ({ getMainWindow: () => undefined }))
vi.mock('../assistant/user-instructions', () => ({ getAssistantUserInstructions: async () => ({ content: '' }) }))
vi.mock('../logging', () => ({ createMainLogger: () => ({ info: mocks.info, error: mocks.error }) }))
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

it.each(['prepare_generation_task', 'create_visible_generation_task'])('%s 未选中节点时使用发送时的位置，选中和明确目标仍优先', name => {
  const origin = { workspace: { id: 'nodes' }, project: { id: 'original', viewportNodePosition: { x: 90, y: -20 } } }
  expect(withGenerationOrigin(name, {}, JSON.stringify(origin))).toMatchObject({
    destination: { projectId: 'original', sourceNodeIds: [], placement: { mode: 'absolute', x: 90, y: -20 } },
  })
  expect(withGenerationOrigin(name, {}, JSON.stringify({ ...origin, project: { ...origin.project, selectedNodeId: 'anchor' } })))
    .toEqual({ destination: { mode: 'canvas', projectId: 'original', sourceNodeIds: ['anchor'] } })
  expect(withGenerationOrigin(name, {}, JSON.stringify({ ...origin, project: { ...origin.project, selectedNodeId: 'anchor', selectedNodeIsReference: false } })))
    .toEqual({ destination: { mode: 'canvas', projectId: 'original', sourceNodeIds: [], placement: { mode: 'right_of_node', anchorNodeId: 'anchor' } } })
  const explicit = { destination: { mode: 'canvas', projectId: 'specified', sourceNodeIds: [], placement: { mode: 'absolute', x: 1, y: 2 } } }
  expect(withGenerationOrigin(name, explicit, JSON.stringify(origin))).toBe(explicit)
  expect(withGenerationOrigin(name, {}, JSON.stringify({ ...origin, project: { ...origin.project, viewportNodePosition: { x: null, y: 4 } } })))
    .toEqual({ destination: { mode: 'canvas', projectId: 'original', sourceNodeIds: [] } })
})

it('已有生成结果导入沿用原选中对象或原视口，显式落点与其他项目保持优先', () => {
  const name = 'add_generation_result_to_canvas'
  const input = { resultRef: { kind: 'generation.result', id: 'saved' } }
  const origin = { workspace: { id: 'nodes' }, project: { id: 'original', viewportNodePosition: { x: 90, y: -20 } } }
  expect(withGenerationOrigin(name, input, JSON.stringify(origin))).toEqual({ ...input, projectId: 'original', placement: { mode: 'absolute', x: 90, y: -20 } })
  expect(withGenerationOrigin(name, { ...input, projectId: 'original' }, JSON.stringify({ ...origin,
    project: { ...origin.project, selectedNodeId: 'selected', selectedNodeIsReference: true } })))
    .toMatchObject({ placement: { mode: 'right_of_node', anchorNodeId: 'selected' } })
  const explicit = { ...input, projectId: 'original', placement: { mode: 'absolute', x: 1, y: 2 } }
  expect(withGenerationOrigin(name, explicit, JSON.stringify(origin))).toEqual(explicit)
  const other = { ...input, projectId: 'another-project' }
  expect(withGenerationOrigin(name, other, JSON.stringify(origin))).toBe(other)
  expect(withGenerationOrigin(name, input, JSON.stringify({ ...origin, workspace: { id: 'tools' } }))).toBe(input)
  expect(withGenerationOrigin(name, input, 'null')).toBe(input)
})

function setup() {
  mocks.skills.mockResolvedValue({ tools: [], instructions: '' })
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
  return { service, send, prompts, finish, child, finishCancel: () => { finish(); if (cancelId) { reply(cancelId); cancelId = undefined } } }
}
afterEach(() => { vi.clearAllMocks() })

describe('内置助手消息调度', () => {
  it('准备期间停止保留用户气泡，不把尚未发送的消息丢弃', async () => {
    const f = setup()
    let resolveModel!: (value: object) => void
    mocks.resolveModel.mockImplementationOnce(() => new Promise(resolve => { resolveModel = resolve }))
    await f.send('立即停止')
    await vi.waitFor(() => expect(resolveModel).toBeTypeOf('function'))
    const cancel = f.service.cancel()
    resolveModel({})
    f.finishCancel()
    await cancel
    await vi.waitFor(() => expect(f.service.snapshot().busy).toBe(false))
    expect(f.service.snapshot().pendingMessages).toEqual([expect.objectContaining({ text: '立即停止', error: '已停止发送' })])
    expect(f.prompts).toEqual([])
    f.service.dispose()
  })
  it('冷启动准备期间保留当前消息，正式用户消息到达后不重复展示', async () => {
    const f = setup()
    let resolveModel!: (value: object) => void
    mocks.resolveModel.mockImplementationOnce(() => new Promise(resolve => { resolveModel = resolve }))
    await f.send('立即看到气泡')
    await vi.waitFor(() => expect(resolveModel).toBeTypeOf('function'))
    expect(f.service.snapshot().sendingMessage?.text).toBe('立即看到气泡')
    resolveModel({})
    await vi.waitFor(() => expect(f.prompts).toHaveLength(1))
    f.child.emit('message', { type: 'snapshot', value: { sessionId: 'session', busy: true, activity: null, error: null,
      messages: [{ id: 'user', role: 'user', text: '立即看到气泡' }] } })
    expect(f.service.snapshot().sendingMessage).toBeUndefined()
    f.finish()
    await vi.waitFor(() => expect(f.service.snapshot().busy).toBe(false))
    f.service.dispose()
  })
  it('主进程注入技能索引并把读取交给正式技能入口，不调用应用写入工具', async () => {
    const f = setup()
    mocks.skills.mockResolvedValue({ tools: [{ name: 'load_assistant_skill', inputSchema: {} }], instructions: 'skills_index: prompt-optimization' })
    const post = vi.spyOn(f.child, 'postMessage')
    await f.send('优化提示词')
    await vi.waitFor(() => expect(f.prompts).toHaveLength(1))
    const config = post.mock.calls.map(([value]) => value.command).find(command => command.action === 'configure')
    expect(config).toMatchObject({ input: { tools: [{ name: 'load_assistant_skill' }], instructions: expect.stringContaining('skills_index: prompt-optimization') } })
    const original = f.child.postMessage
    f.child.postMessage = vi.fn()
    mocks.loadSkill.mockResolvedValue({ isError: false, structuredContent: { content: '技能正文' } })
    f.child.emit('message', { type: 'tool', id: 'skill', name: 'load_assistant_skill', input: { name: 'prompt-optimization', reason: '图片' } })
    await vi.waitFor(() => expect(f.child.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'toolResult', id: 'skill' })))
    expect(mocks.loadSkill).toHaveBeenCalledWith({ name: 'prompt-optimization', reason: '图片' }, expect.any(AbortSignal))
    expect(mocks.call).not.toHaveBeenCalled()
    f.child.postMessage = original
    f.finish()
    await vi.waitFor(() => expect(f.service.snapshot().busy).toBe(false))
    f.service.dispose()
  })

  it('工具失败日志关联原消息和操作，不记录工具输入正文', async () => {
    const f = setup()
    await f.send('消息正文不进日志')
    await vi.waitFor(() => expect(f.prompts).toHaveLength(1))
    const queued = mocks.info.mock.calls.find(call => call[1].event === 'embedded_agent.message.queued')![1] as { requestId: string }
    mocks.call.mockResolvedValue({ isError: true, content: [{ type: 'text', text: '拒绝' }] })
    // 工具回执不经过本测试的 command 替身。
    const postMessage = f.child.postMessage
    f.child.postMessage = vi.fn()
    f.child.emit('message', { type: 'tool', id: 'tool-call', name: 'change_application_entities', input: { operationId: 'operation-original', secret: '不可记录的输入' } })
    await vi.waitFor(() => expect(mocks.error).toHaveBeenCalledWith('内置助手工具返回失败', expect.objectContaining({
      event: 'embedded_agent.tool.failed', requestId: queued.requestId,
      context: expect.objectContaining({ toolCallId: 'tool-call', operationId: 'operation-original' }),
    })))
    expect(JSON.stringify([...mocks.info.mock.calls, ...mocks.error.mock.calls])).not.toContain('不可记录的输入')
    f.child.postMessage = postMessage
    f.finish()
    await vi.waitFor(() => expect(f.service.snapshot().busy).toBe(false))
    f.service.dispose()
  })
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
