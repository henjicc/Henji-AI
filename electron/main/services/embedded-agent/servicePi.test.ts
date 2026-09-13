vi.mock('./skills', () => ({ embeddedSkillCatalog: async () => ({ tools: [], instructions: '' }), callEmbeddedSkill: vi.fn() }))
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { EmbeddedAgentPrompt } from '../../../../src/core/assistant/embeddedAgent'
import type { EngineCommand, EmbeddedModel } from './contracts'
import { PiEngine } from './piEngine'

const mocks = vi.hoisted(() => ({ fork: vi.fn(), client: vi.fn(), model: vi.fn(), directory: '', info: vi.fn(), error: vi.fn() }))
vi.mock('electron', () => ({ utilityProcess: { fork: mocks.fork } }))
vi.mock('../../ipc/mcp', () => ({ createEmbeddedApplicationClient: mocks.client }))
vi.mock('../system', () => ({ getAppLocalDataDir: () => mocks.directory }))
vi.mock('../../window', () => ({ getMainWindow: () => undefined }))
vi.mock('../assistant/user-instructions', () => ({ getAssistantUserInstructions: async () => ({ content: '' }) }))
vi.mock('../logging', () => ({ createMainLogger: () => ({ info: mocks.info, error: mocks.error }) }))
vi.mock('./models', () => ({ resolveEmbeddedModel: mocks.model }))
vi.mock('./attachments', () => ({ prepareEmbeddedAttachments: async () => [] }))
import { EmbeddedAgentService } from './service'

const cleanup: Array<() => Promise<void> | void> = []
afterEach(async () => { for (const close of cleanup.reverse()) await close(); cleanup.length = 0; vi.clearAllMocks() })

