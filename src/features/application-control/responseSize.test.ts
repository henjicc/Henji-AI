// @vitest-environment jsdom
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { z } from 'zod'
import { catalog as runtimeCatalog } from '@henjicc/ai-sdk'
import { registry } from '@/core/ModelRegistry'
import { composeModelDefinition } from '@/core/composeModelDefinition'
import { modelPresentations } from '@/models/presentation'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '@/core/application-control/builtinApplicationCapabilityRegistry'
import { APPLICATION_CAPABILITY_IDS, APPLICATION_WRITE_CAPABILITY_IDS, type LocalTool } from '@/core/application-control/localHostContracts'
import { buildExternalCapabilityInventory } from './externalCapabilityInventory'
import { buildApplicationContract, buildApplicationToolCatalog } from '../../../electron/main/services/application-runtime/toolCatalog'
import { projectApplicationToolResult, RESULT_DETAIL_FIELDS } from '../../../electron/main/services/application-runtime/resultProjection'
import { scanAssistantSkills } from '../../../electron/main/services/assistant/skills/registry'
import { AGENT_SKILL_NAMES } from '../../../electron/main/services/assistant/skills/agentSkills'
import { getGenerationModelSchema, searchGenerationModelCatalog } from '../generation/application/generationPreparationService'
import { toMcpResult } from '../../../electron/main/services/mcp/resultProjection'

afterEach(() => registry.clear())

