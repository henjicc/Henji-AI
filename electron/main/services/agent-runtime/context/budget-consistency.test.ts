import { describe, expect, it } from 'vitest'

import { AGENT_MEMORY_LIST_LIMIT } from '../../../../../src/core/assistant/memory'
import {
  AGENT_FACET_EVIDENCE_LIMIT,
  AGENT_SETTLEMENT_EVIDENCE_LIMIT,
  agentFacetProgressSchema,
  agentProgressSettlementSchema,
} from '../../../../../src/core/assistant/progress'
import {
  AGENT_FACET_ENTITY_TYPE_LIMIT,
  AGENT_TASK_FACET_LIMIT,
  agentTaskGraphSchema,
} from '../../../../../src/core/assistant/taskGraph'
import {
  AGENT_ACTIVE_TOOL_LIMIT,
  AGENT_DISCOVERY_LEASE_TOOL_LIMIT,
  AGENT_FACET_LEASE_TOOL_LIMIT,
  AGENT_LEASE_FRONTIER_FACET_LIMIT,
  AGENT_TOOL_DESCRIPTION_BUDGET_BYTES,
  AGENT_TOOL_SCHEMA_BUDGET_BYTES,
} from '../../../../../src/core/assistant/toolBudget'
import { applicationCapabilitySearchResultSchema } from '../../../../../src/core/assistant/applicationCapabilities'
import { applicationCapabilityDiscoveryOutputSchema } from '../../../../../src/core/assistant/capabilityDiscovery'
import { estimateAgentTextTokens } from '../../../../../src/core/assistant/tokenEstimate'
import { createBackendBuiltinTools } from '../tools/builtin/backend'
import { createFrontendApplicationCapabilityTools } from '../tools/builtin/frontend-capabilities'
import { AgentToolRegistry } from '../tools/registry'
import { activateAgentTools } from './tool-activation'
import { estimateModelMessagesTokens } from './compaction'
import { selectContextLayers } from './layer-budget'

// 双路径清单 DP-01、DP-02、DP-06：预算、估算与输出契约只允许具名常量来源。

/**
 * 「一个不变量，多处各写一份」是本项目已经犯过两次的错：
 *
 * - 活动工具数曾经在运行时激活、上下文构建、事件契约、保存点契约里各写一份（8/8/12/12）。
 *   四处互不知情，直到有人真去调它——把运行时提到 16 之后，每一次运行都在发出模型请求
 *   之前被 schema 挡下，界面上只显示一句 "Invalid input"，看不出与工具数有任何关系。
 * - Facet 证据条数、任务图 Facet 数、能力发现增量工具数、记忆读取条数，也都是运行时截断
 *   与 schema 上限各写一份。
 *
 * 这类问题的共同特征是**只有在有人真去动它的那一刻才暴露**，靠评审记不住。
 *
 * 这里用**行为断言**而不是扫描裸数字：按每个预算的上限造一份满载数据，要求它能通过对应
 * 契约。这样不管数字写成常量还是字面量，只要两边不一致就会失败；也不会因为某处哈希前缀
 * 恰好 `slice(0, 16)` 就误报。
 */

function facetIds(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `facet_${index}`)
}

function evidence(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `evidence:${index}`)
}