it.each(['model', 'tool'] as const)('宿主调度经官方 Pi SDK 在 %s 阶段打断，插入后续发等待消息且沿用各自原项目', async stage => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-service-pi-'))
  mocks.directory = directory
  cleanup.push(async () => {
    if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('henji-service-pi-')) throw new Error('测试目录越界')
    await fs.rm(directory, { recursive: true, force: true })
  })
  type Message = { role: string; content: string | Array<{ type: string; text?: string }> }
  const textOf = (message: Message) => typeof message.content === 'string' ? message.content : message.content.map(part => part.text ?? '').join('')
  const requests: string[] = []
  let originalClosed = false
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString()) as { messages: Message[]; tools: Array<{ function: { name: string } }> }
    const userIndex = body.messages.map(message => message.role).lastIndexOf('user')
    const text = textOf(body.messages[userIndex])
    requests.push(text)
    response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.flushHeaders()
    if (text === '原请求' && stage === 'model') { response.on('close', () => { originalClosed = true }); return }
    const done = body.messages.slice(userIndex + 1).some(message => message.role === 'tool' && textOf(message).includes('accepted'))
    const loaded = body.tools.some(tool => tool.function.name === 'create_visible_generation_task')
    const delta = done ? { content: '工具已返回。' } : { tool_calls: [{ index: 0, id: `call_${requests.length}`, type: 'function',
      function: loaded ? { name: 'create_visible_generation_task', arguments: JSON.stringify({ prompt: text }) }
        : { name: 'load_application_tools', arguments: JSON.stringify({ task: 'canvas_generation' }) } }] }
    for (const [value, finish] of [[delta, null], [{}, done ? 'stop' : 'tool_calls']] as const) {
      response.write(`data: ${JSON.stringify({ id: 'reply', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: value, finish_reason: finish }] })}\n\n`)
    }
    response.end('data: [DONE]\n\n')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('缺少测试端口')
  const model: EmbeddedModel = { providerId: 'test', baseUrl: `http://127.0.0.1:${address.port}/v1`, api: 'openai-completions', apiKey: 'fixture',
    model: { providerId: 'test', modelId: 'fixture', displayName: 'Fixture', adapter: 'openai-compatible', enabled: true,
      capabilities: { text: true, image: false, video: false, audio: false, streaming: true, toolCall: true, parallelTools: false,
        jsonOutput: false, structuredOutputMode: 'none', reasoning: false, sampling: true, contextWindow: 32768, maxOutputTokens: 1024, usage: true } } }
  mocks.model.mockResolvedValue(model)
  const calls: Array<{ prompt: string; destination: unknown }> = []
  let finishInserted!: () => void
  const inserted = new Promise<void>(resolve => { finishInserted = resolve })
  let finishOriginal!: () => void
  const original = new Promise<void>(resolve => { finishOriginal = resolve })
  let originalSignal: AbortSignal | undefined
  const close = vi.fn()
  mocks.client.mockImplementation(() => ({ close, catalog: () => [{ name: 'create_visible_generation_task', description: '测试任务派发',
    inputSchema: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'], additionalProperties: false } }],
    call: async (_name: string, input: { prompt: string; destination: unknown }, signal: AbortSignal) => {
      calls.push(input)
      // 模拟已交给业务服务的操作晚于助手中断才返回，不能把回执归给下一条消息。
      if (input.prompt === '原请求') { originalSignal = signal; await original }
      if (input.prompt === '插入消息') await inserted
      return { content: [{ type: 'text', text: JSON.stringify({ accepted: true, destination: input.destination }) }] }
    } }))

  // 只替换进程传输，命令配置、取消与模型工具循环均使用正式 PiEngine / 官方 SDK。
  const child = new EventEmitter() as EventEmitter & { postMessage(message: { type: string; id: string; command?: EngineCommand; value?: unknown; error?: string }): void; kill(): void }
  const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>()
  const engine = new PiEngine(event => child.emit('message', event), (id, name, input, signal) => new Promise((resolve, reject) => {
    const abort = () => { pending.delete(id); child.emit('message', { type: 'toolCancel', id }); reject(new Error('工具等待已取消')) }
    if (signal?.aborted) { abort(); return }
    signal?.addEventListener('abort', abort, { once: true })
    pending.set(id, { resolve: value => { signal?.removeEventListener('abort', abort); resolve(value) }, reject })
    child.emit('message', { type: 'tool', id, name, input })
  }))
  cleanup.push(() => engine.dispose())
  child.postMessage = message => {
    if (message.type === 'toolResult') {
      const entry = pending.get(message.id); pending.delete(message.id)
      if (message.error) entry?.reject(new Error(message.error)); else entry?.resolve(message.value)
    } else if (message.command) {
      void engine.command(message.command).then(value => child.emit('message', { type: 'result', id: message.id, value }),
        (error: unknown) => child.emit('message', { type: 'result', id: message.id, error: String(error) }))
    }
  }
  child.kill = () => child.emit('exit', 0)
  mocks.fork.mockReturnValue(child)
  const service = new EmbeddedAgentService()
  cleanup.push(() => { finishOriginal(); finishInserted(); service.dispose() })
  const requestIds = { original: randomUUID(), waiting: randomUUID(), inserted: randomUUID() }
  const send = (text: string, project: keyof typeof requestIds, delivery: EmbeddedAgentPrompt['delivery'] = 'wait') => service.prompt({ text, delivery,
    model: { providerId: 'test', modelId: 'fixture' }, access: 'full',
    context: JSON.stringify({ workspace: { id: 'nodes' }, project: { id: project, selectedNodeId: `${project}-reference`, selectedNodeIsReference: project !== 'waiting' } }) }, requestIds[project])
  await send('原请求', 'original')
  await vi.waitFor(() => expect(requests[0]).toBe('原请求'), { timeout: 15000 })
  const originalCalls = stage === 'tool' ? 1 : 0
  if (originalCalls) await vi.waitFor(() => expect(calls).toHaveLength(1))
  await send('等待消息', 'waiting')
  await send('插入消息', 'inserted', 'interrupt')
  await vi.waitFor(() => expect(calls).toHaveLength(originalCalls + 1), { timeout: 10000 })
  expect(calls[originalCalls]).toMatchObject({ prompt: '插入消息', destination: { mode: 'canvas', projectId: 'inserted', sourceNodeIds: ['inserted-reference'] } })
  expect(service.snapshot().busy).toBe(true)
  expect(service.snapshot().pendingMessages?.map(message => message.text)).toEqual(['等待消息'])
  expect(requests).not.toContain('等待消息')
  finishInserted()
  await vi.waitFor(() => expect(service.snapshot().busy).toBe(false), { timeout: 10000 })
  if (stage === 'model') expect(originalClosed).toBe(true)
  else {
    expect(originalSignal?.aborted).toBe(true)
    finishOriginal()
    await vi.waitFor(() => expect(mocks.info).toHaveBeenCalledWith('内置助手工具调用完成', expect.objectContaining({ requestId: requestIds.original })))
    expect(calls[0]).toMatchObject({ prompt: '原请求', destination: { projectId: 'original', sourceNodeIds: ['original-reference'] } })
  }
  expect(calls.slice(originalCalls)).toEqual([
    { prompt: '插入消息', destination: { mode: 'canvas', projectId: 'inserted', sourceNodeIds: ['inserted-reference'] } },
    { prompt: '等待消息', destination: { mode: 'canvas', projectId: 'waiting', sourceNodeIds: [], placement: { mode: 'right_of_node', anchorNodeId: 'waiting-reference' } } },
  ])
  expect(requests).toEqual(stage === 'model'
    ? ['原请求', '插入消息', '插入消息', '插入消息', '等待消息', '等待消息']
    : ['原请求', '原请求', '插入消息', '插入消息', '等待消息', '等待消息'])
  expect(service.snapshot().error).toBeNull()
  expect(service.snapshot().messages.filter(message => message.role === 'user').map(message => message.text)).toEqual(['原请求', '插入消息', '等待消息'])
  expect(close).toHaveBeenCalledTimes(3)
  expect(mocks.info).toHaveBeenCalledWith('内置助手回复状态', expect.objectContaining({ event: 'embedded_agent.turn.cancelled', requestId: requestIds.original }))
  expect(mocks.info).toHaveBeenCalledWith('内置助手工具调用完成', expect.objectContaining({ requestId: requestIds.waiting }))
}, 30000)
