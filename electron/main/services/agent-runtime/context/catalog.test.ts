import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  AGENT_CONTRACT_VERSION,
  type HostContextSnapshot,
} from '../../../../../src/core/assistant/hostContracts'
import { createBuiltinAgentToolRegistry } from '../tools/builtin'
import { createBackendBuiltinTools } from '../tools/builtin/backend'
import { AgentToolRegistry } from '../tools/registry'
import { defineAgentTool } from '../tools/define-tool'
import { AgentToolCatalogPlanner } from './catalog'
import { AGENT_ACTIVE_TOOL_LIMIT, AGENT_TOOL_SCHEMA_BUDGET_BYTES } from './tool-activation'
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
    availableCapabilities: [
      'switch_workspace',
      'create_visible_generation_task',
      'search_models',
      'get_model_schema',
      'get_generation_task',
    ],
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
  it('能力概览直达路由不激活任何工具', () => {
    const registry = createBuiltinAgentToolRegistry(async () => {
      throw new Error('测试不执行前端工具')
    })
    const planner = new AgentToolCatalogPlanner(registry)
    const route: AgentRouteDecision = {
      intent: 'general',
      complexity: 'simple',
      path: 'primary',
      toolDomains: [],
      source: 'deterministic',
      reason: '能力概览直接回答',
    }

    expect(planner.select(route, contextSnapshot()).activeToolNames).toEqual([])
  })

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
    const activation = planner.select(route, contextSnapshot())
    const names = activation.activeToolNames
    expect(names.length).toBeLessThanOrEqual(AGENT_ACTIVE_TOOL_LIMIT)
    expect(activation.schemaBytes).toBeLessThanOrEqual(AGENT_TOOL_SCHEMA_BUDGET_BYTES)
    expect(names).toContain('discover_application_capabilities')
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
    expect(entry?.completionKind).toBe('observed')
    expect(registry.list(contextSnapshot()).find((item) => item.name === 'create_visible_generation_task')?.completionKind)
      .toBe('submitted')
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
    // load_assistant_skill 与能力发现同为常驻工具：skills_index 层要求模型先加载技能，
    // 它必须真的在本轮工具里，否则模型看得见清单却调不动。
    expect(planner.select(primaryRoute, contextSnapshot()).activeToolNames)
      .toEqual(['load_assistant_skill', 'discover_application_capabilities', 'declare_action_plan'])

    const capabilities = registry.search('图片生成', undefined, contextSnapshot())
    const leasedToolNames = capabilities.map((capability) => capability.name).slice(0, 5)
    const added = planner.rememberDiscovered('discover_application_capabilities', {
      capabilities,
      leasedToolNames,
      facets: [{ facetId: 'generate', capabilityNames: leasedToolNames }],
    })
    expect(added).toContain('create_visible_generation_task')

    const activeNames = planner.select(primaryRoute, contextSnapshot()).activeToolNames
    expect(activeNames).toContain('discover_application_capabilities')
    expect(activeNames).toContain('create_visible_generation_task')
    expect(activeNames).toContain('search_models')
    expect(activeNames).toContain('load_assistant_skill')
  })

  it('任何有工具域的路由都常驻技能加载工具，且排在能力发现之前', () => {
    const registry = createBuiltinAgentToolRegistry(async () => {
      throw new Error('测试不执行前端工具')
    })
    const planner = new AgentToolCatalogPlanner(registry)
    for (const toolDomains of [['camera_stage'], ['canvas'], ['generation', 'models'], ['settings']] as const) {
      const active = planner.select(
        { ...primaryRoute, toolDomains: [...toolDomains] },
        contextSnapshot()
      ).activeToolNames
      expect(active).toContain('load_assistant_skill')
      // 领域知识决定后面怎么发现和调用能力，顺序反了没有意义。
      expect(active.indexOf('load_assistant_skill')).toBe(0)
    }
  })

  it('刚用过的工具不会被轮换的发现列表挤掉', () => {
    const registry = createBuiltinAgentToolRegistry(async () => {
      throw new Error('测试不执行前端工具')
    })
    const fullContext = {
      ...contextSnapshot(),
      availableCapabilities: registry.allDefinitions()
        .filter((definition) => definition.side === 'frontend')
        .map((definition) => definition.name),
    }
    const planner = new AgentToolCatalogPlanner(registry)
    // 模拟一次典型的三维任务：发现一大批能力，远超单轮 8 个工具位。
    planner.rememberDiscovered('discover_application_capabilities', {
      leasedToolNames: ['place_camera_stage_object'],
      facets: [{ facetId: 'camera_scene', capabilityNames: ['place_camera_stage_object'] }],
    })
    const route = { ...primaryRoute, toolDomains: ['camera_stage' as const] }
    expect(planner.select(route, fullContext).candidateCount).toBeGreaterThan(8)

    // 用掉一个工具后，接下来的几轮它都必须还在——模型正处在使用它的序列中间。
    planner.rememberObservation('place_camera_stage_object', {})
    for (let turn = 0; turn < 4; turn += 1) {
      expect(planner.select(route, fullContext).activeToolNames)
        .toContain('place_camera_stage_object')
    }
  })

  it('三个前沿 Facet 的 15 个租约跨轮稳定，终态后释放且不突破 32/96KB', () => {
    const registry = createBuiltinAgentToolRegistry(async () => {
      throw new Error('测试不执行前端工具')
    })
    const fullContext = {
      ...contextSnapshot(),
      catalogRevision: 1,
      availableCapabilities: registry.allDefinitions()
        .filter((definition) => definition.side === 'frontend')
        .map((definition) => definition.name),
    }
    const candidates = registry.list(fullContext)
      .filter((entry) => !['catalog', 'application'].includes(entry.category))
      .slice(0, 15)
      .map((entry) => entry.name)
    expect(candidates).toHaveLength(15)
    const planner = new AgentToolCatalogPlanner(registry)
    planner.rememberDiscovered('discover_application_capabilities', {
      leasedToolNames: candidates,
      facets: [0, 1, 2].map((index) => ({
        facetId: `facet_${index}`,
        capabilityNames: candidates.slice(index * 5, index * 5 + 5),
      })),
    })
    planner.syncActiveFacets(['facet_0', 'facet_1', 'facet_2'])

    for (let turn = 0; turn < 3; turn += 1) {
      const activation = planner.select(primaryRoute, fullContext)
      expect(activation.activeToolNames.length).toBeLessThanOrEqual(AGENT_ACTIVE_TOOL_LIMIT)
      expect(activation.schemaBytes).toBeLessThanOrEqual(AGENT_TOOL_SCHEMA_BUDGET_BYTES)
      expect(activation.leasedToolNames).toEqual(expect.arrayContaining(candidates))
      expect(activation.droppedLeasedToolNames).toEqual([])
    }

    planner.syncActiveFacets(['facet_1', 'facet_2'])
    const released = planner.select(primaryRoute, fullContext)
    for (const name of candidates.slice(0, 5)) expect(released.leasedToolNames).not.toContain(name)
  })

  it('100 个目录能力下仍只激活真实租约且不突破 32/96KB', () => {
    const registry = new AgentToolRegistry()
    for (let index = 0; index < 100; index += 1) {
      const name = `catalog_pressure_${index}`
      registry.register(defineAgentTool({
        name,
        version: 1,
        title: `压力能力 ${index}`,
        description: '只用于验证大型目录下的活动工具预算。',
        side: 'backend',
        category: 'diagnostics',
        risk: 'R0',
        permission: 'diagnostics:read',
        readOnly: true,
        destructive: false,
        openWorld: false,
        idempotent: true,
        timeoutMs: 1_000,
        retryPolicy: { maxRetries: 0, baseDelayMs: 0 },
        supportsPreview: false,
        supportsUndo: false,
        requiredContext: [],
        inputSchema: z.object({ id: z.string() }).strict(),
        outputSchema: z.object({ ok: z.literal(true) }).strict(),
        aiInputSchema: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
          additionalProperties: false,
        },
        execute: async () => ({ ok: true as const }),
        concurrencyKey: (input) => `${name}:${input.id}`,
        targetIds: (input) => ({ id: input.id }),
        dataClasses: () => ['C0'],
        summarize: () => '压力能力读取完成。',
      }))
    }
    const leased = Array.from({ length: 15 }, (_, index) => `catalog_pressure_${index}`)
    const planner = new AgentToolCatalogPlanner(registry)
    planner.restoreLeases(Array.from({ length: 3 }, (_, facetIndex) => ({
      facetId: `facet_${facetIndex}`,
      toolNames: leased.slice(facetIndex * 5, facetIndex * 5 + 5),
    })))

    expect(registry.list(null)).toHaveLength(100)
    const activation = planner.select(primaryRoute, null)
    expect(activation.leasedToolNames).toEqual(leased)
    expect(activation.activeToolNames.length).toBeLessThanOrEqual(AGENT_ACTIVE_TOOL_LIMIT)
    expect(activation.schemaBytes).toBeLessThanOrEqual(AGENT_TOOL_SCHEMA_BUDGET_BYTES)
    expect(activation.droppedLeasedToolNames).toEqual([])
  })

  it('目录 revision 改变时旧租约立即失效', () => {
    const registry = createBuiltinAgentToolRegistry(async () => {
      throw new Error('测试不执行前端工具')
    })
    const planner = new AgentToolCatalogPlanner(registry)
    const firstContext = { ...contextSnapshot(), catalogRevision: 1 } as HostContextSnapshot
    planner.select(primaryRoute, firstContext)
    planner.restoreLeases([{ facetId: 'facet', toolNames: ['read_agent_artifact'] }])
    expect(planner.select(primaryRoute, firstContext).leasedToolNames).toContain('read_agent_artifact')
    const nextContext = { ...firstContext, catalogRevision: 2 } as HostContextSnapshot
    expect(planner.select(primaryRoute, nextContext).leasedToolNames).not.toContain('read_agent_artifact')
  })

  it('工具 availability 失效后释放租约，不在后续轮次幽灵恢复', () => {
    const registry = createBuiltinAgentToolRegistry(async () => {
      throw new Error('测试不执行前端工具')
    })
    const planner = new AgentToolCatalogPlanner(registry)
    planner.restoreLeases([{
      facetId: 'camera_scene',
      toolNames: ['place_camera_stage_object'],
    }])

    planner.select({ ...primaryRoute, toolDomains: ['camera_stage'] }, contextSnapshot())
    expect(planner.currentLeaseSnapshot()).toEqual([])
  })

  it('从检查点恢复的租约携带目录 revision，首轮即可识别失效', () => {
    const registry = createBuiltinAgentToolRegistry(async () => {
      throw new Error('测试不执行前端工具')
    })
    const restored = new AgentToolCatalogPlanner(registry)
    restored.restoreLeases([
      { facetId: 'facet', toolNames: ['read_agent_artifact'] },
    ], 1)
    const changedContext = { ...contextSnapshot(), catalogRevision: 2 } as HostContextSnapshot
    expect(restored.select(primaryRoute, changedContext).leasedToolNames)
      .not.toContain('read_agent_artifact')
  })

  it('纯闲聊（无工具域）不占用技能加载的工具位', () => {
    const registry = createBuiltinAgentToolRegistry(async () => {
      throw new Error('测试不执行前端工具')
    })
    const planner = new AgentToolCatalogPlanner(registry)
    const active = planner.select(
      { ...primaryRoute, toolDomains: [] },
      contextSnapshot()
    ).activeToolNames
    expect(active).not.toContain('load_assistant_skill')
  })

  it('领域工具超过单轮上限时分页候选会延迟，活动租约不轮换', async () => {
    const registry = createBuiltinAgentToolRegistry(async () => {
      throw new Error('测试不执行前端工具')
    })
    const allFrontendNames = registry.allDefinitions()
      .filter((definition) => definition.side === 'frontend')
      .map((definition) => definition.name)
    const fullContext = {
      ...contextSnapshot(),
      availableCapabilities: allFrontendNames,
    }
    const planner = new AgentToolCatalogPlanner(registry)
    const allCanvas = registry.search('', 'canvas', fullContext, 100)
    expect(allCanvas.length).toBeGreaterThan(8)
    const searchTool = registry.get('search_application_capabilities')
    expect(searchTool).toBeDefined()
    const secondPage = await searchTool?.execute({
      query: '', category: 'canvas', cursor: 8, limit: 8,
    }, {
      runId: 'run-catalog',
      threadId: 'thread-catalog',
      toolCallId: 'call-catalog',
      signal: new AbortController().signal,
      hostContext: fullContext,
    }) as { capabilities: Array<{ name?: string }> }
    expect(secondPage.capabilities.map((entry) => entry.name)).toEqual(
      allCanvas.slice(8, 16).map((entry) => entry.name)
    )

    const firstPage = allCanvas.slice(0, 20)
    const leasedToolNames = firstPage.slice(0, 5).map((entry) => entry.name)
    planner.rememberDiscovered('search_application_capabilities', { leasedToolNames })
    const activated = new Set<string>()
    for (let turn = 0; turn < 4; turn += 1) {
      for (const name of planner.select(primaryRoute, fullContext).activeToolNames) activated.add(name)
    }

    expect([...activated]).toEqual(expect.arrayContaining(leasedToolNames))
    expect([...activated].filter((name) => leasedToolNames.includes(name))).toHaveLength(leasedToolNames.length)
  })

  it('分页未结束时固定读取工具，最后一页后释放固定状态', () => {
    const registry = createBuiltinAgentToolRegistry(async () => {
      throw new Error('测试不执行前端工具')
    })
    const planner = new AgentToolCatalogPlanner(registry)
    // 需要一个大于单轮上限的候选池，才能真的验证"分页工具不会被挤掉"。
    const fullContext = {
      ...contextSnapshot(),
      availableCapabilities: registry.allDefinitions()
        .filter((definition) => definition.side === 'frontend')
        .map((definition) => definition.name),
    }
    const readArtifact = registry.list(fullContext)
      .find((entry) => entry.name === 'read_agent_artifact')
    expect(readArtifact).toBeDefined()
    const discovered = [
      ...(readArtifact ? [readArtifact] : []),
      ...registry.list(fullContext)
        .filter((entry) => ![
          'discover_application_capabilities',
          'search_application_capabilities',
          'read_agent_artifact',
        ].includes(entry.name)),
    ].slice(0, AGENT_ACTIVE_TOOL_LIMIT + 8)
    expect(discovered.length).toBeGreaterThan(AGENT_ACTIVE_TOOL_LIMIT)
    expect(discovered.some((entry) => entry.name === 'read_agent_artifact')).toBe(true)
    planner.restoreDiscovered(discovered.map((entry) => entry.name))

    planner.rememberObservation('read_agent_artifact', {
      hasMore: true,
      nextCursor: 'v1:4096:0123456789abcdef',
    })
    for (let turn = 0; turn < 3; turn += 1) {
      const activation = planner.select(primaryRoute, fullContext)
      expect(activation.activeToolNames).toContain('read_agent_artifact')
      expect(activation.pinnedToolNames).toContain('read_agent_artifact')
      expect(activation.droppedPinnedToolNames).not.toContain('read_agent_artifact')
    }

    planner.rememberObservation('read_agent_artifact', {
      hasMore: false,
      nextCursor: null,
    })
    expect(planner.select(primaryRoute, contextSnapshot()).pinnedToolNames)
      .not.toContain('read_agent_artifact')
  })

  it('已发现但被挤出的工具可以排入下一轮优先恢复，未知工具不能借此激活', () => {
    const registry = createBuiltinAgentToolRegistry(async () => {
      throw new Error('测试不执行前端工具')
    })
    const planner = new AgentToolCatalogPlanner(registry)
    planner.restoreDiscovered(['read_agent_artifact'])

    expect(planner.queueKnownToolForActivation('read_agent_artifact')).toBe(true)
    expect(planner.queueKnownToolForActivation('create_visible_generation_task')).toBe(false)
    const activation = planner.select(primaryRoute, contextSnapshot())
    expect(activation.activeToolNames).toContain('read_agent_artifact')
    expect(activation.pinnedToolNames).toContain('read_agent_artifact')
    expect(activation.droppedPinnedToolNames).not.toContain('read_agent_artifact')
  })
})