describe('预算常量与契约一致', () => {
  it('满载的任务图能通过契约', () => {
    const parsed = agentTaskGraphSchema.safeParse({
      version: 'agent-task-graph/v1',
      goal: '满载任务图',
      facets: facetIds(AGENT_TASK_FACET_LIMIT).map((facetId) => ({
        facetId,
        domain: 'camera_stage',
        goal: '满载 Facet',
        targetEntityTypes: Array.from(
          { length: AGENT_FACET_ENTITY_TYPE_LIMIT },
          (_, index) => `entity_${index}`
        ),
        requiredObservations: [],
        capabilityKinds: ['query'],
        targetSurfaceId: null,
        dependsOn: [],
        parallelizable: true,
        completionConditions: ['完成'],
        uncertainties: [],
        confidence: 1,
        status: 'pending',
        statusReason: '',
        evidence: evidence(AGENT_FACET_EVIDENCE_LIMIT),
      })),
      dependencies: [],
      stopConditions: ['停止'],
    })
    expect(parsed.error?.issues ?? []).toEqual([])
    expect(parsed.success).toBe(true)
  })

  it('满载的 Facet 进度与结算能通过契约', () => {
    expect(agentFacetProgressSchema.safeParse({
      facetId: 'facet_0',
      status: 'completed',
      kind: 'revision_changed',
      summary: '满载证据',
      evidence: evidence(AGENT_FACET_EVIDENCE_LIMIT),
    }).success).toBe(true)

    expect(agentProgressSettlementSchema.safeParse({
      status: 'completed',
      completedFacetIds: facetIds(AGENT_TASK_FACET_LIMIT),
      blockedFacets: [],
      waitingFacetIds: [],
      remainingFacetIds: [],
      evidence: evidence(AGENT_SETTLEMENT_EVIDENCE_LIMIT),
      summary: '满载结算',
      suggestedNextStep: null,
    }).success).toBe(true)
  })

  it('分层预算与压缩链路必须用同一套 token 估算', () => {
    // 曾经是两份：压缩按字符类别加权，分层却是 length/4。两者在同一个 AgentContextBuilder
    // 里被同时调用——分层按 /4 把层塞满，构建器用加权口径一量发现超了，就掉头砍活动工具。
    // 中文越多砍得越狠，而现象是"工具位莫名其妙不够用"，看不出跟中文有关。
    const chinese = '在场景里放一个立方体并让摄像机围绕它旋转'
    expect(estimateModelMessagesTokens([{ role: 'user', content: chinese }]))
      .toBe(estimateAgentTextTokens(`user:${chinese}`))
  })

  it('分层截断不会放行超出该层预算的内容', () => {
    const layer = {
      id: 'observations' as const,
      source: 'agent_tool_gateway',
      trust: 'untrusted_observation' as const,
      priority: 90,
      required: true,
      maxTokens: 120,
      content: '这是一段很长的中文观察内容。'.repeat(80),
    }
    const selected = selectContextLayers([layer], 100_000)
    const report = selected.reports.find((item) => item.id === 'observations')
    expect(report?.truncated).toBe(true)
    // 报告的 token 数含层信封（CONTEXT_LAYER 标记行）与截断提示，约几十 token 的固定开销。
    // 真正的门禁是它必须远小于旧口径：旧实现按 maxTokens * 4 换算字符数，中文下会放进
    // 480 字 ≈ 480 token，是预算的四倍。
    expect(report?.estimatedTokens ?? 0).toBeLessThan(layer.maxTokens * 2)
  })

  it('预算常量互相之间的约束成立', () => {
    // 租约只覆盖依赖前沿，不承担填满整个活动工具集的职责。
    expect(AGENT_DISCOVERY_LEASE_TOOL_LIMIT)
      .toBe(AGENT_FACET_LEASE_TOOL_LIMIT * AGENT_LEASE_FRONTIER_FACET_LIMIT)
    expect(AGENT_DISCOVERY_LEASE_TOOL_LIMIT).toBeLessThan(AGENT_ACTIVE_TOOL_LIMIT)
    // 结算证据是各 Facet 证据的汇总，不能比单个 Facet 的上限还小。
    expect(AGENT_SETTLEMENT_EVIDENCE_LIMIT).toBeGreaterThanOrEqual(AGENT_FACET_EVIDENCE_LIMIT)
    // 记忆读取上限只是一个正整数约束，放这里是为了让它和其他预算一起被看见。
    expect(AGENT_MEMORY_LIST_LIMIT).toBeGreaterThan(0)
  })

  it('能力发现的两份输出契约都容纳完整增量工具预算', () => {
    const toolNames = Array.from(
      { length: AGENT_DISCOVERY_LEASE_TOOL_LIMIT },
      (_, index) => `tool_${index}`,
    )
    expect(applicationCapabilityDiscoveryOutputSchema.shape.leasedToolNames.safeParse(toolNames).success)
      .toBe(true)
    expect(applicationCapabilitySearchResultSchema.shape.leasedToolNames.safeParse(toolNames).success)
      .toBe(true)
  })
})

