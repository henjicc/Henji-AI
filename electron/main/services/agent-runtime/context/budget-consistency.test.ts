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
  AGENT_DISCOVERY_ADDED_TOOL_LIMIT,
} from '../../../../../src/core/assistant/toolBudget'
import { estimateAgentTextTokens } from '../../../../../src/core/assistant/tokenEstimate'
import { estimateModelMessagesTokens } from './compaction'
import { selectContextLayers } from './layer-budget'

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
    // 发现一次最多回带的工具数不应少于单轮能激活的数量，否则永远填不满工具位。
    expect(AGENT_DISCOVERY_ADDED_TOOL_LIMIT).toBeGreaterThanOrEqual(AGENT_ACTIVE_TOOL_LIMIT)
    // 结算证据是各 Facet 证据的汇总，不能比单个 Facet 的上限还小。
    expect(AGENT_SETTLEMENT_EVIDENCE_LIMIT).toBeGreaterThanOrEqual(AGENT_FACET_EVIDENCE_LIMIT)
    // 记忆读取上限只是一个正整数约束，放这里是为了让它和其他预算一起被看见。
    expect(AGENT_MEMORY_LIST_LIMIT).toBeGreaterThan(0)
  })
})
