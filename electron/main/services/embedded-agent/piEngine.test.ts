import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { LlmModelConfig } from '@henjicc/ai-sdk'
import { PiEngine } from './piEngine'
import type { EngineEvent } from './contracts'
import { z } from 'zod'
import { buildMcpToolCatalog } from '../application-runtime/toolCatalog'
import { MCP_CAPABILITY_IDS } from '../../../../src/core/application-control/localHostContracts'
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
  let usage: Record<string, unknown> | undefined
  let toolPlan = [{ name: 'read_project', arguments: { id: 'project' } as Record<string, unknown> }]
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
  const configuration = { directory, model: { providerId: 'test', model: { ...model, capabilities: { ...model.capabilities, ...capabilities } }, baseUrl: `http://127.0.0.1:${address.port}/v1`, api, apiKey: 'fixture-key' },
    instructions: '你是测试中的痕迹助手。', tools: [{ name: 'read_project', description: '读取项目', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false } }] }
  await engine.command({ action: 'configure', input: configuration })
  return { engine, requests, events, tool, directory, configuration, setUsage: (value: Record<string, unknown>) => { usage = value }, setMode: (value: typeof mode) => { mode = value },
    setToolPlan: (value: typeof toolPlan) => { toolPlan = value } }
}
function applicationCatalog(allowWrites = true) {
    const tools = MCP_CAPABILITY_IDS.map(id => {
      const definition = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(id)!
      return { id, version: definition.version, title: definition.title, description: definition.description,
        inputSchema: z.toJSONSchema(definition.inputSchema, { io: 'input' }) as Record<string, unknown> }
    })
    return buildMcpToolCatalog({ tools, access: { allowWrites, allowDestructive: allowWrites, allowPaid: allowWrites }, operationsEnabled: true })
}