/**
 * 三维任务反复"莫名其妙停下来"的三个直接原因，各守一条。
 *
 * 共同点是：能力其实都在，模型也知道该调什么，但工具没进本轮活动集，而"下一轮再给你"这个
 * 承诺又被任务图结算掐断。用户看到的就是助手汇报"当前工具集没有 XX 能力"然后收工。
 */
describe('工具激活不得让通用动词落选', () => {
  function activate(toolDomains: string[]) {
    const registry = new AgentToolRegistry()
    const definitions = [
      ...createBackendBuiltinTools(registry, {
        listArtifacts: () => [], readArtifact: () => null,
      } as never),
      // 通用反射动词是 frontend 侧能力，必须一起注册，否则这条门禁只是在测后端内置工具
      ...createFrontendApplicationCapabilityTools((async () => ({})) as never),
    ]
    for (const definition of definitions) registry.register(definition)
    // 前端能力只有出现在宿主快照的 availableCapabilities 里才算可用，传 null 会把它们全过滤掉
    const context = {
      uiReady: true,
      availableCapabilities: definitions.map((definition) => definition.name),
    } as never
    return activateAgentTools(registry, {
      route: {
        routeVersion: 'agent-route/v2', intent: 'camera_stage', candidateIntents: ['camera_stage'],
        complexity: 'multi_step', path: 'workflow', toolDomains, source: 'deterministic', reason: '三维任务',
      } as never,
      context,
      pinnedToolNames: [],
      leasedToolNames: [],
      recentToolNames: [],
    })
  }

  it('三维任务也拿得到通用反射动词', () => {
    // 这些能力的 domain 是 application，而三维任务的 toolDomains 是 camera_stage/toolbox。
    // 只靠 directNames 命中的话它们永远进不来——实测就是这么丢的。
    const active = new Set(activate(['toolbox', 'camera_stage', 'catalog']).activeToolNames)
    expect(active.has('change_application_entities')).toBe(true)
    expect(active.has('describe_application_entities')).toBe(true)
  })

  it('技能加载与能力发现同样常驻', () => {
    const active = new Set(activate(['toolbox', 'camera_stage', 'catalog']).activeToolNames)
    expect(active.has('load_assistant_skill')).toBe(true)
    expect(active.has('discover_application_capabilities')).toBe(true)
  })

  it('活动工具数量、完整 schema 与业务描述字节都有构建门禁', () => {
    const snapshot = activate(['toolbox', 'camera_stage', 'catalog'])
    expect(snapshot.activeToolNames.length).toBeLessThanOrEqual(AGENT_ACTIVE_TOOL_LIMIT)
    expect(snapshot.schemaBytes).toBeLessThanOrEqual(AGENT_TOOL_SCHEMA_BUDGET_BYTES)
    expect(snapshot.descriptionBytes).toBeLessThanOrEqual(AGENT_TOOL_DESCRIPTION_BUDGET_BYTES)
  })

  it('AI 可见 schema 不再暴露第二条 revision 输入路径', () => {
    for (const registration of activate(['toolbox', 'camera_stage', 'catalog']).registrations) {
      const properties = registration.modelTool.inputSchema.properties
      if (!properties || typeof properties !== 'object' || Array.isArray(properties)) continue
      expect(properties).not.toHaveProperty('baseRevision')
      expect(properties).not.toHaveProperty('expectedRevisions')
    }
  })
})
