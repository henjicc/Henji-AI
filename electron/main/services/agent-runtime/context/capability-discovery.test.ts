import { describe, expect, it } from 'vitest'

import {
  AGENT_CONTRACT_VERSION,
  type HostContextSnapshot,
} from '../../../../../src/core/assistant/hostContracts'
import type { ApplicationCapabilityDiscoveryOutput } from '../../../../../src/core/assistant/capabilityDiscovery'
import { createBuiltinAgentToolRegistry } from '../tools/builtin'
import { AgentCapabilityDiscoveryCatalog } from './capability-discovery'

function fullContext(registry: ReturnType<typeof createBuiltinAgentToolRegistry>): HostContextSnapshot {
  return {
    schemaVersion: AGENT_CONTRACT_VERSION,
    rendererSessionId: 'renderer-discovery',
    revision: 5,
    scopeRevisions: { navigation: 2, generation: 1, canvas: 3, toolbox: 4, assets: 1 },
    workspace: { id: 'tools', activeToolId: 'cameraStage' },
    surface: {
      id: 'tool.camera_stage',
      kind: 'tool',
      focusedRef: null,
      selectedRefs: [],
    },
    project: { id: 'project-1', selectedNodeId: null },
    generation: { commandReady: true },
    assets: { view: 'closed', selectedAssetId: null },
    uiReady: true,
    availableCapabilities: registry.allDefinitions()
      .filter((definition) => definition.side === 'frontend')
      .map((definition) => definition.name),
    capturedAt: new Date().toISOString(),
  }
}

describe('AgentCapabilityDiscoveryCatalog', () => {
  it('一次解析跨领域 Facet、schemaRef、缺失项和建议激活集合', () => {
    const registry = createBuiltinAgentToolRegistry(async () => {
      throw new Error('测试不执行前端工具')
    })
    const catalog = new AgentCapabilityDiscoveryCatalog(registry)
    const context = fullContext(registry)
    const result = catalog.discover('run-batch', {
      discoveryVersion: 'application-capability-discovery/v1',
      facets: [{
        facetId: 'camera_scene',
        queries: ['添加三维物体并设置位置'],
        domains: ['camera_stage'],
        entityTypes: ['camera_stage.object'],
        capabilityKinds: ['observe', 'mutate'],
        targetSurfaceIds: ['tool.camera_stage'],
      }, {
        facetId: 'show_surface',
        queries: ['打开三维工具'],
        domains: ['navigation'],
        entityTypes: [],
        capabilityKinds: ['navigate'],
        targetSurfaceIds: ['tool.camera_stage'],
      }, {
        facetId: 'unsupported',
        queries: ['不存在的领域'],
        domains: ['unknown_domain'],
        entityTypes: [],
        capabilityKinds: ['execute'],
        targetSurfaceIds: [],
      }],
      cursor: 0,
      limit: 20,
    }, context)

    expect(result.facets.find((facet) => facet.facetId === 'camera_scene')?.capabilityNames.length)
      .toBeGreaterThan(0)
    expect(result.facets.find((facet) => facet.facetId === 'show_surface')?.capabilityNames)
      .toContain('open_application_surface')
    expect(result.missing).toContainEqual(expect.objectContaining({
      facetId: 'unsupported', reason: 'unsupported_domain',
    }))
    expect(result.capabilities.every((capability) => capability.schemaRef.kind === 'operation')).toBe(true)
    expect(result.addedToolNames).toContain('read_application_schemas')
    expect(result.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/)
  })

  it('相同发现指纹复用缓存，schemaRef 可稳定读取完整输入结构', () => {
    const registry = createBuiltinAgentToolRegistry(async () => {
      throw new Error('测试不执行前端工具')
    })
    const catalog = new AgentCapabilityDiscoveryCatalog(registry)
    const context = fullContext(registry)
    const input = {
      discoveryVersion: 'application-capability-discovery/v1' as const,
      facets: [{
        facetId: 'canvas',
        queries: ['读取画布项目'],
        domains: ['canvas'],
        entityTypes: ['canvas.project'],
        capabilityKinds: ['query' as const],
        targetSurfaceIds: ['workspace.canvas'],
      }],
      cursor: 0,
      limit: 2,
    }
    const first = catalog.discover('run-cache', input, context)
    const second = catalog.discover('run-cache', input, context)
    expect(second).toMatchObject({ fingerprint: first.fingerprint, reused: true })
    expect(first.page.returnedItems).toBeLessThanOrEqual(2)

    const ref = first.facets[0]?.schemaRefs[0]
    expect(ref).toBeDefined()
    const schemas = catalog.readSchemas({ refs: ref ? [ref] : [] })
    expect(schemas.documents).toHaveLength(1)
    expect(schemas.documents[0]?.inputSchema).toBeTypeOf('object')
    expect(schemas.missing).toEqual([])
  })

  it('后端原生能力执行与输出 schema 使用同一目录实现', async () => {
    const registry = createBuiltinAgentToolRegistry(async () => {
      throw new Error('测试不执行前端工具')
    })
    const tool = registry.get('discover_application_capabilities')
    expect(tool?.capability?.id).toBe('discover_application_capabilities')
    const output = await tool?.execute({
      facets: [{
        facetId: 'assets',
        queries: ['读取素材'],
        domains: ['assets'],
        entityTypes: ['asset'],
        capabilityKinds: ['query'],
        targetSurfaceIds: ['workspace.assets'],
      }],
      cursor: 0,
      limit: 20,
      discoveryVersion: 'application-capability-discovery/v1',
    }, {
      runId: 'run-tool', threadId: 'thread-tool', toolCallId: 'call-tool',
      signal: new AbortController().signal,
      hostContext: fullContext(registry),
    }) as ApplicationCapabilityDiscoveryOutput
    expect(output.catalogVersion).toBe('application-capabilities/v2')
    expect(output.facets[0]?.capabilityNames.length).toBeGreaterThan(0)
  })
})
