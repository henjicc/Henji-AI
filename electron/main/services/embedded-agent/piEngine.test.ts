import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { LlmModelConfig } from '@henjicc/ai-sdk'
import { PiEngine } from './piEngine'
import { PiToolDisclosure } from './toolDisclosure'
import { videoEditCreativeTools } from './toolDisclosureProfiles'
import { contextReader } from './contextReader'
import { embeddedModelCompat, embeddedThinkingLevelMap } from './modelOptions'
import { SessionManager, type AgentSession, type ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { EngineEvent } from './contracts'
import { z } from 'zod'
import { buildApplicationToolCatalog } from '../application-runtime/toolCatalog'
import { APPLICATION_CAPABILITY_IDS } from '../../../../src/core/application-control/localHostContracts'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '../../../../src/core/application-control/builtinApplicationCapabilityRegistry'
import { loadAssistantSkillCapability } from '../../../../src/core/application-control/domains/assistantSkill/assistantSkillApplicationCapabilities'
import { loadAssistantSkillFrom } from '../assistant/skills/registry'
vi.mock('../assistant/skills/registry', async importOriginal => {
  const actual = await importOriginal<typeof import('../assistant/skills/registry')>()
  const dirs = () => ({ builtinDir: path.resolve('resources/assistant-skills'), userDir: '', disabledNames: [] })
  return { ...actual,
    listEnabledAssistantSkills: async () => (await actual.scanAssistantSkills(dirs())).skills.filter(skill => skill.enabled),
    loadAssistantSkill: (name: string, relativePath?: string) => actual.loadAssistantSkillFrom(dirs(), name, relativePath),
  }
})
import { embeddedSkillCatalog, callEmbeddedSkill } from './skills'

/** 内置助手的本机命令与文件工具。 */
const LOCAL_TOOLS = ['run_command', 'read_file', 'write_file', 'edit_file', 'search_files', 'find_files', 'list_files']


const model: LlmModelConfig = { providerId: 'test', modelId: 'fixture', displayName: 'Fixture', adapter: 'openai-compatible', enabled: true,
  capabilities: { text: true, image: false, video: false, audio: false, streaming: true, toolCall: true, parallelTools: false,
    jsonOutput: false, structuredOutputMode: 'none', reasoning: false, sampling: true, contextWindow: 32768, maxOutputTokens: 1024, usage: true } }
const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const close of cleanup.reverse()) await close(); cleanup.length = 0 })
/** Pi 1.x 按首次声明顺序发工具：保留的工具位置不变，新加载的按名称接在后面，不打乱已缓存的前缀。 */
function expectStableToolOrder(previous: string[], next: string[]) {
  const kept = previous.filter(name => next.includes(name))
  expect(next.slice(0, kept.length)).toEqual(kept)
  const added = next.slice(kept.length)
  expect(added).toEqual([...added].sort())
}
async function fixture(capabilities: Partial<LlmModelConfig['capabilities']> = {}, api: 'openai-completions' | 'openai-responses' = 'openai-completions') {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-pi-test-'))
  cleanup.push(() => fs.rm(directory, { recursive: true, force: true }))
  const requests: Array<{ tools: Array<{ function: { name: string } }>; messages: Array<{ role: string; content: string }>; input?: Array<{ role: string; content: unknown }>; max_tokens?: number; max_completion_tokens?: number; reasoning_effort?: string }> = []
  const headers: IncomingHttpHeaders[] = []
  let mode: 'tool' | 'error' | 'wait' = 'tool'
  let usage: Record<string, unknown> | undefined
  let toolPlan = [{ name: 'read_project', arguments: { id: 'project' } as Record<string, unknown> }]
  // Responses 默认直接回答；需要工具往返的用例自己设定
  let responsesToolPlan: typeof toolPlan = []
  const server: Server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString()) as typeof requests[number]
    requests.push(body)
    headers.push(request.headers)
    if (mode === 'error') { response.writeHead(400, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: { message: 'fixture rejection' } })); return }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.flushHeaders()
    if (mode === 'wait') return
    if (api === 'openai-responses') {
      const outputs = (body.input ?? []).filter(item => (item as { type?: string }).type === 'function_call_output').length
      const planned = responsesToolPlan[outputs]
      if (planned) {
        const call = { type: 'function_call', id: `fc_${outputs}`, call_id: `call_${outputs}`, name: planned.name, arguments: JSON.stringify(planned.arguments), status: 'completed' }
        const events = [
          { type: 'response.created', response: { id: `resp_${outputs}`, model: 'fixture', created_at: 1 } },
          { type: 'response.output_item.added', output_index: 0, item: { ...call, arguments: '' } },
          { type: 'response.function_call_arguments.delta', output_index: 0, item_id: call.id, delta: call.arguments },
          { type: 'response.output_item.done', output_index: 0, item: call },
          { type: 'response.completed', response: { id: `resp_${outputs}`, model: 'fixture', status: 'completed', output: [call], usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } } },
        ]
        for (const event of events) response.write(`event: ${event.type}
data: ${JSON.stringify(event)}

`)
        response.end()
        return
      }
      const item = { type: 'message', id: 'msg_fixture', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '已经读取图片。', annotations: [] }] }
      const events = [
        { type: 'response.created', response: { id: 'resp_fixture', model: 'fixture', created_at: 1 } },
        { type: 'response.output_item.added', output_index: 0, item: { ...item, content: [], status: 'in_progress' } },
        { type: 'response.content_part.added', output_index: 0, content_index: 0, item_id: item.id, part: { type: 'output_text', text: '', annotations: [] } },
        { type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: item.id, delta: '已经读取图片。' },
        { type: 'response.output_item.done', output_index: 0, item },
        { type: 'response.completed', response: { id: 'resp_fixture', model: 'fixture', status: 'completed', output: [item], usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110, input_tokens_details: { cached_tokens: 30 } } } },
      ]
      for (const event of events) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
      response.end()
      return
    }
    const toolIndex = body.messages.filter((message) => message.role === 'tool').length
    const called = toolIndex >= toolPlan.length
    const planned = toolPlan[toolIndex]
    const delta = called ? { content: '已经读取项目。' } : { tool_calls: [{ index: 0, id: toolIndex ? `call_fixture_${toolIndex}` : 'call_fixture', type: 'function', function: { name: planned.name, arguments: JSON.stringify(planned.arguments) } }] }
    response.write(`data: ${JSON.stringify({ id: 'reply', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`)
    response.write(`data: ${JSON.stringify({ id: 'reply', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: called ? 'stop' : 'tool_calls' }] })}\n\n`)
    if (usage) response.write(`data: ${JSON.stringify({ choices: [], usage })}\n\n`)
    response.end('data: [DONE]\n\n')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing port')
  const events: EngineEvent[] = []
  const tool = vi.fn(async (): Promise<unknown> => ({ ok: true, name: '项目' }))
  const engine = new PiEngine((event) => { events.push(structuredClone(event)) }, tool)
  cleanup.push(() => engine.dispose())
  await engine.command({ action: 'initialize', input: directory })
  const configuration = { directory, workFolder: directory, projectTrusted: false, model: { providerId: 'test', model: { ...model, capabilities: { ...model.capabilities, ...capabilities } }, baseUrl: `http://127.0.0.1:${address.port}/v1`, api, apiKey: 'fixture-key' },
    instructions: '你是测试中的痕迹助手。', tools: [{ name: 'read_project', description: '读取项目', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false } }] }
  await engine.command({ action: 'configure', input: configuration })
  return { engine, requests, headers, events, tool, directory, configuration, setUsage: (value: Record<string, unknown>) => { usage = value }, setMode: (value: typeof mode) => { mode = value },
    setToolPlan: (value: typeof toolPlan) => { toolPlan = value }, setResponsesToolPlan: (value: typeof toolPlan) => { responsesToolPlan = value } }
}
function applicationCatalog() {
    const tools = APPLICATION_CAPABILITY_IDS.map(id => {
      const definition = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(id)!
      return { id, version: definition.version, title: definition.title, description: definition.description,
        inputSchema: z.toJSONSchema(definition.inputSchema, { io: 'input' }) as Record<string, unknown> }
    })
    return buildApplicationToolCatalog({ tools })
}

