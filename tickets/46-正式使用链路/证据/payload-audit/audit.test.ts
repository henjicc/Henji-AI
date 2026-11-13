// @vitest-environment jsdom
/**
 * 助手信息冗余度量（一次性，只读）：走与真实通道相同的序列化函数，把各类载荷写成 JSON 供 tokens.py 计数。
 * 运行：sh run.sh（同目录）。输出：.tmp/payload-audit/payloads.json 与 report.txt
 */
import { writeFileSync, readFileSync, readdirSync, statSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { z } from 'D:/VibeCode/Henji-AI/node_modules/zod'
import { catalog as runtimeCatalog } from 'D:/VibeCode/Henji-AI/packages/ai-sdk/src/index'
import { registry } from '@/core/ModelRegistry'
import { composeModelDefinition } from '@/core/composeModelDefinition'
import { modelPresentations } from '@/models/presentation'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '@/core/application-control/builtinApplicationCapabilityRegistry'
import { APPLICATION_CAPABILITY_IDS, type LocalTool } from '@/core/application-control/localHostContracts'
import { buildExternalCapabilityInventory } from '@/features/application-control/externalCapabilityInventory'
import { applicationReflectionHandlers } from '@/features/application-control/capabilities/applicationReflectionAdapter'
import { getApplicationReflectionRegistry } from '@/features/application-control/capabilities/applicationControlRegistry'
import { getGenerationModelSchema, prepareGenerationTask, publicGenerationPreparation, searchGenerationModelCatalog } from '@/features/generation/application/generationPreparationService'
import { MEMORY_RULES } from '@/core/assistant/memoryEntries'
import { PROJECT_PROGRESS_RULES } from '@/core/documents/projectProgress'
import { APPLICATION_TOOL_CONVENTIONS, buildApplicationContract, buildApplicationToolCatalog } from 'D:/VibeCode/Henji-AI/electron/main/services/application-runtime/toolCatalog'
import { PiToolDisclosure } from 'D:/VibeCode/Henji-AI/electron/main/services/embedded-agent/toolDisclosure'
import { contextReader } from 'D:/VibeCode/Henji-AI/electron/main/services/embedded-agent/contextReader'
import { SessionManager, type AgentSession, type ToolDefinition } from '@earendil-works/pi-coding-agent'
import { projectApplicationToolResult, RESULT_DETAIL_FIELDS } from 'D:/VibeCode/Henji-AI/electron/main/services/application-runtime/resultProjection'
import { scanAssistantSkills } from 'D:/VibeCode/Henji-AI/electron/main/services/assistant/skills/registry'
import { AGENT_SKILL_NAMES } from 'D:/VibeCode/Henji-AI/electron/main/services/assistant/skills/agentSkills'
import { basicTools, domainProfiles, surfaceProfile, taskProfiles } from 'D:/VibeCode/Henji-AI/electron/main/services/embedded-agent/toolDisclosureProfiles'
import { estimateContextTokens } from 'D:/VibeCode/Henji-AI/electron/main/services/embedded-agent/contextBudget'

const ROOT = 'D:/VibeCode/Henji-AI'
const OUT = process.env.PAYLOAD_AUDIT_OUT ?? path.join(ROOT, '.tmp/payload-audit')
const j = (value: unknown) => JSON.stringify(value)

it('payload audit', async () => {
  mkdirSync(OUT, { recursive: true })
  // ---------- 1. 工具目录（与 localApplicationHost 注册、dispatcher.catalog 相同的投影） ----------
  const hostTools: LocalTool[] = APPLICATION_CAPABILITY_IDS.map(id => {
    const d = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(id)!
    return { id, version: d.version, title: d.title, description: d.description, inputSchema: z.toJSONSchema(d.inputSchema, { io: 'input' }) }
  })
  const external = buildApplicationToolCatalog({ tools: hostTools, includeSkillTool: true })
  const embedded = buildApplicationToolCatalog({ tools: hostTools, includeSkillTool: false })
  const domainOf = (name: string) => BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(name)?.domain ?? null
  const detailFieldsJson = j(RESULT_DETAIL_FIELDS)
  const tools = external.tools.map(tool => {
    const pi = { name: tool.name, description: tool.description, parameters: tool.inputSchema }
    const props = (tool.inputSchema.properties ?? {}) as Record<string, unknown>
    return {
      name: tool.name, domain: domainOf(tool.name), write: tool.annotations?.readOnlyHint === false,
      description: tool.description,
      piText: j(pi),
      mcpListText: j(tool),
      inputSchemaText: j(tool.inputSchema),
      outputSchemaText: tool.outputSchema ? j(tool.outputSchema) : '',
      detailFieldsText: Object.keys(RESULT_DETAIL_FIELDS).every(k => k in props) ? detailFieldsJson : '',
      schemaKeyText: '$schema' in tool.inputSchema ? j({ $schema: (tool.inputSchema as Record<string, unknown>).$schema }) : '',
      envelopeText: 'operationId' in props ? j({ operationId: props.operationId, baselineIds: props.baselineIds }) : '',
      defsText: (tool.inputSchema as Record<string, unknown>).$defs ? j((tool.inputSchema as Record<string, unknown>).$defs) : '',
      // 对照：同一能力输入不抽 $defs（zod 默认 inline，循环引用才回退 ref）
      inlineSchemaText: (() => { const d = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(tool.name); if (!d) return ''; try { return j(z.toJSONSchema(d.inputSchema, { io: 'input', cycles: 'ref' })) } catch { return '' } })(),
    }
  })
  // Pi 首轮：basic + 非延迟工具 + 界面工具；load_application_tools 与 read_assistant_context 为 Pi 自带。
  const protocol = ['describe_application_contract', 'read_application_media', 'get_application_operation', 'retry_application_operation_save', 'review_application_operation']
  const deferred = new Set(embedded.tools.filter(t => !basicTools.has(t.name) && (domainOf(t.name) || protocol.includes(t.name))).map(t => t.name))
  const surfaces = ['workspace.generation', 'workspace.canvas', 'workspace.video_edit', 'tool.audio_edit', 'tool.image_edit', 'tool.camera_stage', 'tool.screen_recording', 'settings.general', 'workspace.unknown']
  const piSets: Record<string, string[]> = {}
  for (const s of surfaces) {
    const selected = new Set(surfaceProfile(s).tools)
    piSets[`initial:${s}`] = embedded.tools.filter(t => !deferred.has(t.name) || selected.has(t.name)).map(t => t.name).concat(['load_assistant_skill'])
  }
  const domains = [...new Set(embedded.tools.map(t => domainOf(t.name)).filter(Boolean))] as string[]
  for (const d of domains) piSets[`domain:${d}`] = embedded.tools.filter(t => domainOf(t.name) === d || (domainProfiles[d]?.tools ?? []).includes(t.name)).map(t => t.name)
  for (const [k, v] of Object.entries(taskProfiles)) piSets[`task:${k}`] = v.tools
  const piSurfaceGuidance = Object.fromEntries(surfaces.map(s => [s, surfaceProfile(s).guidance]))
  // 真实 Pi 首轮：经 PiToolDisclosure 本身（含 load_application_tools 及其说明与 read_assistant_context）。
  const piTools: ToolDefinition[] = embedded.tools.map(tool => ({ name: tool.name, label: tool.name, description: tool.description ?? tool.name,
    parameters: tool.inputSchema as ToolDefinition['parameters'], execute: async () => ({ content: [], details: undefined }) }))
  let active: string[] = []
  const fakeSession = { getActiveToolNames: () => active, setActiveToolsByName: (names: string[]) => { active = names }, messages: [] } as unknown as AgentSession
  const auditManager = SessionManager.inMemory()
  const disclosure = new PiToolDisclosure([...piTools, contextReader(auditManager, 16000)], () => fakeSession)
  const piRealSets: Record<string, string> = {}
  for (const s of surfaces) {
    disclosure.prepareContext(JSON.stringify({ surface: { id: s } }))
    piRealSets[`pi:${s}`] = j(disclosure.tools.filter(tool => active.includes(tool.name)).map(tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters })))
  }
  const loaderTool = disclosure.tools.find(tool => tool.name === 'load_application_tools')!
  const directoryText = await (async () => {
    const result = await loaderTool.execute('audit', { domains: ['video_edit'] } as never, undefined as never, undefined as never, undefined as never)
    return (result.content[0] as { text: string }).text
  })()

  // ---------- 2. 契约 ----------
  const inventory = buildExternalCapabilityInventory()
  const skillsScan = (await scanAssistantSkills({ builtinDir: path.resolve(ROOT, 'resources/assistant-skills'), userDir: '', disabledNames: [] })).skills
  const skills = skillsScan.filter(s => s.enabled && AGENT_SKILL_NAMES.has(s.name)).map(({ name, description }) => ({ name, description }))
  const contractInput = { domains: inventory, skills, catalog: external, port: 43821, requestedDomains: [] as string[] }
  const contract = {
    compactExternal: j({ ok: true, data: buildApplicationContract({ ...contractInput, callerKind: 'external' }) }),
    fullExternal: j({ ok: true, data: buildApplicationContract({ ...contractInput, callerKind: 'external', detail: 'full' }) }),
    compactVideoEdit: j({ ok: true, data: buildApplicationContract({ ...contractInput, callerKind: 'external', requestedDomains: ['video_edit'] }) }),
  }

  // ---------- 3. describe_application_entities（与正式处理器同函数，再经 projectApplicationToolResult） ----------
  const reg = getApplicationReflectionRegistry()
  const full = reg.describe({}, { exposure: 'assistant', acceptedDataClasses: new Set(['C0', 'C1'] as const) } as never)
  const describe: Record<string, unknown> = {}
  const project = (name: string, args: Record<string, unknown>, data: unknown) => j(projectApplicationToolResult(name, args, { ok: true, data } as never))
  for (const d of domains.concat(['documents', 'assistant', 'settings', 'audio_edit']).filter((v, i, a) => a.indexOf(v) === i)) {
    try {
      const args = { domains: [d], entityTypes: [], propertyIds: [], detail: 'compact' as const, limit: 40, refs: [] }
      const compact = await applicationReflectionHandlers.describeEntities(args, {} as never)
      const allPages = await applicationReflectionHandlers.describeEntities({ ...args, limit: 100000 }, {} as never)
      const fullAll = await applicationReflectionHandlers.describeEntities({ ...args, detail: 'full', limit: 100000 }, {} as never)
      describe[d] = { compactPage1: project('describe_application_entities', args, compact), compactAll: project('describe_application_entities', args, allPages), fullAll: project('describe_application_entities', args, fullAll),
        entities: (allPages.entities as unknown[]).length, properties: (allPages.properties as unknown[]).length }
    } catch (e) { describe[d] = { error: String(e) } }
  }
  // 单实体 full：剪辑片段 / 口播词块
  const entitySamples: Record<string, string> = {}
  for (const et of ['video_edit.clip', 'video_edit.sequence', 'audio_edit.document', 'audio_edit.word', 'canvas.node', 'documents.project']) {
    try {
      const args = { domains: [], entityTypes: [], entityType: et, propertyIds: [], detail: 'full' as const, limit: 100000, refs: [] }
      entitySamples[`${et}:full`] = project('describe_application_entities', args, await applicationReflectionHandlers.describeEntities(args, {} as never))
      const c = { ...args, detail: 'compact' as const }
      entitySamples[`${et}:compact`] = project('describe_application_entities', c, await applicationReflectionHandlers.describeEntities(c, {} as never))
    } catch (e) { entitySamples[et] = `error ${String(e)}` }
  }
  // 逐实体：compact / full 体积与失败
  const perEntity: Array<Record<string, unknown>> = []
  for (const entity of full.entities) {
    const base = { domains: [], entityTypes: [], entityType: entity.id, propertyIds: [], limit: 100000, refs: [] }
    const rowOf: Record<string, unknown> = { id: entity.id, domain: (entity as { domain?: string }).domain }
    for (const detail of ['compact', 'full'] as const) {
      try { rowOf[detail] = project('describe_application_entities', base, await applicationReflectionHandlers.describeEntities({ ...base, detail }, {} as never)) }
      catch (e) { rowOf[`${detail}Error`] = String(e) }
    }
    perEntity.push(rowOf)
  }
  const propertyStats = { entities: full.entities.length, properties: full.properties.length,
    props: full.properties.map(pr => ({ id: pr.id, entityType: pr.entityType, title: pr.title, description: pr.description, kind: (pr.value as { kind?: string }).kind, schemaRef: (pr.value as { schemaRef?: string }).schemaRef })) }

  // ---------- 4. 模型 ----------
  registry.clear()
  for (const runtime of runtimeCatalog) {
    const presentation = modelPresentations[runtime.meta.id]
    if (!presentation) continue
    try { registry.register(composeModelDefinition(runtime, presentation)) } catch { /* 个别展示补丁不完整时跳过 */ }
  }
  const models: Record<string, unknown> = {}
  for (const mediaType of ['image', 'video', 'audio'] as const) {
    const raw = searchGenerationModelCatalog({ query: '', mediaType })
    const page = { ...raw, models: raw.models.slice(0, 32), nextCursor: raw.models.length > 32 ? '32' : null }
    const args = { mediaType }
    models[`search:${mediaType}`] = { total: raw.models.length, raw: j({ ok: true, data: page }), projected: project('search_models', args, page),
      oneModelProjected: j((JSON.parse(project('search_models', args, page)).data.models ?? [])[0]),
      selectionEvidence: j(raw.models[0]?.selectionEvidence) }
  }
  const allIds = registry.listAllModels().map(m => m.meta.id)
  const schemas: Array<{ id: string; type: string; raw: string; projected: string }> = []
  for (const id of allIds) {
    try {
      const raw = getGenerationModelSchema(id)
      schemas.push({ id, type: String((raw.meta as { type?: string }).type), raw: j({ ok: true, data: raw }), projected: project('get_model_schema', { modelId: id }, raw) })
    } catch { /* 不可发现的模型 */ }
  }

  // prepare_generation_task 领域输出（未含宿主补的 providerConfigured/message），提示词 300 字
  const prepared: Record<string, string> = {}
  const prompt = '一只橘猫坐在窗台上看雨，'.repeat(25)
  for (const id of ['fal-ai-kling-4.0', 'fal-ai-gpt-image-2.6', 'ppio-minimax-speech']) {
    try {
      const m = registry.getModel(id)!
      // 与 prepare_generation_task 处理器同一份公开整形（不含宿主补的 providerConfigured/canSubmit/message）
      prepared[id] = j({ ok: true, data: { preparation: publicGenerationPreparation(prepareGenerationTask({ modelId: id, mediaType: m.meta.type as never, prompt, options: {} } as never)) } })
    } catch (e) { prepared[id] = `error ${String(e)}` }
  }

  // ---------- 5. 系统提示词与技能 ----------
  const serviceSource = readFileSync(path.join(ROOT, 'electron/main/services/embedded-agent/service.ts'), 'utf8')
  const systemTemplate = serviceSource.match(/const SYSTEM_INSTRUCTIONS = `([\s\S]*?)`\r?\n/)![1].replaceAll('\r\n', '\n')
  const system = systemTemplate.replace('${MEMORY_RULES}', MEMORY_RULES).replace('${PROJECT_PROGRESS_RULES}', PROJECT_PROGRESS_RULES).replace('${APPLICATION_TOOL_CONVENTIONS}', APPLICATION_TOOL_CONVENTIONS)
  const skillsIndexText = '\n可用技能 skills_index（只列元数据）：\n' + JSON.stringify(skills)
  const skillFiles: Array<{ path: string; chars: number; text: string }> = []
  const walk = (dir: string) => { for (const f of readdirSync(dir)) { const p = path.join(dir, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.md')) { const text = readFileSync(p, 'utf8'); skillFiles.push({ path: path.relative(ROOT, p).replaceAll('\\', '/'), chars: text.length, text }) } } }
  walk(path.join(ROOT, 'resources/assistant-skills'))

  const payload = { generatedAt: new Date().toISOString(), tools, piSets, piRealSets, directoryText, piSurfaceGuidance, contract, describe, entitySamples, perEntity, propertyStats, models, schemas, prepared,
    system, memoryRules: MEMORY_RULES, progressRules: PROJECT_PROGRESS_RULES, skillsIndexText, skillFiles,
    estimator: { sample: estimateContextTokens('测试 test') } }
  writeFileSync(path.join(OUT, 'payloads.json'), JSON.stringify(payload), 'utf8')
}, 300000)
