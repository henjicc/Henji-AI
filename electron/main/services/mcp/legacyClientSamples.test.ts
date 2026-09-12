// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { z } from 'zod'
import { LocalMcpServer } from './server'
import { McpConnections } from './connections'
import { ApplicationHostBridge } from './applicationHostBridge'
import { buildMcpToolCatalog } from './toolCatalog'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '../../../../src/core/assistant/builtinApplicationCapabilityRegistry'
import { MCP_CAPABILITY_IDS, type LocalHostRequest, type LocalTool } from '../../../../src/core/application-control/localHostContracts'

/**
 * 旧调用样本回放。
 *
 * 这些是 1.2／2.1／2.2 三个阶段对外公布过的真实调用形状。它们存在的唯一目的，是让"对外工具
 * 改名、给已发布参数加必填项、把可选字段变成必填"这三类破坏在合并前就变红——对外契约的弃用
 * 规则不能只写在文档里，否则它只在有人记得的时候才成立。
 *
 * 回放方式是**用能力定义自己的 Zod 输入 schema 验证旧样本**，不是另抄一份期望值；写工具的
 * 协议信封先剥掉再验，因为信封属于协议层而不是领域参数。
 */
type Sample = { era: string; tool: string; arguments: Record<string, unknown> }

const LEGACY_SAMPLES: Sample[] = [
  { era: '图片编辑闭环', tool: 'create_image_edit_preview', arguments: {
    operationId: '2f6d2a4c-3d1b-4d5a-9f3a-1b2c3d4e5f60', sourceRef: { kind: 'asset', id: 'source-image' },
    operations: [{ kind: 'rotate_cw', degrees: 90 }],
  } },
  { era: '图片编辑闭环', tool: 'commit_image_edit', arguments: {
    operationId: '3f6d2a4c-3d1b-4d5a-9f3a-1b2c3d4e5f60', previewRef: 'image-edit-preview:fixture', displayName: '旋转图片',
  } },
  { era: '图片能力节点编排', tool: 'apply_canvas_image_capability', arguments: {
    operationId: '2f6d2a4c-3d1b-4d5a-9f3a-1b2c3d4e5f60',
    projectId: 'project-1', sourceNodeId: 'image-1', capabilityId: 'image.background-removal',
  } },
  { era: '1.2 只读首版', tool: 'describe_application_entities', arguments: {} },
  { era: '1.2 只读首版', tool: 'describe_application_entities', arguments: { domains: ['settings'] } },
  { era: '1.2 只读首版', tool: 'list_application_entities', arguments: { entityType: 'canvas.project' } },
  { era: '1.2 只读首版', tool: 'read_application_entity', arguments: { ref: { kind: 'settings.registry', id: 'singleton' }, propertyIds: ['interface.theme_tone'] } },
  {
    era: '2.1 受控写入', tool: 'change_application_entities',
    arguments: {
      operationId: '2f6d2a4c-3d1b-4d5a-9f3a-1b2c3d4e5f60',
      baselineIds: ['8a7b6c5d-4e3f-4a2b-8c1d-0e9f8a7b6c5d'],
      summary: '把界面主题改成深色',
      changes: [{ kind: 'set_properties', entityType: 'settings.registry', target: { kind: 'settings.registry', id: 'singleton' }, properties: { 'interface.theme_tone': 'slate' } }],
    },
  },
  {
    era: '2.1 受控删除', tool: 'change_application_entities',
    arguments: {
      operationId: '3f6d2a4c-3d1b-4d5a-9f3a-1b2c3d4e5f61',
      baselineIds: ['9a7b6c5d-4e3f-4a2b-8c1d-0e9f8a7b6c5d'],
      summary: '删掉一张画布节点',
      changes: [{ kind: 'remove_items', entityType: 'canvas.node', parent: { kind: 'canvas.project', id: 'project-1' }, targets: [{ kind: 'canvas.node', id: 'project-1:node-1' }] }],
    },
  },
  { era: '2.2 后台任务', tool: 'get_generation_task', arguments: { taskId: 'f1e2d3c4-b5a6-4978-8899-aabbccddeeff' } },
  { era: '2.2 后台任务', tool: 'get_camera_stage_render_task', arguments: { taskRef: { kind: 'camera_stage.render_task', id: 'render-1' } } },
]

/** 协议工具没有领域定义，按发布过的 JSON Schema 必填项核对：不能悄悄给旧样本加必填。 */
const LEGACY_PROTOCOL_SAMPLES: Sample[] = [
  { era: '2.1 保存恢复', tool: 'retry_application_operation_save', arguments: { operationId: '4f6d2a4c-3d1b-4d5a-9f3a-1b2c3d4e5f62', originalOperationId: '2f6d2a4c-3d1b-4d5a-9f3a-1b2c3d4e5f60' } },
  { era: '2.1 事实查询', tool: 'get_application_operation', arguments: { operationId: '2f6d2a4c-3d1b-4d5a-9f3a-1b2c3d4e5f60' } },
  { era: '2.2 媒体分块', tool: 'read_application_media', arguments: { ref: { kind: 'generation.result', id: 'task-1' }, outputIndex: 0, offset: 0 } },
]