describe('Pi official SDK engine', () => {
  it('凭据只用于请求认证，不进入模型上下文、工具参数或对外事件', async () => {
    const f = await fixture()
    await f.engine.command({ action: 'prompt', input: { text: '读取项目', context: '{}' } })
    expect(f.headers.length).toBeGreaterThan(0)
    expect(f.headers.every(header => header.authorization === 'Bearer fixture-key')).toBe(true)
    expect(JSON.stringify(f.requests)).not.toContain('fixture-key')
    expect(JSON.stringify(f.tool.mock.calls)).not.toContain('fixture-key')
    expect(JSON.stringify(f.events)).not.toContain('fixture-key')
  })
  it('OpenRouter 兼容端点不附带 Pi 的归因头', async () => {
    const f = await fixture()
    f.setToolPlan([])
    await f.engine.command({ action: 'configure', input: { ...f.configuration,
      model: { ...f.configuration.model, baseUrl: f.configuration.model.baseUrl.replace('/v1', '/openrouter.ai/v1') } } })
    await f.engine.command({ action: 'prompt', input: { text: '回答', context: '{}' } })
    expect(f.headers).toHaveLength(1)
    expect(f.headers[0]).not.toHaveProperty('http-referer')
    expect(f.headers[0]).not.toHaveProperty('x-openrouter-title')
    expect(f.headers[0]).not.toHaveProperty('x-openrouter-categories')
  })

  it('未知模型能力使用共享输出预算，推理默认 high 并尊重已有 low 设置', async () => {
    const f = await fixture({ reasoning: true, contextWindow: null, maxOutputTokens: null })
    f.setToolPlan([])
    await f.engine.command({ action: 'prompt', input: { text: '回答', context: '{}' } })
    expect(f.requests[0].max_tokens ?? f.requests[0].max_completion_tokens).toBe(32768)
    expect(f.requests[0].reasoning_effort).toBe('high')
    await f.engine.command({ action: 'configure', input: { ...f.configuration, model: { ...f.configuration.model, reasoning: { enabled: true, effort: 'low' } } } })
    await f.engine.command({ action: 'prompt', input: { text: '继续', context: '{}' } })
    expect(f.requests.at(-1)?.reasoning_effort).toBe('low')
  })

  it('剪辑创作首轮给出核心创作工具，名称都在正式目录；对话中途换界面工具列表不变，引导点名不在列表里的工具', () => {
    {
      const catalog = applicationCatalog().tools
      let active: string[] = []
      const session = { getActiveToolNames: () => active, setActiveToolsByName: (names: string[]) => { active = names } } as AgentSession
      const tools: ToolDefinition[] = catalog.map(tool => ({ ...tool, label: tool.name, description: tool.description ?? tool.name,
        parameters: tool.inputSchema as ToolDefinition['parameters'], execute: async () => ({ content: [], details: undefined }) }))
      const disclosure = new PiToolDisclosure(tools, () => session)
      disclosure.prepareContext('{"surface":{"id":"workspace.video_edit"}}', 'workspace.video_edit')
      const first = [...active]
      expect(first).toEqual([...first].sort())
      expect(first).toEqual(expect.arrayContaining(videoEditCreativeTools().filter(name => catalog.some(tool => tool.name === name))))
      expect(first).toEqual(expect.arrayContaining(['observe_video_edit_frame', 'read_application_media', 'analyze_video_edit_color']))
      expect(first).toEqual(expect.arrayContaining(['change_application_entities', ...videoEditCreativeTools()]))
      expect(first).not.toContain('apply_video_edit_template')
      const canvasGuidance = disclosure.prepareContext('{"surface":{"id":"workspace.canvas"}}', 'workspace.video_edit')
      expect(active).toEqual(first)
      expect(canvasGuidance).toContain('当前为画布')
      expect(canvasGuidance).toMatch(/get_canvas_document 实际不在工具列表里.*call_application_tool/)
      expect(disclosure.prepareContext('{"surface":{"id":"workspace.video_edit"}}', 'workspace.video_edit')).not.toContain('实际不在工具列表里')
      expect(active).toEqual(first)
    }
  })
  it('授权讲解 JSONL 与历史附图经正式 Pi 消息进入受控模型 transport，用量复用原循环', async () => {
    const f = await fixture({ image: true })
    const definition = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get('read_intent_recording')!
    await f.engine.command({ action: 'configure', input: { ...f.configuration, tools: [{ name: definition.id, description: definition.description,
      inputSchema: z.toJSONSchema(definition.inputSchema, { io: 'input' }) as Record<string, unknown> }] } })
    const digest = `sha256:${'a'.repeat(64)}`
    f.tool.mockResolvedValue({ ok: true, data: { lines: ['{"kind":"event","type":"speech","text":"调整构图"}'], nextOffset: null, nextImageOffset: null, inputReceipt: 'complete-input',
      semanticImages: [{ mimeType: 'image/jpeg', data: 'aGlzdG9yaWNhbC1pbWFnZQ==', manifest: { id: 'history', kind: 'frame', resourceRef: { resourceId: 'history', digest, bytes: 16 }, size: [640, 360], pixelBudget: 2500000,
        frames: [{ seq: 1, monoUs: 1, timeline: null, unavailableReason: 'static', clockSegmentRef: 'static', eventId: 'pointer', stateDigest: digest, geometrySnapshotRef: 'geometry', sourceRefs: [], pointer: [.2, .3], reason: 'appearance', attachmentRect: [0, 0, 640, 360] }] } }] } })
    f.setToolPlan([{ name: 'load_application_tools', arguments: { names: [definition.id] } }, { name: 'call_application_tool', arguments: { name: definition.id, input: { documentRef: { kind: 'image_edit.document', id: 'v3:test' }, sessionId: 'session', offset: 0, imageOffset: 0 } } }])
    await f.engine.command({ action: 'prompt', input: { text: '根据已授权讲解整理', context: '' } })
    expect(f.requests).toHaveLength(3)
    const payload = JSON.stringify(f.requests[2])
    expect(payload).toContain('调整构图'); expect(payload).toContain('image_url')
    expect(payload).toContain('data:image/jpeg;base64,aGlzdG9yaWNhbC1pbWFnZQ==')
    expect(payload).not.toContain('input_audio')
    // 日志带工具回执文字供链路排查，图片原文不进日志。
    expect(f.events.filter(event => event.type === 'log').every(event => !JSON.stringify(event).includes('aGlzdG9yaWNhbC1pbWFnZQ=='))).toBe(true)
  })
  it('DeepSeek 用量按输入 token 加权汇总，失败仍输出汇总', async () => {
    const f = await fixture()
    f.setUsage({ prompt_tokens: 1000, completion_tokens: 20, total_tokens: 1020, prompt_cache_hit_tokens: 900, prompt_cache_miss_tokens: 100 })
    await f.engine.command({ action: 'prompt', input: { text: '读取', context: '' } })
    expect(f.events).toContainEqual(expect.objectContaining({ type: 'log', phase: 'usage_summary', summary: expect.objectContaining({
      requests: 2, usageResponses: 2, input: 200, cacheRead: 1800, output: 40, cacheHitRate: 0.9,
    }) }))
    f.setMode('error')
    await f.engine.command({ action: 'prompt', input: { text: '再试', context: '' } })
    expect(f.events.at(-2)).toMatchObject({ type: 'log', phase: 'usage_summary', summary: { requests: 1, usageResponses: 0, cacheHitRate: null } })
  })

  it('按用户任务汇总用量与回执体积，不泄露内容，下一任务重新计数', async () => {
    const f = await fixture()
    f.tool.mockResolvedValue({ secret: 'private-tool-text' })
    await f.engine.command({ action: 'prompt', input: { text: '读取', context: '' } })
    const summaries = () => f.events.filter((event): event is Extract<EngineEvent, { type: 'log' }> => event.type === 'log' && event.phase === 'usage_summary')
    expect(summaries()).toHaveLength(1)
    expect(summaries()[0].summary).toMatchObject({ requests: 2, toolResults: 1, cacheHitRate: null,
      toolTextByName: { read_project: { calls: 1, bytes: expect.any(Number), maxBytes: expect.any(Number) } } })
    expect(JSON.stringify(summaries())).not.toContain('private-tool-text')
    await f.engine.command({ action: 'prompt', input: { text: '继续', context: '' } })
    expect(summaries()[1].summary).toMatchObject({ requests: 1, toolResults: 0, toolTextByName: {} })
  })

  it('正式 Pi 等待工具未返回时不请求模型，任务返回后自动继续', async () => {
    const f = await fixture()
    await f.engine.command({ action: 'configure', input: { ...f.configuration, tools: applicationCatalog().tools } })
    f.setToolPlan([{ name: 'load_application_tools', arguments: { task: 'generation' } },
      { name: 'call_application_tool', arguments: { name: 'wait_generation_task', input: { taskId: 'existing-task' } } }])
    let release!: (value: unknown) => void
    f.tool.mockImplementation(() => new Promise(resolve => { release = resolve }))
    const running = f.engine.command({ action: 'prompt', input: { text: '等待原任务', context: '{"surface":{"id":"workspace.generation"}}' } })
    await vi.waitFor(() => expect(f.tool).toHaveBeenCalledTimes(1))
    const count = f.requests.length
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(f.requests).toHaveLength(count)
    release({ task: { status: 'completed', taskId: 'existing-task' }, waitReason: 'terminal' })
    await running
    expect(f.requests).toHaveLength(count + 1)
    expect(f.tool).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['prompt-optimization', 'references/image.md', '一张图是一个冻结的瞬间', '视频写的是随时间发生的变化'],
    ['prompt-optimization', 'references/video.md', '视频写的是随时间发生的变化', '一张图是一个冻结的瞬间'],
    ['prompt-optimization', 'references/image-edit.md', '最小必要修改', '## 标记和坐标定位'],
    ['prompt-optimization', 'references/video-extension.md', '# 延长与连接', '# 声音与文字'],
      ['cinematic-director', 'references/blocking.md', '接触动作描述接近', '像幻灯片'],
    ['cinematic-director', 'references/repair.md', '像幻灯片', '接触动作描述接近'],
    ['cinematic-director', 'references/canvas-workspace.md', '场景从上到下分区', '接触动作描述接近'],
    ['short-drama', 'references/resume.md', '重新读取画布当前状态', '对白保留原文和语言'],
  ])('按需读取 %s/%s，实际请求不含无关模块且不激活生成工具', async (skill, reference, included, excluded) => {
    const f = await fixture()
    const definition = loadAssistantSkillCapability
    const tools = [...applicationCatalog().tools, { name: definition.id, description: definition.description,
      inputSchema: z.toJSONSchema(definition.inputSchema, { io: 'input' }) as Record<string, unknown> }]
    await f.engine.command({ action: 'configure', input: { ...f.configuration, tools,
      instructions: (await embeddedSkillCatalog()).instructions } })
    f.tool.mockImplementation(async (...args: unknown[]) => {
      expect(args[1]).toBe('load_assistant_skill')
      const input = definition.inputSchema.parse(args[2])
      return { ok: true, data: await loadAssistantSkillFrom({ builtinDir: path.resolve('resources/assistant-skills'), userDir: '', disabledNames: [] }, input.name, input.path) }
    })
    f.setToolPlan([
      { name: 'load_assistant_skill', arguments: { name: skill, reason: '当前创作任务' } },
      { name: 'load_assistant_skill', arguments: { name: skill, path: reference, reason: '当前操作指导' } },
    ])
    await f.engine.command({ action: 'prompt', input: { text: '生成一张图片', context: '{"surface":{"id":"workspace.canvas"}}' } })
    expect(f.requests).toHaveLength(3)
    expect(f.requests[0].tools.some(tool => tool.function.name === 'load_assistant_skill')).toBe(true)
    expect(JSON.stringify(f.requests[0])).not.toContain('最小必要修改')
    expect(JSON.stringify(f.requests[1])).toContain(reference)
    expect(JSON.stringify(f.requests[1])).not.toContain(included)
    expect(JSON.stringify(f.requests[2])).toContain(included)
    expect(JSON.stringify(f.requests)).not.toContain(excluded)
    expect(f.requests[2].tools.some(tool => tool.function.name === 'create_visible_generation_task')).toBe(false)
  })

  it('短剧跨轮逐阶段读取，已加载的主文件和正文在上下文中复用', async () => {
    const f = await fixture()
    const catalog = await embeddedSkillCatalog()
    await f.engine.command({ action: 'configure', input: { ...f.configuration,
      tools: [...applicationCatalog().tools, ...catalog.tools], instructions: catalog.instructions } })
    f.tool.mockImplementation(async (...args: unknown[]) => {
      expect(args[1]).toBe('load_assistant_skill')
      return callEmbeddedSkill(loadAssistantSkillCapability.inputSchema.parse(args[2]), new AbortController().signal)
    })
    const main = { name: 'load_assistant_skill', arguments: { name: 'short-drama', reason: '组织短剧工程' } }
    const script = { name: 'load_assistant_skill', arguments: { name: 'short-drama', path: 'references/script.md', reason: '拆解当前剧本' } }
    const production = { name: 'load_assistant_skill', arguments: { name: 'short-drama', path: 'references/production.md', reason: '进入素材生产阶段' } }
    f.setToolPlan([main, script])
    await f.engine.command({ action: 'prompt', input: { text: '先拆解这段短剧，保存制作计划', context: '' } })
    expect(f.requests).toHaveLength(3)
    expect(JSON.stringify(f.requests[0])).not.toContain('references/script.md')
    expect(JSON.stringify(f.requests[1])).not.toContain('对白与动作共用时长')
    expect(JSON.stringify(f.requests[2])).toContain('对白与动作共用时长')
    expect(JSON.stringify(f.requests)).not.toContain('每镜只准备实际需要的参考')

    f.setToolPlan([main, script, production])
    await f.engine.command({ action: 'prompt', input: { text: '按刚才的计划继续准备素材', context: '' } })
    expect(f.requests).toHaveLength(5)
    expect(f.tool).toHaveBeenCalledTimes(3)
    const final = f.requests[4]
    const text = JSON.stringify(final)
    expect(text).toContain('每镜只准备实际需要的参考')
    expect(text.split('对白与动作共用时长')).toHaveLength(2)
    expect(text).not.toContain('对白保留原文和语言')
    expect(final.messages.filter(message => message.role === 'tool')).toHaveLength(3)
    expect(final.tools.some(tool => tool.function.name === 'create_visible_generation_task')).toBe(false)
    expect(Buffer.byteLength(JSON.stringify(f.requests[0]))).toBeLessThan(Buffer.byteLength(text))
  })

  it('普通查询不调用技能时，已登记的技能正文不会自动进入请求', async () => {
    const f = await fixture()
    const definition = loadAssistantSkillCapability
    await f.engine.command({ action: 'configure', input: { ...f.configuration,
      tools: [...f.configuration.tools, { name: definition.id, description: definition.description,
        inputSchema: z.toJSONSchema(definition.inputSchema, { io: 'input' }) as Record<string, unknown> }],
      instructions: (await embeddedSkillCatalog()).instructions,
    } })
    await f.engine.command({ action: 'prompt', input: { text: '读取当前项目', context: '' } })
    expect(f.tool.mock.calls.every(call => (call as unknown[])[1] === 'read_project')).toBe(true)
    expect(JSON.stringify(f.requests)).not.toContain('references/image.md')
    expect(JSON.stringify(f.requests)).not.toContain('图片表达一个视觉状态')
  })

  it('完整授权目录按需披露后首轮体积缩减，续轮相同宿主信息只携带一份', async () => {
    const f = await fixture({ contextWindow: 128000 }, 'openai-responses')
    const catalog = applicationCatalog()
    await f.engine.command({ action: 'configure', input: { ...f.configuration, tools: catalog.tools } })
    const context = '{"surface":{"id":"workspace.canvas"},"project":{"id":"original"}}'
    await f.engine.command({ action: 'prompt', input: { text: '第一轮', context, requestId: 'measure-first' } })
    await f.engine.command({ action: 'prompt', input: { text: '第二轮', context, requestId: 'measure-second' } })
    const logs = f.events.filter((event): event is Extract<EngineEvent, { type: 'log' }> => event.type === 'log' && event.phase === 'model_requested')
    expect(logs).toHaveLength(2)
    logs.forEach((event, index) => {
      expect(event.requestMetrics).toMatchObject({ toolCount: f.requests[index].tools.length, contextCount: 1,
        toolBytes: Buffer.byteLength(JSON.stringify(f.requests[index].tools), 'utf8') })
      expect(event.requestMetrics!.systemBytes).toBeGreaterThan(0)
      expect(event.requestMetrics!.messageCount).toBeGreaterThan(0)
    })
    expect(logs[1].requestMetrics!.contextBytes).toBe(logs[0].requestMetrics!.contextBytes)
    expect(logs[1].requestMetrics!.toolBytes).toBe(logs[0].requestMetrics!.toolBytes)
    expect(JSON.stringify(logs)).not.toContain('original')
    expect(JSON.stringify(logs)).not.toContain('fixture-key')
    const initialTools = f.requests[0].tools as unknown as Array<{ name: string }>
    expect(initialTools.map(tool => tool.name)).toEqual(expect.arrayContaining([
      'get_canvas_document', 'read_application_snapshot', 'change_application_entities', 'load_application_tools',
    ]))
    expect(initialTools.map(tool => tool.name)).toEqual(expect.arrayContaining(['call_application_tool']))
    expect(initialTools).toHaveLength(10 + LOCAL_TOOLS.length)
    expect(initialTools.map(tool => tool.name)).not.toEqual(expect.arrayContaining(['render_camera_stage_output']))
    expect(initialTools.map(tool => tool.name)).not.toContain('create_visible_generation_task')
    expect(initialTools.map(tool => tool.name)).not.toContain('get_canvas_node_schema')
    await f.engine.command({ action: 'prompt', input: { text: '编辑图片', context: '{"surface":{"id":"tool.image_edit"}}' } })
    const editTools = f.requests.at(-1)!.tools as unknown as Array<{ name: string }>
    // 对话中途换界面，工具列表逐字节不变
    expect(JSON.stringify(editTools)).toBe(JSON.stringify(initialTools))
    const fullBytes = Buffer.byteLength(JSON.stringify(catalog.tools))
    expect(initialTools.length).toBeLessThan(catalog.tools.length / 2)
    expect(logs[0].requestMetrics!.toolBytes).toBeLessThan(fullBytes * 0.3)
    if (process.env.HENJI_PI_MEASURE === '1') process.stdout.write(`${JSON.stringify({ initialToolBytes: logs[0].requestMetrics!.toolBytes,
      fullToolBytes: fullBytes, initialToolCount: initialTools.length, contextCount: logs[1].requestMetrics!.contextCount })}\n`)
    await f.engine.command({ action: 'prompt', input: { text: '检查剪辑画面', context: JSON.stringify({ surface: { id: 'workspace.video_edit' } }) } })
    expect(JSON.stringify(f.requests.at(-1)!.tools)).toBe(JSON.stringify(initialTools))
    // 新界面的专用工具由引导点名，经分派入口调用
    expect(JSON.stringify(f.requests.at(-1))).toMatch(/observe_video_edit_frame[^"]*不在工具列表里/)
    for (const [surface, basic] of [['tool.camera_stage', 'observe_camera_stage_scene'], ['workspace.generation', 'search_models'], ['settings.general', 'search_application_settings']]) {
      await f.engine.command({ action: 'prompt', input: { text: '当前页面', context: JSON.stringify({ surface: { id: surface } }) } })
      const names = (f.requests.at(-1)!.tools as unknown as Array<{ name: string }>).map(tool => tool.name)
      expect(names).toHaveLength(10 + LOCAL_TOOLS.length)
      expect(JSON.stringify(f.requests.at(-1)!.tools)).toBe(JSON.stringify(initialTools))
      expect(JSON.stringify(f.requests.at(-1))).toContain(`${basic} 实际不在工具列表里`)
    }
  })

  it('画布按任务加载后原生工具列表逐字节不变，经分派调用；换界面与冷恢复后列表仍不变，前文给过的定义不再重复', async () => {
    const f = await fixture({ contextWindow: 128000 })
    const configuration = { ...f.configuration, tools: applicationCatalog().tools }
    const canvas = '{"surface":{"id":"workspace.canvas"},"project":{"id":"origin"}}'
    const load = { name: 'load_application_tools', arguments: { task: 'canvas_generation' } as Record<string, unknown> }
    const call = { name: 'call_application_tool', arguments: { name: 'get_model_schema', input: { modelId: 'fixture-model' } } as Record<string, unknown> }
    f.setToolPlan([load, call])
    await f.engine.command({ action: 'configure', input: configuration })
    await f.engine.command({ action: 'prompt', input: { text: '在这里生成图片', context: canvas } })
    const names = (index: number) => f.requests.at(index)!.tools.map(tool => tool.function.name)
    expect(f.requests).toHaveLength(3)
    expect(names(0)).toHaveLength(10 + LOCAL_TOOLS.length)
    expect(names(0)).not.toContain('get_model_schema')
    expect(JSON.stringify(f.requests[1].tools)).toBe(JSON.stringify(f.requests[0].tools))
    expect(JSON.stringify(f.requests[2].tools)).toBe(JSON.stringify(f.requests[0].tools))
    const loaded = f.requests[1].messages.find(message => message.role === 'tool')!.content
    expect(loaded).toContain('原画布')
    expect((JSON.parse(loaded) as { tools: Array<{ name: string; parameters: unknown }> }).tools.map(tool => tool.name))
      .toEqual(expect.arrayContaining(['get_model_schema', 'prepare_generation_task', 'create_visible_generation_task', 'wait_generation_task']))
    expect(f.tool).toHaveBeenCalledTimes(1)
    expect(f.tool.mock.calls[0]).toMatchObject([expect.any(String), 'get_model_schema', { modelId: 'fixture-model' }, expect.any(AbortSignal)])
    await f.engine.command({ action: 'prompt', input: { text: '查看三维', context: '{"surface":{"id":"tool.camera_stage"}}' } })
    expect(JSON.stringify(f.requests.at(-1)!.tools)).toBe(JSON.stringify(f.requests[0].tools))
    await f.engine.command({ action: 'prompt', input: { text: '继续画布任务', context: canvas } })
    expect(JSON.stringify(f.requests.at(-1)!.tools)).toBe(JSON.stringify(f.requests[0].tools))
    const snapshot = await f.engine.command({ action: 'snapshot' }) as { sessionId: string }
    const restored = new PiEngine(() => undefined, f.tool)
    cleanup.push(() => restored.dispose())
    await restored.command({ action: 'initialize', input: f.directory })
    await restored.command({ action: 'configure', input: configuration })
    await restored.command({ action: 'open', input: snapshot.sessionId })
    f.setToolPlan([load, call, load])
    await restored.command({ action: 'prompt', input: { text: '继续', context: canvas } })
    const again = f.requests.at(-1)!.messages.filter(message => message.role === 'tool').at(-1)!.content
    expect((JSON.parse(again) as { tools: unknown[]; loadedEarlier: string[] })).toMatchObject({ tools: [], loadedEarlier: expect.arrayContaining(['get_model_schema']) })
    // 重开对话后仍按对话开始时的界面定工具列表
    expect(JSON.stringify(f.requests.at(-1)!.tools)).toBe(JSON.stringify(f.requests[0].tools))
  })

  it('分派入口把调用交给内层工具：应用收到内层工具名，日志与用量记在内层工具名下，平铺或字符串形式的参数照常归位', async () => {
    const f = await fixture()
    const name = 'duplicate_canvas_node'
    const configuration = { ...f.configuration, tools: [...f.configuration.tools,
      { name, title: '复制节点', description: '待加载业务工具', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false } }] }
    f.setToolPlan([{ name: 'load_application_tools', arguments: { names: [name] } },
      { name: 'call_application_tool', arguments: { name, input: { id: 'image' } } },
      { name: 'call_application_tool', arguments: { name, id: 'flat' } },
      { name: 'call_application_tool', arguments: { name, input: '{"id":"text"}' } }])
    f.tool.mockResolvedValue({ ok: true, data: { copied: true } })
    await f.engine.command({ action: 'configure', input: configuration })
    await f.engine.command({ action: 'prompt', input: { text: '复制节点', context: '' } })
    expect(f.requests).toHaveLength(5)
    for (const request of f.requests) {
      expect(JSON.stringify(request.tools)).toBe(JSON.stringify(f.requests[0].tools))
      expect(request.tools.map(tool => tool.function.name)).toEqual(['call_application_tool', 'load_application_tools', 'read_assistant_context', 'read_project', 'run_application_script', ...LOCAL_TOOLS].sort())
    }
    expect(f.tool.mock.calls.map(call => (call as unknown[]).slice(0, 3))).toEqual([
      ['call_fixture_1/1', name, { id: 'image' }], ['call_fixture_2/1', name, { id: 'flat' }], ['call_fixture_3/1', name, { id: 'text' }]])
    const toolMessages = f.requests[4].messages.filter(message => message.role === 'tool').map(message => message.content)
    expect(JSON.parse(toolMessages[0])).toMatchObject({ tools: [{ name, description: '待加载业务工具', parameters: { required: ['id'] } }] })
    expect(toolMessages.slice(1)).toEqual(Array(3).fill(JSON.stringify({ ok: true, data: { copied: true } })))
    const executed = f.events.flatMap(event => event.type === 'log' && event.phase === 'tool_executed' ? [event.tool!] : [])
    expect(executed.map(tool => [tool.toolCallId, tool.toolName, tool.isError])).toEqual([['call_fixture', 'load_application_tools', false],
      ['call_fixture_1/1', name, false], ['call_fixture_2/1', name, false], ['call_fixture_3/1', name, false]])
    expect(executed[1]).toMatchObject({ args: { id: 'image' }, resultText: JSON.stringify({ ok: true, data: { copied: true } }) })
    const summary = f.events.find((event): event is Extract<EngineEvent, { type: 'log' }> => event.type === 'log' && event.phase === 'usage_summary')!.summary!
    expect(summary).toMatchObject({ toolResults: 4, toolTextByName: { [name]: { calls: 3 }, load_application_tools: { calls: 1 } } })
    // 界面上显示内层工具的标题
    expect((await f.engine.command({ action: 'snapshot' }) as { messages: Array<{ kind?: string; text: string }> }).messages.filter(message => message.kind === 'tool').map(message => message.text))
      .toEqual(['加载应用工具', '复制节点', '复制节点', '复制节点'])
  })

  it('没看过定义就调用而失败时错误附带该工具的定义，看过之后不再重复；不存在的工具名和直接按名调用都给出改道', async () => {
    const f = await fixture()
    const name = 'duplicate_canvas_node'
    const configuration = { ...f.configuration, tools: [...f.configuration.tools,
      { name, description: '待加载业务工具', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false } }] }
    f.setToolPlan([{ name: 'call_application_tool', arguments: { name, input: {} } },
      { name: 'call_application_tool', arguments: { name, input: {} } },
      { name: 'call_application_tool', arguments: { name: 'copy_canvas_node', input: { id: 'image' } } },
      { name, arguments: { id: 'image' } },
      { name: 'call_application_tool', arguments: { name, input: { id: 'image' } } }])
    await f.engine.command({ action: 'configure', input: configuration })
    await f.engine.command({ action: 'prompt', input: { text: '复制节点', context: '' } })
    const replies = f.requests.at(-1)!.messages.filter(message => message.role === 'tool').map(message => message.content)
    expect(replies).toHaveLength(5)
    expect(replies[0]).toContain('Validation failed')
    expect(replies[0]).toContain(`${name} 的定义：${JSON.stringify({ name, description: '待加载业务工具', parameters: configuration.tools[1].inputSchema })}`)
    expect(replies[1]).toContain('Validation failed')
    expect(replies[1]).not.toContain('的定义')
    expect(replies[2]).toMatch(/没有名为 copy_canvas_node 的应用工具.*load_application_tools.*domains/)
    expect(replies[3]).toMatch(/duplicate_canvas_node 不在工具列表里.*call_application_tool/)
    expect(f.tool).toHaveBeenCalledTimes(1)
    expect(f.tool.mock.calls[0]).toMatchObject(['call_fixture_4/1', name, { id: 'image' }, expect.any(AbortSignal)])
    for (const request of f.requests) expect(JSON.stringify(request.tools)).toBe(JSON.stringify(f.requests[0].tools))
    // 改道说明每次请求都相同，不动已缓存的前缀
    expect(JSON.stringify(f.requests.at(-1)!.messages.slice(0, f.requests.at(-2)!.messages.length))).toBe(JSON.stringify(f.requests.at(-2)!.messages))
  })

  it('记录每轮供应商实际用量和缓存读取，并沿用宿主消息关联标识', async () => {
    const f = await fixture({}, 'openai-responses')
    await f.engine.command({ action: 'prompt', input: { text: '第一轮', context: '', requestId: 'request-first' } })
    await f.engine.command({ action: 'prompt', input: { text: '第二轮', context: '', requestId: 'request-second' } })
    for (const requestId of ['request-first', 'request-second']) {
      const logs = f.events.filter(event => event.type === 'log' && event.requestId === requestId)
      expect(logs).toEqual([
        expect.objectContaining({ phase: 'start' }),
        expect.objectContaining({ phase: 'model_requested', requestMetrics: expect.objectContaining({ toolCount: 3 + LOCAL_TOOLS.length, toolBytes: expect.any(Number) }) }),
        expect.objectContaining({ phase: 'model_completed', modelId: 'fixture', providerId: 'test', durationMs: expect.any(Number),
          metrics: { input: 70, output: 10, cacheRead: 30, cacheWrite: 0, totalTokens: 110, cacheHitRate: 0.3, reasoning: 0, firstTokenMs: expect.any(Number) } }),
        expect.objectContaining({ phase: 'completed', durationMs: expect.any(Number) }),
        expect.objectContaining({ phase: 'usage_summary', summary: expect.objectContaining({ requests: 1, cacheHitRate: 0.3 }) }),
      ])
      expect(JSON.stringify(logs)).not.toContain('fixture-key')
      expect(JSON.stringify(logs)).not.toContain('第一轮')
    }
  })
  it('上下文缓存按前缀命中：同样输入新开对话首个请求逐字节一致，多轮与工具往返只在末尾追加', async () => {
    const f = await fixture()
    const context = '{"workspace":{"id":"videoEdit"},"capturedAt":"2026-11-13T00:00:00.000Z"}'
    await f.engine.command({ action: 'prompt', input: { text: '读取项目', context } })
    // 每轮都会重新 configure（侧栏每条消息都重建会话），历史与系统设定都不能因此改写
    await f.engine.command({ action: 'configure', input: f.configuration })
    await f.engine.command({ action: 'prompt', input: { text: '继续', context: context.replace('00:00:00', '00:05:00') } })
    expect(f.requests).toHaveLength(3)
    for (let index = 1; index < f.requests.length; index++) {
      const [previous, next] = [f.requests[index - 1], f.requests[index]]
      expect(JSON.stringify(next.tools)).toBe(JSON.stringify(previous.tools))
      expect(JSON.stringify(next.messages.slice(0, previous.messages.length))).toBe(JSON.stringify(previous.messages))
    }
    // 系统设定是第一条，原样给出（不是对话中途的一次“更新”）；宿主上下文排在它后面
    const [system, hostContext] = f.requests[0].messages as Array<{ role: string; content: unknown }>
    expect(system.role).toBe('system')
    expect(JSON.stringify(system.content)).not.toContain('Updated system prompt section')
    expect(JSON.stringify(hostContext)).toContain('当前应用上下文')
    // 只差采集时间的宿主快照不重复发送，易变内容只出现在最后一条之后
    expect(JSON.stringify(f.requests[2]).split('当前应用上下文').length - 1).toBe(1)
    const first = f.requests[0]
    await f.engine.command({ action: 'new' })
    await f.engine.command({ action: 'prompt', input: { text: '读取项目', context } })
    const reopened = f.requests[3]
    expect(JSON.stringify({ tools: reopened.tools, messages: reopened.messages })).toBe(JSON.stringify({ tools: first.tools, messages: first.messages }))
  })
  it('后台整理记忆在临时会话里进行：请求不带用户的对话，用户对话的历史与界面快照不变', async () => {
    const f = await fixture()
    const context = '{"workspace":{"id":"videoEdit"}}'
    await f.engine.command({ action: 'prompt', input: { text: '看看我的片子', context } })
    const before = await f.engine.command({ action: 'snapshot' }) as { sessionId: string; messages: unknown[] }
    await f.engine.command({ action: 'configure', input: { ...f.configuration, instructions: '整理记忆用的系统设定' } })
    await f.engine.command({ action: 'prompt', input: { text: '后台整理记忆：合并重复', context, background: true, requestId: 'run:memory' } })
    const organize = f.requests.at(-1)!
    expect(JSON.stringify(organize)).toContain('后台整理记忆：合并重复')
    expect(JSON.stringify(organize)).not.toContain('看看我的片子')
    const snapshots = f.events.flatMap(event => event.type === 'snapshot' ? [event.value] : [])
    expect(snapshots.every(value => value.sessionId === before.sessionId || value.sessionId === null)).toBe(true)
    expect(await f.engine.command({ action: 'snapshot' })).toMatchObject({ sessionId: before.sessionId, messages: before.messages, error: null, busy: false })
    // 用户的下一条消息只在原历史末尾追加，整理过程没有进用户对话
    await f.engine.command({ action: 'configure', input: f.configuration })
    await f.engine.command({ action: 'prompt', input: { text: '继续', context } })
    const next = f.requests.at(-1)!
    expect(JSON.stringify(next.messages.slice(0, f.requests[0].messages.length))).toBe(JSON.stringify(f.requests[0].messages))
    expect(JSON.stringify(next)).not.toContain('后台整理记忆')
    expect((await f.engine.command({ action: 'sessions' }) as unknown[])).toHaveLength(1)
  })
  it('正式 Responses 路径：中途按名加载专用工具后整个工具列表逐字节不变，定义进入对话末尾，输入只在末尾追加，新开对话首个请求逐字节一致', async () => {
    const f = await fixture({ contextWindow: 128000 }, 'openai-responses')
    await f.engine.command({ action: 'configure', input: { ...f.configuration, tools: applicationCatalog().tools } })
    const context = JSON.stringify({ surface: { id: 'workspace.video_edit' } })
    f.setResponsesToolPlan([{ name: 'load_application_tools', arguments: { names: ['export_video_edit'] } }])
    await f.engine.command({ action: 'prompt', input: { text: '导出前先看看', context } })
    f.setResponsesToolPlan([])
    await f.engine.command({ action: 'configure', input: { ...f.configuration, tools: applicationCatalog().tools } })
    await f.engine.command({ action: 'prompt', input: { text: '继续', context } })
    type ResponsesBody = { input: Array<{ type?: string; output?: unknown }>; tools: Array<{ name: string; description?: string }> }
    const requests = f.requests as unknown as ResponsesBody[]
    expect(requests).toHaveLength(3)
    expect(requests[0].tools.map(tool => tool.name)).toEqual(expect.arrayContaining(['call_application_tool', 'load_application_tools']))
    expect(requests[0].tools.map(tool => tool.name)).not.toContain('export_video_edit')
    // 各领域工具名写在加载工具的说明里，模型不必整领域加载
    expect(requests[0].tools.find(tool => tool.name === 'load_application_tools')?.description).toContain('export_video_edit')
    expect(JSON.stringify(requests[1].tools)).toBe(JSON.stringify(requests[0].tools))
    expect(JSON.stringify(requests[2].tools)).toBe(JSON.stringify(requests[0].tools))
    const definition = applicationCatalog().tools.find(tool => tool.name === 'export_video_edit')!
    const output = JSON.stringify(requests[1].input.find(item => item.type === 'function_call_output')?.output)
    expect(output).toContain(JSON.stringify(JSON.stringify({ name: definition.name, description: definition.description, parameters: definition.inputSchema })).slice(1, -1))
    for (let index = 1; index < requests.length; index++) {
      expect(JSON.stringify(requests[index].input.slice(0, requests[index - 1].input.length))).toBe(JSON.stringify(requests[index - 1].input))
    }
    await f.engine.command({ action: 'new' })
    f.setResponsesToolPlan([{ name: 'load_application_tools', arguments: { names: ['export_video_edit'] } }])
    await f.engine.command({ action: 'prompt', input: { text: '导出前先看看', context } })
    expect(JSON.stringify({ input: requests[3].input, tools: requests[3].tools })).toBe(JSON.stringify({ input: requests[0].input, tools: requests[0].tools }))
  }, 30000)
  it('只给有登记写法的模型声明最高两档；落到通用兜底的模型保持原行为', () => {
    const selected = (providerId: string, adapter: string, modelId: string, api: 'openai-responses' | 'openai-completions' = 'openai-responses') => ({ providerId, baseUrl: '', api, apiKey: '',
      model: { ...model, providerId, adapter, modelId, capabilities: { ...model.capabilities, reasoning: true } } })
    expect(embeddedThinkingLevelMap(selected('kimi', 'kimi', 'kimi-k3', 'openai-completions'), 'kimi')).toEqual({ xhigh: 'high', max: 'max' })
    // 档位按所走协议的写法换算：同为“极高”，DeepSeek 落 high，智谱 Responses 落 max
    expect(embeddedThinkingLevelMap(selected('deepseek', 'deepseek', 'deepseek-flash'), 'deepseek')).toEqual({ xhigh: 'high', max: 'max' })
    expect(embeddedThinkingLevelMap(selected('bigmodel', 'openai', 'glm-5.3'), 'bigmodel')).toEqual({ xhigh: 'max', max: 'max' })
    expect(embeddedModelCompat(selected('deepseek', 'deepseek', 'deepseek-v4-pro'), 'deepseek')).toEqual({ supportsDeveloperRole: false, supportsMidConvoSystemMessages: true })
    expect(embeddedModelCompat(selected('kimi', 'kimi', 'kimi-k3'), 'kimi')).toBeUndefined()
    expect(embeddedThinkingLevelMap(selected('minimax', 'minimax', 'MiniMax-M3'), 'minimax')).toBeUndefined()
    expect(embeddedThinkingLevelMap(selected('custom', 'openai-compatible', 'any'), 'custom')).toBeUndefined()
  })
  it('主模型是 DeepSeek flash 时自动挂服务端联网工具，其他供应商不挂', async () => {
    const f = await fixture({ reasoning: true }, 'openai-responses')
    await f.engine.command({ action: 'prompt', input: { text: '回答', context: '' } })
    const types = (index: number) => ((f.requests[index] as unknown as { tools?: Array<{ type?: string }> }).tools ?? []).map(tool => tool.type)
    expect(types(0)).not.toContain('deepseek_web_search')
    const deepseek = { ...f.configuration.model, providerId: 'deepseek',
      model: { ...f.configuration.model.model, providerId: 'deepseek', adapter: 'deepseek', modelId: 'deepseek-flash' } }
    await f.engine.command({ action: 'configure', input: { ...f.configuration, model: deepseek } })
    await f.engine.command({ action: 'prompt', input: { text: '查一下今天的新闻', context: '' } })
    expect(types(f.requests.length - 1)).toEqual(expect.arrayContaining(['function', 'deepseek_web_search', 'deepseek_read_url']))
  })
  it('用户选“低”思考档时仍原样发低，不被换算成别的档位', async () => {
    const f = await fixture({ reasoning: true }, 'openai-responses')
    const deepseek = { ...f.configuration.model, providerId: 'deepseek', reasoning: { enabled: true, effort: 'low' as const },
      model: { ...f.configuration.model.model, providerId: 'deepseek', adapter: 'deepseek' } }
    await f.engine.command({ action: 'configure', input: { ...f.configuration, model: deepseek } })
    await f.engine.command({ action: 'prompt', input: { text: '回答', context: '' } })
    expect((f.requests[0] as unknown as { reasoning?: { effort?: string } }).reasoning?.effort).toBe('low')
  })
  it('用户选“最高”思考档时按供应商登记的写法发出 max，不被 Pi 静默降成 high', async () => {
    const f = await fixture({ reasoning: true }, 'openai-responses')
    const deepseek = { ...f.configuration.model, providerId: 'deepseek', reasoning: { enabled: true, effort: 'max' as const },
      model: { ...f.configuration.model.model, providerId: 'deepseek', adapter: 'deepseek' } }
    await f.engine.command({ action: 'configure', input: { ...f.configuration, model: deepseek } })
    await f.engine.command({ action: 'prompt', input: { text: '回答', context: '' } })
    expect((f.requests[0] as unknown as { reasoning?: { effort?: string } }).reasoning?.effort).toBe('max')
  })
  it('MCP 拒绝写入被官方 SDK 保存为工具错误，模型收到单份恢复事实', async () => {
    const f = await fixture()
    const result = { ok: false, executionState: 'not_executed', message: '请读取项目列表后选择现有项目' }
    f.tool.mockResolvedValue(result)
    await f.engine.command({ action: 'prompt', input: { text: '读取项目', context: '' } })
    const reply = f.requests.at(-1)!.messages.find(message => message.role === 'tool')
    expect(reply?.content).toBe(JSON.stringify(result))
    const files = await fs.readdir(path.join(f.directory, 'sessions'), { recursive: true })
    const records = (await Promise.all(files.filter(file => file.endsWith('.jsonl')).map(file => fs.readFile(path.join(f.directory, 'sessions', file), 'utf8'))))
      .flatMap(text => text.trim().split('\n').map(line => JSON.parse(line) as { message?: { role: string; isError?: boolean } }))
    expect(records.find(record => record.message?.role === 'toolResult')?.message?.isError).toBe(true)
  })
  it('每次请求只有一份系统设定，相同宿主上下文不在多轮历史中重复堆叠', async () => {
    const f = await fixture()
    const context = '{"surface":"canvas","project":"original"}'
    await f.engine.command({ action: 'prompt', input: { text: '第一条', context } })
    await f.engine.command({ action: 'configure', input: f.configuration })
    await f.engine.command({ action: 'prompt', input: { text: '第二条', context } })
    const request = f.requests.at(-1)!
    expect(request.messages.filter(message => message.role === 'system')).toHaveLength(1)
    expect(JSON.stringify(request).split('当前应用上下文').length - 1).toBe(1)
    await f.engine.command({ action: 'prompt', input: { text: '第三条', context: '{"surface":"settings"}' } })
    expect(JSON.stringify(f.requests.at(-1)).split('当前应用上下文').length - 1).toBe(2)
  })
  it('Responses 链路发送原生图片；续聊时那条带图消息原样再发，不改写历史', async () => {
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
      expect(f.requests[0].input?.find((message) => message.role === 'user')?.content).toEqual(expect.arrayContaining([
        { type: 'input_image', image_url: 'data:image/png;base64,bWVkaWE=', detail: 'auto' },
      ]))
    // 带图的那条用户消息在下一回合逐字节不变，其后的历史才能继续命中前缀缓存
    const imageMessage = (index: number) => JSON.stringify(f.requests[index].input?.find((message) => message.role === 'user'))
    expect(imageMessage(1)).toBe(imageMessage(0))
    expect(JSON.stringify(f.requests[1])).toContain('asset:image')
    await restarted.command({ action: 'configure', input: { ...f.configuration, model: { ...f.configuration.model,
      model: { ...f.configuration.model.model, capabilities: { ...f.configuration.model.model.capabilities, image: false } } } } })
    await restarted.command({ action: 'prompt', input: { text: '改为文字交流', context: '' } })
    expect(JSON.stringify(f.requests[2])).not.toContain('data:image/')
    expect(JSON.stringify(f.requests[2])).toContain('asset:image')
    expect(await restarted.command({ action: 'snapshot' })).toMatchObject({ error: null })
  }, 30000)
  it('附件进入本轮工具循环的 HTTP 请求，冷启动保留附件引用', async () => {
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
    expect(snapshot).toMatchObject({ messages: [{ text: '分析这些附件', attachments: attachments.map((item) => item.attachment) }, { kind: 'tool' }, { text: '已经读取项目。' }] })
    expect(JSON.stringify(snapshot)).not.toContain('bWVkaWE=')
    const sessions = await f.engine.command({ action: 'sessions' }) as Array<{ id: string }>
    const restarted = new PiEngine(() => {}, async () => ({ ok: true }))
    cleanup.push(() => restarted.dispose())
    await restarted.command({ action: 'initialize', input: f.directory })
    await restarted.command({ action: 'open', input: sessions[0].id })
    expect(await restarted.command({ action: 'snapshot' })).toMatchObject({ messages: [{ attachments: attachments.map((item) => item.attachment) }, { kind: 'tool' }, { kind: 'answer' }] })
  }, 30000)
  it('附件标记的媒体预算在实际请求前拒绝，不向供应商发送超限请求', async () => {
    const f = await fixture({ image: true, contextWindow: 7500 })
    await f.engine.command({ action: 'prompt', input: { text: '普通文字', context: '' } })
    expect(f.requests).toHaveLength(2)
    const attachment = { schemaVersion: 'agent-attachment/v1' as const, mediaRef: 'asset:image', modality: 'image' as const, mimeType: 'image/png', sizeBytes: 5,
      displayName: '图片.png', dataClass: 'C1' as const, lifecycle: 'asset_library' as const, sourceStatus: 'ready' as const }
    await f.engine.command({ action: 'prompt', input: { text: '看图', context: '', attachments: [{ attachment, data: 'bWVkaWE=' }] } })
    expect(await f.engine.command({ action: 'snapshot' })).toMatchObject({ error: expect.stringContaining('上下文预算') })
    expect(f.requests).toHaveLength(2)
  })
  it('助手目录里的 Pi 插件注册的工具进入首次请求的工具列表，换界面引导时不被换掉', async () => {
    const f = await fixture()
    await fs.mkdir(path.join(f.directory, 'extensions'), { recursive: true })
    await fs.writeFile(path.join(f.directory, 'extensions', 'probe.ts'), `import { Type } from 'typebox'
export default function (pi) {
  pi.registerTool({ name: 'probe_tool', label: '探针', description: '测试插件工具', parameters: Type.Object({}),
    async execute() { return { content: [{ type: 'text', text: 'ok' }], details: undefined } } })
}`)
    await f.engine.command({ action: 'configure', input: f.configuration })
    await f.engine.command({ action: 'prompt', input: { text: '你好', context: '{"surface":{"id":"workspace.canvas"}}' } })
    expect(f.requests[0].tools.map(tool => tool.function.name)).toContain('probe_tool')
  })
  it('真实 SDK 把应用工具交给宿主执行，流式输出并恢复官方会话文件', async () => {
    const f = await fixture()
    await f.engine.command({ action: 'prompt', input: { text: '读取项目', context: '{"workspace":"canvas"}' } })
    expect(f.tool).toHaveBeenCalledOnce()
    expect(f.tool.mock.calls[0]).toMatchObject(['call_fixture', 'read_project', { id: 'project' }, expect.any(AbortSignal)])
    expect(f.requests).toHaveLength(2)
    expect(f.requests[0].tools.map((tool) => tool.function.name)).toEqual(['read_assistant_context', 'read_project', 'run_application_script', ...LOCAL_TOOLS].sort())
    expect(f.requests[0].messages[0].content).toContain('痕迹助手')
    const final = f.events.filter((event) => event.type === 'snapshot').at(-1)
    expect(final).toMatchObject({ value: { busy: false, error: null, messages: [{ text: '读取项目' }, { kind: 'tool', status: 'completed' }, { text: '已经读取项目。', kind: 'answer' }] } })
    const sessions = await f.engine.command({ action: 'sessions' }) as Array<{ id: string }>
    expect(sessions).toHaveLength(1)
    await f.engine.command({ action: 'new' })
    await f.engine.command({ action: 'open', input: sessions[0].id })
    expect(await f.engine.command({ action: 'snapshot' })).toMatchObject({ messages: [{ text: '读取项目' }, { kind: 'tool', status: 'completed' }, { text: '已经读取项目。', kind: 'answer' }] })
    await expect(f.engine.command({ action: 'open', input: '../auth.json' })).rejects.toThrow('不存在')
    const restarted = new PiEngine(() => {}, async () => ({ ok: true }))
    cleanup.push(() => restarted.dispose())
    await restarted.command({ action: 'initialize', input: f.directory })
    await restarted.command({ action: 'open', input: sessions[0].id })
    expect(await restarted.command({ action: 'snapshot' })).toMatchObject({ messages: [{ text: '读取项目' }, { kind: 'tool', status: 'completed' }, { text: '已经读取项目。', kind: 'answer' }] })
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
    expect(f.events.filter(event => event.type === 'log' && event.phase !== 'usage_summary').at(-1)).toMatchObject({ phase: 'cancelled' })
  }, 30000)
})