/** 正式目录/技能/模型 + 确定性领域回执，无模型请求或用户工程写入。 */
it('代表性调用序列与 tools/list 的字符预算可重复测量', async () => {
  const access = { allowWrites: true, allowDestructive: true, allowPaid: true }
  const hostTools: LocalTool[] = APPLICATION_CAPABILITY_IDS.map(id => {
    const definition = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(id)!
    return { id, version: definition.version, title: definition.title, description: definition.description,
      inputSchema: z.toJSONSchema(definition.inputSchema, { io: 'input' }) }
  })
  const catalog = buildApplicationToolCatalog({ tools: hostTools, access, operationsEnabled: true, includeSkillTool: true })
  const domains = buildExternalCapabilityInventory()
  const skills = (await scanAssistantSkills({ builtinDir: path.resolve('resources/assistant-skills'), userDir: '', disabledNames: [] })).skills
    .filter(skill => skill.enabled && AGENT_SKILL_NAMES.has(skill.name)).map(({ name, description }) => ({ name, description }))
  const contractInput = { domains, skills, access, catalog, port: 43821, requestedDomains: [] }
  const contractBefore = { ok: true, data: buildApplicationContract({ ...contractInput, detail: 'full' }) }
  const contractAfter = { ok: true, data: buildApplicationContract(contractInput) }
  expect(JSON.stringify(contractAfter).length).toBeLessThan(4000)
  for (const kind of ['external', 'embedded'] as const) for (const grants of [access, { allowWrites: false, allowDestructive: false, allowPaid: false }]) {
    expect(JSON.stringify({ ok: true, data: buildApplicationContract({ ...contractInput, callerKind: kind, access: grants }) }).length).toBeLessThan(4000)
  }
  expect(skills).toHaveLength(6)

  const scopeRevisions = Object.fromEntries(domains.map((domain, index) => [domain.id, index]))
  const revisionEnvelope = { revision: 12, scopeRevisions }
  const ref = { kind: 'video_edit.document', id: 'sample-document' }
  const refs = Array.from({ length: 12 }, (_, index) => ({ kind: 'video_edit.clip', id: `sample-document:clip-${index}` }))
  const evidence = refs.map(target => ({ kind: 'property_value', target, fact: '已核对片段名称', data: '片段', capturedAt: new Date(0).toISOString() }))
  const listed = { ok: true, resultingRevision: 12, resultingScopeRevisions: scopeRevisions, data: { ...revisionEnvelope,
    refs, items: refs.map((ref, index) => ({ ref, properties: { name: `片段 ${index}` } })), nextCursor: null, revisions: { 'video_edit:sample-document': 2 } } }
  const changed = { ok: true, operationId: 'sample-operation', executionState: 'completed' as const, verificationState: 'verified', recoveryResult: null,
    result: { ok: true, resultingRevision: 12, resultingScopeRevisions: scopeRevisions, data: { ...revisionEnvelope,
      status: 'completed', transactionRef: 'sample-transaction', undoRef: 'sample-undo', resultRefs: refs,
      effects: [{ effect: 'update', entityType: 'video_edit.clip', refs, propertyIds: ['video_edit.clip.name'] }],
      verification: { verified: true, evidence, unmetConditions: [], checkedAt: new Date(0).toISOString() }, evidence,
      resultingRevisions: { 'video_edit:sample-document': 2 } } } }
  const frame = { ok: true, resultingRevision: 12, resultingScopeRevisions: scopeRevisions, data: { ...revisionEnvelope,
    frame: 24, mediaRef: { kind: 'video_edit.frame', id: 'sample-document:frame-24' }, width: 1920, height: 1080 } }
  registry.clear()
  for (const runtime of runtimeCatalog.filter(model => model.meta.type === 'image' && modelPresentations[model.meta.id]).slice(0, 8)) {
    registry.register(composeModelDefinition(runtime, modelPresentations[runtime.meta.id]))
  }
  const search = searchGenerationModelCatalog({ query: '', mediaType: 'image' })
  expect(search.models.length).toBeGreaterThan(0)
  const models = search.models.slice(0, 8)
  const modelId = String(models[0].modelId)
  const found = { ok: true, data: { ...revisionEnvelope, catalogVersion: 'model-registry/v1', models, nextCursor: null } }
  const schema = { ok: true, data: { ...revisionEnvelope, ...getGenerationModelSchema(modelId) } }
  const cases = [
    { name: 'describe_application_contract', before: contractBefore, after: contractAfter },
    ...[
      { name: 'list_application_entities', args: { entityType: 'video_edit.clip' }, raw: listed },
      { name: 'change_application_entities', args: { changes: [{ entityType: 'video_edit.clip', target: refs[0] }] }, raw: changed },
      { name: 'observe_video_edit_frame', args: { documentRef: ref }, raw: frame },
      { name: 'search_models', args: {}, raw: found },
      { name: 'get_model_schema', args: { modelId }, raw: schema },
    ].map(({ name, args, raw }) => ({ name, before: raw, after: projectApplicationToolResult(name, args, raw) })),
  ]
  const rows = cases.map(({ name, before, after }) => {
    const oldSize = JSON.stringify(before).length
    const newSize = JSON.stringify(after).length
    expect(newSize, name).toBeLessThan(oldSize)
    return { name, before: oldSize, after: newSize, reduction: `${((1 - newSize / oldSize) * 100).toFixed(1)}%` }
  })
  // t168 已实现 image content；t169 不计二进制图片为文本收益。
  const image = toMcpResult({ ok: true, data: { mode: 'image', mimeType: 'image/jpeg', base64: 'sample-image', totalBytes: 12 } })
  expect(image.content[0]).not.toHaveProperty('data')
  expect(JSON.stringify(image.structuredContent)).not.toContain('sample-image')

  // 从正式声明重建 t168 的工具目录，仅还原本任务改过的投影字段。
  const oldContractDescription = '发现入口：返回对外契约版本、支持的协议与传输限制、本连接的授权档位、被授权档位挡住的工具，以及按域划分的可读写范围。domains 留空只返回域级摘要；给定域名才展开该域的实体清单，避免一次注入全部属性。'
  const legacyTools = catalog.tools.map(tool => {
    const definition = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(tool.name)
    const properties = { ...tool.inputSchema.properties as Record<string, unknown> }
    for (const key of Object.keys(RESULT_DETAIL_FIELDS)) delete properties[key]
    if (tool.name === 'describe_application_contract') delete properties.detail
    const write = APPLICATION_WRITE_CAPABILITY_IDS.some(id => id === tool.name)
    return { ...tool, description: tool.name === 'describe_application_contract' ? oldContractDescription
      : tool.name === 'export_video_edit' ? 'x'.repeat(815) // t168 基线已测得说明字符数，不复制长正文。
        : hostTools.find(host => host.id === tool.name)?.description ?? tool.description,
      inputSchema: { ...tool.inputSchema, properties },
      ...(definition && tool.name !== 'load_assistant_skill' ? { outputSchema: z.toJSONSchema(write
        ? z.object({ ok: z.literal(true), result: z.object({ ok: z.literal(true), data: definition.outputSchema }).passthrough() }).passthrough()
        : z.object({ ok: z.literal(true), data: definition.outputSchema }).passthrough(), { io: 'output' }) } : {}) }
  })
  const size = (tools: Array<{ description: string; inputSchema: unknown; outputSchema?: unknown }>) => ({ count: tools.length, descriptions: tools.reduce((sum, tool) => sum + tool.description.length, 0),
    inputSchemas: tools.reduce((sum, tool) => sum + JSON.stringify(tool.inputSchema).length, 0),
    outputSchemas: tools.reduce((sum, tool) => sum + (tool.outputSchema ? JSON.stringify(tool.outputSchema).length : 0), 0) })
  const report = { rows, tools: { before: size(legacyTools), after: size(catalog.tools) },
    longestDescriptions: [...catalog.tools].sort((a, b) => b.description.length - a.description.length).slice(0, 8).map(tool => ({ name: tool.name, chars: tool.description.length })) }
  if (process.env.HENJI_MCP_MEASUREMENT_FILE) writeFileSync(process.env.HENJI_MCP_MEASUREMENT_FILE, JSON.stringify(report, null, 2), 'utf8')
})
