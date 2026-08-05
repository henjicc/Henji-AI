import { describe, expect, it } from 'vitest'

import {
  ApplicationCapabilityRegistry,
  applicationCapabilityDescriptorSchema,
} from '../applicationCapabilities'
import {
  BUILTIN_APPLICATION_CAPABILITY_REGISTRY,
} from '../builtinApplicationCapabilityRegistry'
import { discoverApplicationCapabilitiesCapability } from './capabilityDiscoveryApplicationCapabilities'

/*
 * 工具结果进入对话历史前的字段投影。
 *
 * 实测一次三维任务：`discover_application_capabilities` 单条 29.9KB、
 * `describe_application_entities` 单条 15.5KB，两条吃掉整次运行对话历史的 58%。按字段归因，
 * 大头是每轮 `tools` 参数已经带过一遍的输入 schema，以及权限、暴露面、数据分级这些由网关
 * 强制执行、模型无法行动的内容。事后再去历史里清理要作废缓存前缀（回本约 6 轮，而一次运行
 * 只有约 13 轮），所以只能在写入前就不放进去。
 */

function property(id: string): Record<string, unknown> {
  return {
    id,
    entityType: 'camera_stage.project',
    version: 1,
    title: '工程名称',
    description: '三维工程名称的稳定控制属性。',
    value: { kind: 'string', minLength: 1, maxLength: 120 },
    nullable: false,
    dataClass: 'C1',
    exposures: ['ui', 'assistant', 'local_adapter'],
    requiredPermissions: { read: ['camera_stage:read'], write: ['camera_stage:write'] },
    revisionScopes: ['toolbox'],
    schemaRef: {
      catalogVersion: 'application-capabilities/v2',
      kind: 'property',
      id,
      version: 1,
      digest: `sha256:${'7b67b934'.repeat(8)}`,
    },
  }
}

function schemaRef(id: string): Record<string, unknown> {
  return {
    catalogVersion: 'application-capabilities/v2',
    kind: 'operation',
    id,
    version: 1,
    digest: `sha256:${'96b8c9fb'.repeat(8)}`,
  }
}

function discoveryOutput(): Record<string, unknown> {
  return {
    discoveryVersion: 'application-capability-discovery/v1',
    catalogVersion: 'application-capabilities/v2',
    fingerprint: `sha256:${'a1'.repeat(32)}`,
    reused: false,
    capabilities: [{
      name: 'create_camera_stage_project',
      capabilityId: 'create_camera_stage_project',
      version: 3,
      title: '新建 3D 运镜工程',
      description: '创建带默认摄像机和初始镜头的 3D 运镜工程，但不切换当前界面。',
      domain: 'camera_stage',
      category: 'camera_stage',
      readOnly: false,
      risk: 'R1',
      entityTypes: ['camera_stage.project', 'camera_stage.camera', 'camera_stage.shot'],
      propertyIds: ['camera_stage.project.name'],
      surfaceIds: ['tool.camera_stage'],
      schemaRef: schemaRef('create_camera_stage_project'),
    }],
    facets: [{
      facetId: 'camera_scene',
      capabilityNames: ['create_camera_stage_project', 'place_camera_stage_object'],
      schemaRefs: [schemaRef('create_camera_stage_project'), schemaRef('place_camera_stage_object')],
      observationSuggestions: ['先观察场景再写入。'],
    }],
    missing: [],
    leasedToolNames: ['create_camera_stage_project'],
    deferredToolNames: ['place_camera_stage_object'],
    deferredCount: 1,
    page: { returnedItems: 1, nextCursor: null, hasMore: false },
  }
}

function projected(id: string, output: unknown): Record<string, unknown> {
  const definition = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(id)
  expect(definition?.projectForHistory).toBeTypeOf('function')
  return definition?.projectForHistory?.(output) as Record<string, unknown>
}