it('正式 Pi 模型失败自动调用同源本地整理，不重试模型或应用作品', async () => {
  const f = await fixture(); f.setMode('error')
  f.tool.mockResolvedValue({ ok: true, data: { status: 'candidate' } })
  const draftRef = { kind: 'video_edit.intent_draft' as const, id: 'document:draft' }
  await f.engine.command({ action: 'prompt', input: { text: '整理讲解', context: '', creativeIntent: { documentRef: { kind: 'video_edit.document', id: 'document' }, sessionId: 'session', draftRefs: [draftRef] } } })
  expect(f.requests).toHaveLength(1)
  expect(f.tool).toHaveBeenCalledWith(expect.any(String), 'organize_intent', { draftRef, operationId: expect.any(String) }, undefined)
  expect(await f.engine.command({ action: 'snapshot' })).toMatchObject({ busy: false, error: null })
})


function disclosureFixture(catalog: Array<{ name: string; description?: string; inputSchema: unknown }>) {
  let active: string[] = []
  const messages: AgentSession['messages'] = []
  const session = { getActiveToolNames: () => active, setActiveToolsByName: (names: string[]) => { active = names }, messages } as unknown as AgentSession
  const tools: ToolDefinition[] = catalog.map(tool => ({ ...tool, label: tool.name, description: tool.description ?? tool.name,
    parameters: tool.inputSchema as ToolDefinition['parameters'], execute: async () => ({ content: [], details: undefined }) }))
  const disclosure = new PiToolDisclosure([...tools, contextReader(SessionManager.inMemory(), 4000)], () => session)
  const load = async (request: Record<string, unknown>) => {
    const result = await disclosure.tools.find(tool => tool.name === 'load_application_tools')!.execute('load', request, undefined, undefined, {} as never)
    const content = result.content[0]
    if (content.type !== 'text') throw new Error('missing loader result')
    return { result, data: JSON.parse(content.text) as { tools: Array<{ name: string; description: string; parameters: unknown }>; declaredTools?: string[]; loadedEarlier?: string[]; directory?: Array<{ domain: string; tools: string[] }> } }
  }
  return { disclosure, messages, active: () => active, load }
}

