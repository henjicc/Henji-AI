import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { LlmModelConfig } from '@henjicc/ai-sdk'
import { PiEngine } from './piEngine'
import type { EngineEvent } from './contracts'

const model: LlmModelConfig = { providerId: 'test', modelId: 'fixture', displayName: 'Fixture', adapter: 'openai-compatible', enabled: true,
  capabilities: { text: true, image: false, video: false, audio: false, streaming: true, toolCall: true, parallelTools: false,
    jsonOutput: false, structuredOutputMode: 'none', reasoning: false, sampling: true, contextWindow: 32768, maxOutputTokens: 1024, usage: true } }
const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const close of cleanup.reverse()) await close(); cleanup.length = 0 })
async function fixture(capabilities: Partial<LlmModelConfig['capabilities']> = {}, api: 'openai-completions' | 'openai-responses' = 'openai-completions') {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-pi-test-'))
  cleanup.push(() => fs.rm(directory, { recursive: true, force: true }))
  const requests: Array<{ tools: Array<{ function: { name: string } }>; messages: Array<{ role: string; content: string }>; input?: Array<{ role: string; content: unknown }> }> = []
  let mode: 'tool' | 'error' | 'wait' = 'tool'
  const server: Server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString()) as typeof requests[number]
    requests.push(body)
    if (mode === 'error') { response.writeHead(400, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: { message: 'fixture rejection' } })); return }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.flushHeaders()
    if (mode === 'wait') return
    if (api === 'openai-responses') {
      const item = { type: 'message', id: 'msg_fixture', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '已经读取图片。', annotations: [] }] }
      const events = [
        { type: 'response.created', response: { id: 'resp_fixture', model: 'fixture', created_at: 1 } },
        { type: 'response.output_item.added', output_index: 0, item: { ...item, content: [], status: 'in_progress' } },
        { type: 'response.content_part.added', output_index: 0, content_index: 0, item_id: item.id, part: { type: 'output_text', text: '', annotations: [] } },
        { type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: item.id, delta: '已经读取图片。' },
        { type: 'response.output_item.done', output_index: 0, item },
        { type: 'response.completed', response: { id: 'resp_fixture', model: 'fixture', status: 'completed', output: [item], usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } } },
      ]
      for (const event of events) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
      response.end()
      return
    }
    const called = body.messages.some((message) => message.role === 'tool')
    const delta = called ? { content: '已经读取项目。' } : { tool_calls: [{ index: 0, id: 'call_fixture', type: 'function', function: { name: 'read_project', arguments: '{"id":"project"}' } }] }
    response.write(`data: ${JSON.stringify({ id: 'reply', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`)
    response.write(`data: ${JSON.stringify({ id: 'reply', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: called ? 'stop' : 'tool_calls' }] })}\n\n`)
    response.end('data: [DONE]\n\n')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing port')
  const events: EngineEvent[] = []
  const tool = vi.fn(async () => ({ ok: true, name: '项目' }))
  const engine = new PiEngine((event) => { events.push(structuredClone(event)) }, tool)
  cleanup.push(() => engine.dispose())
  await engine.command({ action: 'initialize', input: directory })
  const configuration = { directory, model: { providerId: 'test', model: { ...model, capabilities: { ...model.capabilities, ...capabilities } }, baseUrl: `http://127.0.0.1:${address.port}/v1`, api, apiKey: 'fixture-key' },
    instructions: '你是测试中的痕迹助手。', tools: [{ name: 'read_project', description: '读取项目', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false } }] }
  await engine.command({ action: 'configure', input: configuration })
  return { engine, requests, events, tool, directory, configuration, setMode: (value: typeof mode) => { mode = value } }
}
describe('Pi official SDK engine', () => {
  it('DeepSeek 使用的 Responses 链路发送原生图片并在重启续聊时恢复内容', async () => {
    const f = await fixture({ image: true }, 'openai-responses')
    const attachment = { schemaVersion: 'agent-attachment/v1' as const, mediaRef: 'asset:image', modality: 'image' as const, mimeType: 'image/png', sizeBytes: 5,
      displayName: '图片.png', dataClass: 'C1' as const, lifecycle: 'asset_library' as const, sourceStatus: 'ready' as const }
    await f.engine.command({ action: 'prompt', input: { text: '看图', context: '', attachments: [{ attachment, data: 'bWVkaWE=' }] } })
    expect(await f.engine.command({ action: 'snapshot' })).toMatchObject({ error: null, messages: [{ text: '看图', attachments: [attachment] }, { text: '已经读取图片。' }] })
    const sessions = await f.engine.command({ action: 'sessions' }) as Array<{ id: string; title: string }>
    expect(sessions[0].title).toBe('看图')
    const restarted = new PiEngine(() => {}, async () => ({ ok: true }))
    cleanup.push(() => restarted.dispose())
    await restarted.command({ action: 'initialize', input: f.directory })
    await restarted.command({ action: 'open', input: sessions[0].id })
    await restarted.command({ action: 'configure', input: f.configuration })
    await restarted.command({ action: 'prompt', input: { text: '继续分析', context: '' } })
    expect(f.requests).toHaveLength(2)
    for (const request of f.requests) {
      expect(request.input?.find((message) => message.role === 'user')?.content).toEqual(expect.arrayContaining([
        { type: 'input_image', image_url: 'data:image/png;base64,bWVkaWE=', detail: 'auto' },
      ]))
    }
    await restarted.command({ action: 'configure', input: { ...f.configuration, model: { ...f.configuration.model,
      model: { ...f.configuration.model.model, capabilities: { ...f.configuration.model.model.capabilities, image: false } } } } })
    await restarted.command({ action: 'prompt', input: { text: '改为文字交流', context: '' } })
    expect(JSON.stringify(f.requests[2])).not.toContain('data:image/')
    expect(JSON.stringify(f.requests[2])).toContain('当前模型无法读取这份历史附件')
    expect(await restarted.command({ action: 'snapshot' })).toMatchObject({ error: null })
  }, 30000)
  it('附件实际进入官方 SDK 的每轮 HTTP 请求，并能从冷启动会话恢复', async () => {
    const f = await fixture({ image: true, video: true, audio: true })
    const attachments = (['image', 'video', 'audio'] as const).map((modality) => ({
      attachment: { schemaVersion: 'agent-attachment/v1' as const, mediaRef: `asset:${modality}`, modality,
        mimeType: { image: 'image/png', video: 'video/mp4', audio: 'audio/wav' }[modality], sizeBytes: 5,
        displayName: `${modality}附件`, dataClass: 'C1' as const, lifecycle: 'asset_library' as const, sourceStatus: 'ready' as const },
      data: Buffer.from('media').toString('base64'),
    }))
    await f.engine.command({ action: 'prompt', input: { text: '分析这些附件', context: '', attachments } })
    expect(f.requests).toHaveLength(2)
    for (const request of f.requests) {
      const user = request.messages.find((message) => message.role === 'user')
      expect(user?.content).toEqual(expect.arrayContaining([
        { type: 'image_url', image_url: { url: 'data:image/png;base64,bWVkaWE=' } },
        { type: 'video_url', video_url: { url: 'data:video/mp4;base64,bWVkaWE=' } },
        { type: 'input_audio', input_audio: { data: 'bWVkaWE=', format: 'wav' } },
      ]))
      expect(JSON.stringify(request)).not.toContain('[henji-attachments:')
    }
    const snapshot = await f.engine.command({ action: 'snapshot' })
    expect(snapshot).toMatchObject({ messages: [{ text: '分析这些附件', attachments: attachments.map((item) => item.attachment) }, { text: '已经读取项目。' }] })
    expect(JSON.stringify(snapshot)).not.toContain('bWVkaWE=')
    const sessions = await f.engine.command({ action: 'sessions' }) as Array<{ id: string }>
    const restarted = new PiEngine(() => {}, async () => ({ ok: true }))
    cleanup.push(() => restarted.dispose())
    await restarted.command({ action: 'initialize', input: f.directory })
    await restarted.command({ action: 'open', input: sessions[0].id })
    expect(await restarted.command({ action: 'snapshot' })).toMatchObject({ messages: [{ attachments: attachments.map((item) => item.attachment) }, {}] })
  }, 30000)
  it('真实 SDK 只运行宿主工具，流式输出并恢复官方会话文件', async () => {
    const f = await fixture()
    await f.engine.command({ action: 'prompt', input: { text: '读取项目', context: '{"workspace":"canvas"}' } })
    expect(f.tool).toHaveBeenCalledOnce()
    expect(f.tool.mock.calls[0]).toMatchObject(['call_fixture', 'read_project', { id: 'project' }, expect.any(AbortSignal)])
    expect(f.requests).toHaveLength(2)
    expect(f.requests[0].tools.map((tool) => tool.function.name)).toEqual(['read_project'])
    expect(f.requests[0].messages[0].content).toContain('痕迹助手')
    const final = f.events.filter((event) => event.type === 'snapshot').at(-1)
    expect(final).toMatchObject({ value: { busy: false, error: null, messages: [{ text: '读取项目' }, { text: '已经读取项目。' }] } })
    const sessions = await f.engine.command({ action: 'sessions' }) as Array<{ id: string }>
    expect(sessions).toHaveLength(1)
    await f.engine.command({ action: 'new' })
    await f.engine.command({ action: 'open', input: sessions[0].id })
    expect(await f.engine.command({ action: 'snapshot' })).toMatchObject({ messages: [{ text: '读取项目' }, { text: '已经读取项目。' }] })
    await expect(f.engine.command({ action: 'open', input: '../auth.json' })).rejects.toThrow('不存在')
    const restarted = new PiEngine(() => {}, async () => ({ ok: true }))
    cleanup.push(() => restarted.dispose())
    await restarted.command({ action: 'initialize', input: f.directory })
    await restarted.command({ action: 'open', input: sessions[0].id })
    expect(await restarted.command({ action: 'snapshot' })).toMatchObject({ messages: [{ text: '读取项目' }, { text: '已经读取项目。' }] })
    const auth = await fs.readFile(path.join(f.directory, 'auth.json'), 'utf8').catch(() => '')
    expect(auth).not.toContain('fixture-key')
  }, 30000)
  it('模型拒绝显示失败，停止中断悬挂的请求且解除忙碌状态', async () => {
    const f = await fixture()
    f.setMode('error')
    await f.engine.command({ action: 'prompt', input: { text: '失败', context: '' } })
    expect(await f.engine.command({ action: 'snapshot' })).toMatchObject({ busy: false, error: expect.stringContaining('fixture rejection') })
    await f.engine.command({ action: 'new' })
    f.setMode('wait')
    const promise = f.engine.command({ action: 'prompt', input: { text: '等待', context: '' } })
    await vi.waitFor(() => expect(f.requests.length).toBeGreaterThan(1))
    await expect(f.engine.command({ action: 'new' })).rejects.toThrow('停止')
    await f.engine.command({ action: 'cancel' })
    await promise
    expect(await f.engine.command({ action: 'snapshot' })).toMatchObject({ busy: false })
  }, 30000)
})