describe('工具结果的历史投影', () => {
  it('实体结构文档丢掉网关强制执行的字段，保留写属性真正要用的部分', () => {
    const output = {
      entities: [{ id: 'camera_stage.project', title: '三维工程', schemaRef: schemaRef('e') }],
      properties: [property('camera_stage.project.name')],
      revision: 7,
      scopeRevisions: { toolbox: 7 },
    }
    const result = projected('describe_application_entities', output)
    const first = (result.properties as Record<string, unknown>[])[0]

    for (const key of ['schemaRef', 'requiredPermissions', 'exposures', 'revisionScopes', 'dataClass']) {
      expect(first).not.toHaveProperty(key)
    }
    // description 是模型在上百条属性里挑对那一条的语义线索，删了会换来猜属性名。
    for (const key of ['id', 'entityType', 'title', 'description', 'value', 'nullable']) {
      expect(first).toHaveProperty(key)
    }
    expect((result.entities as Record<string, unknown>[])[0]).not.toHaveProperty('schemaRef')
    expect(result.revision).toBe(7)
    expect(result.scopeRevisions).toEqual({ toolbox: 7 })
  })

  it('实体结构文档投影后体积显著下降', () => {
    const output = {
      entities: [],
      properties: Array.from({ length: 110 }, (_, index) => property(`camera_stage.project.p${index}`)),
      revision: 1,
      scopeRevisions: {},
    }
    const before = JSON.stringify(output).length
    const after = JSON.stringify(projected('describe_application_entities', output)).length
    expect(after).toBeLessThan(before * 0.6)
  })

  it('能力发现丢掉与本轮 tools 重复的 schema，未租约候选的引用保留', () => {
    const result = projected('discover_application_capabilities', discoveryOutput())
    const capability = (result.capabilities as Record<string, unknown>[])[0]

    for (const key of ['schemaRef', 'capabilityId', 'category', 'entityTypes', 'propertyIds']) {
      expect(capability).not.toHaveProperty(key)
    }
    for (const key of ['name', 'title', 'description', 'domain', 'readOnly', 'risk', 'surfaceIds']) {
      expect(capability).toHaveProperty(key)
    }

    // 已租约的工具这一轮就带着完整 schema，未租约（deferred）的才需要留下引用。
    const refs = (result.facets as { schemaRefs: { id: string }[] }[])[0].schemaRefs
    expect(refs.map((ref) => ref.id)).toEqual(['place_camera_stage_object'])

    // 租约、缺失与分页信息一律原样保留：它们决定模型下一步能调什么。
    expect(result.leasedToolNames).toEqual(['create_camera_stage_project'])
    expect(result.deferredToolNames).toEqual(['place_camera_stage_object'])
    expect(result.missing).toEqual([])
    expect(result.page).toEqual({ returnedItems: 1, nextCursor: null, hasMore: false })
    expect(result.fingerprint).toBe(discoveryOutput().fingerprint)
  })

  it('全部能力都已租约时不再留任何 schemaRef', () => {
    const output = discoveryOutput()
    output.leasedToolNames = ['create_camera_stage_project', 'place_camera_stage_object']
    const result = projected('discover_application_capabilities', output)
    expect((result.facets as { schemaRefs: unknown[] }[])[0].schemaRefs).toEqual([])
  })

  /*
   * 示例调用：JSON Schema 表达不了嵌套结构长什么样、可选字段何时该填、参数之间怎么配合——
   * 而这些正是模型最容易写错的地方。Anthropic 实测补上示例后复杂参数场景准确率 72% → 90%。
   */
  it('声明的示例调用渲染进模型看到的工具描述', () => {
    const definition = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get('change_application_entities')
    expect(definition?.inputExamples?.length).toBeGreaterThan(0)
    // 示例必须能通过该能力自己的输入 schema——写错的示例比没有示例更糟，模型会照抄。
    for (const example of definition?.inputExamples ?? []) {
      const parsed = definition?.inputSchema.safeParse(example)
      expect(parsed?.success, JSON.stringify(example)).toBe(true)
    }
  })

  it('投影函数与示例都不会泄漏进严格的能力描述符', () => {
    // descriptor schema 是 strict 的：漏掉解构会在注册时就抛错，这条守住那个解构。
    const registry = new ApplicationCapabilityRegistry()
    registry.register(discoverApplicationCapabilitiesCapability)
    for (const descriptor of registry.descriptors()) {
      expect(descriptor).not.toHaveProperty('projectForHistory')
      expect(descriptor).not.toHaveProperty('inputExamples')
      expect(applicationCapabilityDescriptorSchema.safeParse(descriptor).success).toBe(true)
    }
  })
})