it('按领域只返回工具目录，按名返回定义；两者都不改原生工具列表', async () => {
  const catalog = [...applicationCatalog().tools, ...(await embeddedSkillCatalog()).tools]
  for (const [surface, domain, names] of [
    ['workspace.video_edit', 'video_edit', ['trim_video_edit_clip', 'save_video_edit', 'undo_video_edit']],
    ['tool.image_edit', 'image_edit', ['select_image_edit_region', 'repair_image_edit_region', 'export_image_edit_target_to_canvas']],
  ] as const) {
    const { disclosure, active, load } = disclosureFixture(catalog)
    disclosure.prepareContext(JSON.stringify({ surface: { id: surface } }), surface)
    const initial = [...active()]
    const listed = (await load({ domains: [domain] })).data
    expect(listed.tools).toEqual([])
    // 目录给名字和一句用途，模型据此点名
    for (const name of names) expect(listed.directory![0].tools.some(line => line.startsWith(`${name}：`) && line.length > name.length + 4)).toBe(true)
    const loaded = (await load({ names: [...names] })).data
    expect(loaded.tools).toEqual([...names].sort().map(name => {
      const tool = catalog.find(item => item.name === name)!
      return { name, description: tool.description, parameters: tool.inputSchema }
    }))
    expect(active()).toEqual(initial)
    await expect(load({})).rejects.toThrow(/names/)
  }
})

