import { describe, expect, it } from 'vitest'

import {
  AGENT_CONTRACT_VERSION,
  type HostContextSnapshot,
} from '../../../../../src/core/assistant/hostContracts'
import { createBuiltinAgentToolRegistry } from '../tools/builtin'
import { AgentToolCatalogPlanner } from './catalog'
import type { AgentRouteDecision } from './types'

function contextSnapshot(): HostContextSnapshot {
  return {
    schemaVersion: AGENT_CONTRACT_VERSION,
    rendererSessionId: 'renderer-catalog',
    revision: 1,
    scopeRevisions: { navigation: 0, generation: 0, canvas: 0, toolbox: 0, assets: 0 },
    workspace: { id: 'generation', activeToolId: null },
    project: { id: null, selectedNodeId: null },
    generation: { commandReady: true },
    assets: { view: 'closed', selectedAssetId: null },
    uiReady: true,
    availableCommands: ['switch_workspace', 'create_visible_generation_task'],
    availableQueries: ['search_models', 'get_model_schema', 'get_generation_task'],
    capturedAt: new Date().toISOString(),
  }
}

const primaryRoute: AgentRouteDecision = {
  intent: 'general',
  complexity: 'ambiguous',
  path: 'primary',
  toolDomains: ['catalog'],
  source: 'fallback',
  reason: '测试能力发现',
}

describe('AgentToolCatalogPlanner', () => {
  it('明确生成请求直接获得模型、生成与工作区切换工具', () => {
    const registry = createBuiltinAgentToolRegistry(async () => {
      throw new Error('测试不执行前端工具')
    })
    const planner = new AgentToolCatalogPlanner(registry)
    const route: AgentRouteDecision = {
      intent: 'generate',
      complexity: 'simple',
      path: 'workflow',
      toolDomains: ['models', 'generation', 'navigation'],
      source: 'deterministic',
      reason: '命中生成规则',
    }
    const names = planner.select(route, contextSnapshot()).map((item) => item.catalog.name)
    expect(names).toContain('search_application_capabilities')
    expect(names).toContain('search_models')
    expect(names).toContain('get_model_schema')
    expect(names).toContain('create_visible_generation_task')
    expect(names).toContain('switch_workspace')
  })

  it('目录项提供工具使用、证据、恢复和并行语义', () => {
    const registry = createBuiltinAgentToolRegistry(async () => {
      throw new Error('测试不执行前端工具')
    })
    const entry = registry.list(contextSnapshot()).find((item) => item.name === 'search_models')
    expect(entry).toMatchObject({ parallelSafe: true })
    expect(entry?.whenToUse.length).toBeGreaterThan(0)
    expect(entry?.prerequisites.length).toBeGreaterThan(0)
    expect(entry?.successEvidence.length).toBeGreaterThan(0)
    expect(entry?.failureRecovery.length).toBeGreaterThan(0)
  })

  it('多词和供应商限定不会让图片生成能力误报为零项', () => {
    const registry = createBuiltinAgentToolRegistry(async () => {
      throw new Error('测试不执行前端工具')
    })
    const results = registry.search('KIE 图片生成', undefined, contextSnapshot())
    const names = results.map((item) => item.name)
    expect(names).toContain('create_visible_generation_task')
    expect(names).toContain('search_models')
    expect(names).toContain('switch_workspace')
  })

  it('能力目录发现的权威工具会在下一轮渐进披露', () => {
    const registry = createBuiltinAgentToolRegistry(async () => {
      throw new Error('测试不执行前端工具')
    })
    const planner = new AgentToolCatalogPlanner(registry)
    expect(planner.select(primaryRoute, contextSnapshot()).map((item) => item.catalog.name))
      .toEqual(['search_application_capabilities'])

    const capabilities = registry.search('图片生成', undefined, contextSnapshot())
    const added = planner.rememberDiscovered('search_application_capabilities', { capabilities })
    expect(added).toContain('create_visible_generation_task')

    const activeNames = planner.select(primaryRoute, contextSnapshot()).map((item) => item.catalog.name)
    expect(activeNames).toContain('search_application_capabilities')
    expect(activeNames).toContain('create_visible_generation_task')
    expect(activeNames).toContain('search_models')
  })
})