const hostTools: LocalTool[] = MCP_CAPABILITY_IDS.map((id) => {
  const definition = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(id)!
  return { id, version: definition.version, title: definition.title, description: definition.description, inputSchema: z.toJSONSchema(definition.inputSchema, { io: 'input' }) as Record<string, unknown> }
})
const catalog = buildMcpToolCatalog({ tools: hostTools, access: { allowWrites: true, allowDestructive: true, allowPaid: true }, operationsEnabled: true })

describe('旧调用样本仍然有效', () => {
  it('所有曾经公布过的工具名都还在目录里，没有静默改名', () => {
    const names = catalog.tools.map((tool) => tool.name)
    for (const sample of [...LEGACY_SAMPLES, ...LEGACY_PROTOCOL_SAMPLES]) {
      expect(names, `${sample.era} 的 ${sample.tool} 消失了；对外改名必须走弃用期`).toContain(sample.tool)
    }
  })

  it('旧样本通过当前能力定义的输入校验，新增字段一律可选', () => {
    for (const sample of LEGACY_SAMPLES) {
      const definition = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(sample.tool)!
      const input = { ...sample.arguments }
      delete input.operationId
      delete input.baselineIds
      const parsed = definition.inputSchema.safeParse(input)
      expect(parsed.success, `${sample.era} 的 ${sample.tool} 旧样本已不被接受：${parsed.success ? '' : JSON.stringify(parsed.error.issues)}`).toBe(true)
    }
  })

  it('发布过的必填项没有扩张：旧样本满足当前 schema 的全部 required', () => {
    const listed = new Map(catalog.tools.map((tool) => [tool.name, tool]))
    for (const sample of [...LEGACY_SAMPLES, ...LEGACY_PROTOCOL_SAMPLES]) {
      const required = (listed.get(sample.tool)!.inputSchema.required as string[] | undefined) ?? []
      const missing = required.filter((key) => !(key in sample.arguments))
      expect(missing, `${sample.era} 的 ${sample.tool} 多出必填项`).toEqual([])
    }
  })

  /**
   * 付费生成是 2.2 才出现的工具，它的必填项在首发时就包含 modelId／prompt／mediaType；
   * 这条钉住"首发即必填"不会被后续改动扩张成更多必填。
   */
  it('付费生成工具的必填项与首发一致', () => {
    const tool = catalog.tools.find((item) => item.name === 'create_visible_generation_task')!
    expect([...(tool.inputSchema.required as string[])].sort())
      .toEqual(['mediaType', 'modelId', 'operationId', 'prompt'])
  })

  it('1.2 形状的只读客户端在当前服务上照常跑通，多出来的字段不影响它', async () => {
    let saved: string | null = null
    const connections = new McpConnections({ read: () => saved, write: (value) => { saved = value } })
    const identity = connections.create('1.2 旧客户端')
    const host = new ApplicationHostBridge((id) => connections.assertActive(id))
    // 旧宿主注册形状：没有 domains 字段，服务端仍须接受。
    host.register({ sessionId: randomUUID(), generation: 1, ready: true, tools: hostTools.filter((tool) => ['describe_application_entities', 'list_application_entities', 'read_application_entity'].includes(tool.id)) }, {
      send: (channel, payload) => {
        if (channel !== 'mcp:host:request') return
        const outgoing = payload as LocalHostRequest
        host.complete({ requestId: outgoing.requestId, sessionId: outgoing.sessionId, result: { ok: true, data: { ref: { kind: 'settings.registry', id: 'singleton' }, entityType: 'settings.registry', properties: { 'interface.theme_tone': 'slate' }, revisions: { settings: 3 }, capturedAt: '2026-09-12T00:00:00.000Z' } } })
      },
    })
    const server = new LocalMcpServer(connections, host)
    const client = new Client({ name: '1.2 兼容回放', version: '1' })
    try {
      await server.start(0)
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.listeningPort}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${connections.token(identity.id)}` } } }))
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(['describe_application_entities', 'list_application_entities', 'read_application_entity']))
      const sample = LEGACY_SAMPLES.find((item) => item.tool === 'read_application_entity')!
      const result = await client.callTool({ name: sample.tool, arguments: sample.arguments })
      expect(result.isError, JSON.stringify(result)).toBe(false)
      // 旧客户端只认 ok/data，本轮新增的字段不会改变它读到的业务事实。
      expect((result.structuredContent as { ok: boolean; data: { properties: Record<string, unknown> } }).data.properties)
        .toEqual({ 'interface.theme_tone': 'slate' })
    } finally { await client.close(); await server.stop() }
  })
})