/**
 * `TOOL_NOT_ACTIVE` 的恢复承诺是"下一轮重新披露"，但任务图结算不知道这件事，往往当轮就判
 * 终态并下发"停止调用工具"——承诺的下一轮永远不会来。实测里模型已经知道该调
 * update_camera_stage_object，却只能汇报"按规则需等下一轮披露"然后收工。
 */
describe('激活恢复挂起时不得结算停止', () => {
  it('排队等待重新披露的工具会把恢复标志置起，并在真正激活后清掉', () => {
    const registry = new AgentToolRegistry()
    for (const definition of createBackendBuiltinTools(registry, {
      listArtifacts: () => [], readArtifact: () => null,
    } as never)) {
      registry.register(definition)
    }
    const planner = new AgentToolCatalogPlanner(registry)
    expect(planner.hasPendingActivationRecovery()).toBe(false)

    // 只有"已知"的工具才排队：没见过的工具排队没有意义，模型该走能力发现
    planner.restoreDiscovered(['query_diagnostic_events'])
    expect(planner.queueKnownToolForActivation('query_diagnostic_events')).toBe(true)
    expect(planner.hasPendingActivationRecovery()).toBe(true)

    planner.select({
      routeVersion: 'agent-route/v2', intent: 'diagnose', candidateIntents: ['diagnose'],
      complexity: 'simple', path: 'workflow', toolDomains: ['diagnostics'],
      source: 'deterministic', reason: '诊断',
    } as never, null)
    // 已经披露出去了，恢复标志必须清掉，否则任务永远结算不了
    expect(planner.hasPendingActivationRecovery()).toBe(false)
  })

  it('未知工具不排队，避免把恢复标志永久挂住', () => {
    const registry = new AgentToolRegistry()
    const planner = new AgentToolCatalogPlanner(registry)
    expect(planner.queueKnownToolForActivation('不存在的工具')).toBe(false)
    expect(planner.hasPendingActivationRecovery()).toBe(false)
  })
})