it('已在工具列表里的工具不重复给定义；前文给过定义的只点名，对话压缩掉那条结果后重新给出', async () => {
  const { disclosure, messages, load } = disclosureFixture(applicationCatalog().tools)
  disclosure.prepareContext(JSON.stringify({ surface: { id: 'workspace.video_edit' } }), 'workspace.video_edit')
  const first = await load({ names: ['trim_video_edit_clip', 'observe_video_edit_frame'] })
  expect(first.data.tools.map(tool => tool.name)).toEqual(['trim_video_edit_clip'])
  expect(first.data.declaredTools).toEqual(['observe_video_edit_frame'])
  messages.push({ role: 'toolResult', toolCallId: 'load', toolName: 'load_application_tools', content: first.result.content, details: first.result.details as never, isError: false, timestamp: 0 })
  expect((await load({ names: ['trim_video_edit_clip', 'export_video_edit'] })).data).toMatchObject({ tools: [{ name: 'export_video_edit' }], loadedEarlier: ['trim_video_edit_clip'] })
  messages.length = 0
  expect((await load({ names: ['trim_video_edit_clip'] })).data.tools.map(tool => tool.name)).toEqual(['trim_video_edit_clip'])
})

it('发送时选区保留完整数量与分页，改变选区及冷恢复后仍读取原快照', async () => {
  const f = await fixture()
  const selected = { capturedAt: '2026-10-12T00:00:00Z', selectedRefs: Array.from({ length: 90 }, (_, i) => `video_edit.item:original:${i}`),
    selectedClipRefs: Array.from({ length: 160 }, (_, i) => `video_edit.clip:original:${i}`), targetTrackRefs: [] as string[] }
  f.setToolPlan([])
  await f.engine.command({ action: 'prompt', input: { text: '处理全部选中对象', context: '{}', selectionSnapshot: selected } })
  const request = JSON.stringify(f.requests[0])
  expect(request).toContain(JSON.stringify('"count":160').slice(1, -1))
  expect(request).not.toContain('video_edit.clip:original:159')
  const sessionId = (await f.engine.command({ action: 'snapshot' }) as { sessionId: string }).sessionId
  const sessions = await SessionManager.list(f.directory, path.join(f.directory, 'sessions'))
  const file = sessions.find(item => item.id === sessionId)!.path
  selected.selectedClipRefs.splice(0)
  const manager = SessionManager.open(file, path.join(f.directory, 'sessions'), f.directory)
  const entry = manager.getBranch().find(entry => entry.type === 'custom_message')!
  if (entry.type !== 'custom_message') throw new Error('missing context')
  const id = (entry.details as { selectionId: string }).selectionId
  const reader = contextReader(manager, 2000)
  const refs: string[] = []; let offset = 0; let hasMore = true
  while (hasMore) {
    const result = await reader.execute('page', { reference: `selection:${id}:selectedClipRefs`, offset }, undefined, undefined, {} as never)
    const content = result.content[0]
    if (content.type !== 'text') throw new Error('missing page')
    const page = JSON.parse(content.text) as { data: string[]; total: number; nextOffset: number; hasMore: boolean }
    expect(page.total).toBe(160); refs.push(...page.data); offset = page.nextOffset; hasMore = page.hasMore
  }
  expect(refs).toEqual(Array.from({ length: 160 }, (_, i) => `video_edit.clip:original:${i}`))
  expect(f.tool).not.toHaveBeenCalled()
})