describe('Pi official SDK engine', () => {
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
      { name: 'wait_generation_task', arguments: { taskId: 'existing-task' } }])
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
    ['prompt-optimization', 'references/image.md', '图片表达一个视觉状态', '视频表达状态随时间的变化'],
    ['prompt-optimization', 'references/video.md', '视频表达状态随时间的变化', '图片表达一个视觉状态'],
    ['prompt-optimization', 'references/image-edit.md', '最小必要修改', '## 标记和坐标定位'],
    ['prompt-optimization', 'references/video-extension.md', '## 延长与连接', '## 声音、对白与文字'],
      ['cinematic-director', 'references/blocking.md', '接触动作描述接近', '像幻灯片'],
    ['cinematic-director', 'references/repair.md', '像幻灯片', '接触动作描述接近'],
    ['cinematic-director', 'references/canvas-workspace.md', '场景从上到下分区', '接触动作描述接近'],
    ['short-drama', 'references/resume.md', '重新读取工程当前状态', '对白保留原文和语言'],
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
    const f = await fixture({}, 'openai-responses')
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
      'get_canvas_project', 'change_application_entities', 'load_application_tools',
    ]))
    expect(initialTools).toHaveLength(6)
    expect(initialTools.map(tool => tool.name)).not.toEqual(expect.arrayContaining(['render_camera_stage_output']))
    expect(initialTools.map(tool => tool.name)).not.toContain('create_visible_generation_task')
    expect(initialTools.map(tool => tool.name)).not.toContain('get_canvas_node_schema')
    await f.engine.command({ action: 'prompt', input: { text: '编辑图片', context: '{"surface":{"id":"tool.image_edit"}}' } })
    const editTools = f.requests.at(-1)!.tools as unknown as Array<{ name: string }>
    expect(editTools.map(tool => tool.name)).not.toContain('get_canvas_project')
    expect(editTools.map(tool => tool.name)).not.toContain('create_image_edit_preview')
    const fullBytes = Buffer.byteLength(JSON.stringify(catalog.tools))
    expect(initialTools.length).toBeLessThan(catalog.tools.length / 2)
    expect(logs[0].requestMetrics!.toolBytes).toBeLessThan(fullBytes * 0.3)
    if (process.env.HENJI_PI_MEASURE === '1') process.stdout.write(`${JSON.stringify({ initialToolBytes: logs[0].requestMetrics!.toolBytes,
      fullToolBytes: fullBytes, initialToolCount: initialTools.length, contextCount: logs[1].requestMetrics!.contextCount })}\n`)
    for (const [surface, basic] of [['tool.camera_stage', 'get_camera_stage_project'], ['workspace.generation', 'search_models'], ['settings.general', 'search_application_settings']]) {
      await f.engine.command({ action: 'prompt', input: { text: '当前页面', context: JSON.stringify({ surface: { id: surface } }) } })
      const names = (f.requests.at(-1)!.tools as unknown as Array<{ name: string }>).map(tool => tool.name)
      expect(names).toHaveLength(6)
      expect(names).toContain(basic)
      expect(names).not.toContain('get_canvas_project')
      expect(names).not.toContain('create_visible_generation_task')
    }
  })

  it('画布一次加载生成闭环，跨界面不携带旧工具，回到原界面和冷恢复可复用且降权有效', async () => {
    const f = await fixture()
    const configuration = { ...f.configuration, tools: applicationCatalog().tools }
    const canvas = '{"surface":{"id":"workspace.canvas"},"project":{"id":"origin"}}'
    f.setToolPlan([{ name: 'load_application_tools', arguments: { task: 'canvas_generation' } },
      { name: 'get_model_schema', arguments: { modelId: 'fixture-model' } }])
    await f.engine.command({ action: 'configure', input: configuration })
    await f.engine.command({ action: 'prompt', input: { text: '在这里生成图片', context: canvas } })
    const names = (index: number) => f.requests.at(index)!.tools.map(tool => tool.function.name)
    expect(names(0)).toHaveLength(6)
    expect(names(0)).not.toContain('get_model_schema')
    expect(names(1)).toEqual(expect.arrayContaining(['get_model_schema', 'prepare_generation_task', 'create_visible_generation_task', 'wait_generation_task']))
    expect(names(1)).not.toContain('render_camera_stage_output')
    expect(names(1)).toEqual([...names(1)].sort())
    const loadedTools = f.requests[1].tools
    expect(f.tool).toHaveBeenCalledTimes(1)
    expect(f.tool.mock.calls[0]).toMatchObject([expect.any(String), 'get_model_schema', { modelId: 'fixture-model' }, expect.any(AbortSignal)])
    expect(f.requests).toHaveLength(3)
    expect(f.requests[1].messages.find(message => message.role === 'tool')?.content).toContain('原画布')
    await f.engine.command({ action: 'prompt', input: { text: '查看三维', context: '{"surface":{"id":"tool.camera_stage"}}' } })
    expect(names(-1)).toContain('get_camera_stage_project')
    expect(names(-1)).not.toContain('create_visible_generation_task')
    await f.engine.command({ action: 'prompt', input: { text: '继续画布任务', context: canvas } })
    expect(names(-1)).toContain('create_visible_generation_task')
    expect(f.requests.at(-1)!.tools).toEqual(loadedTools)
    const snapshot = await f.engine.command({ action: 'snapshot' }) as { sessionId: string }
    const restored = new PiEngine(() => undefined, f.tool)
    cleanup.push(() => restored.dispose())
    await restored.command({ action: 'initialize', input: f.directory })
    await restored.command({ action: 'configure', input: configuration })
    await restored.command({ action: 'open', input: snapshot.sessionId })
    await restored.command({ action: 'prompt', input: { text: '继续', context: canvas } })
    expect(names(-1)).toContain('create_visible_generation_task')
    expect(f.requests.at(-1)!.tools).toEqual(loadedTools)
    await restored.command({ action: 'configure', input: { ...configuration, tools: applicationCatalog(false).tools } })
    await restored.command({ action: 'prompt', input: { text: '只读', context: canvas } })
    expect(names(-1)).not.toContain('create_visible_generation_task')
    expect(names(-1)).not.toContain('change_application_entities')
  })

  it.each([
    { name: 'create_image_edit_preview', arguments: {} },
    { name: 'duplicate_canvas_node', arguments: { domains: ['canvas'] } },
  ])('官方 SDK 按需加载 $name 后可调用，冷恢复保留状态且降权不恢复无权工具', async ({ name, arguments: loadArguments }) => {
    const f = await fixture()
    const configuration = { ...f.configuration, tools: [...f.configuration.tools,
      { name, description: '待加载业务工具', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false } }] }
    f.setToolPlan([{ name: 'load_application_tools', arguments: loadArguments }, { name, arguments: { id: 'image' } }])
    await f.engine.command({ action: 'configure', input: configuration })
    await f.engine.command({ action: 'prompt', input: { text: '编辑图片', context: '' } })
    expect(f.requests[0].tools.map(tool => tool.function.name)).not.toContain(name)
    expect(JSON.stringify(f.requests[0].tools)).not.toContain('commit_image_edit')
    expect(f.requests[1].tools.map(tool => tool.function.name)).toContain(name)
    expect(f.tool).toHaveBeenCalledTimes(1)
    expect(f.tool.mock.calls[0]).toMatchObject(['call_fixture_1', name, { id: 'image' }, expect.any(AbortSignal)])
    const original = await f.engine.command({ action: 'snapshot' }) as { sessionId: string }
    const restored = new PiEngine(() => undefined, f.tool)
    cleanup.push(() => restored.dispose())
    await restored.command({ action: 'initialize', input: f.directory })
    await restored.command({ action: 'configure', input: configuration })
    await restored.command({ action: 'open', input: original.sessionId })
    await restored.command({ action: 'prompt', input: { text: '继续', context: '' } })
    expect(f.requests.at(-1)!.tools.map(tool => tool.function.name)).toContain(name)
    await restored.command({ action: 'configure', input: f.configuration })
    await restored.command({ action: 'prompt', input: { text: '只读', context: '' } })
    expect(f.requests.at(-1)!.tools.map(tool => tool.function.name)).toEqual(['read_project'])
    await restored.command({ action: 'configure', input: configuration })
    await restored.command({ action: 'new' })
    f.setMode('error')
    await restored.command({ action: 'prompt', input: { text: '新对话', context: '' } })
    expect(f.requests.at(-1)!.tools.map(tool => tool.function.name)).not.toContain(name)
  })

  it('记录每轮供应商实际用量和缓存读取，并沿用宿主消息关联标识', async () => {
    const f = await fixture({}, 'openai-responses')
    await f.engine.command({ action: 'prompt', input: { text: '第一轮', context: '', requestId: 'request-first' } })
    await f.engine.command({ action: 'prompt', input: { text: '第二轮', context: '', requestId: 'request-second' } })
    for (const requestId of ['request-first', 'request-second']) {
      const logs = f.events.filter(event => event.type === 'log' && event.requestId === requestId)
      expect(logs).toEqual([
        expect.objectContaining({ phase: 'start' }),
        expect.objectContaining({ phase: 'model_requested', requestMetrics: expect.objectContaining({ toolCount: 1, toolBytes: expect.any(Number) }) }),
        expect.objectContaining({ phase: 'model_completed', modelId: 'fixture', providerId: 'test', durationMs: expect.any(Number),
          metrics: { input: 70, output: 10, cacheRead: 30, cacheWrite: 0, totalTokens: 110 } }),
        expect.objectContaining({ phase: 'completed', durationMs: expect.any(Number) }),
        expect.objectContaining({ phase: 'usage_summary', summary: expect.objectContaining({ requests: 1, cacheHitRate: 0.3 }) }),
      ])
      expect(JSON.stringify(logs)).not.toContain('fixture-key')
      expect(JSON.stringify(logs)).not.toContain('第一轮')
    }
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
    expect(snapshot).toMatchObject({ messages: [{ text: '分析这些附件', attachments: attachments.map((item) => item.attachment) }, { kind: 'tool' }, { text: '已经读取项目。' }] })
    expect(JSON.stringify(snapshot)).not.toContain('bWVkaWE=')
    const sessions = await f.engine.command({ action: 'sessions' }) as Array<{ id: string }>
    const restarted = new PiEngine(() => {}, async () => ({ ok: true }))
    cleanup.push(() => restarted.dispose())
    await restarted.command({ action: 'initialize', input: f.directory })
    await restarted.command({ action: 'open', input: sessions[0].id })
    expect(await restarted.command({ action: 'snapshot' })).toMatchObject({ messages: [{ attachments: attachments.map((item) => item.attachment) }, { kind: 'tool' }, { kind: 'answer' }] })
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
