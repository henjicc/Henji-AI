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

  it('预算常量互相之间的约束成立', () => {
    // 发现一次最多回带的工具数不应少于单轮能激活的数量，否则永远填不满工具位。
    expect(AGENT_DISCOVERY_ADDED_TOOL_LIMIT).toBeGreaterThanOrEqual(AGENT_ACTIVE_TOOL_LIMIT)
    // 结算证据是各 Facet 证据的汇总，不能比单个 Facet 的上限还小。
    expect(AGENT_SETTLEMENT_EVIDENCE_LIMIT).toBeGreaterThanOrEqual(AGENT_FACET_EVIDENCE_LIMIT)
    // 记忆读取上限只是一个正整数约束，放这里是为了让它和其他预算一起被看见。
    expect(AGENT_MEMORY_LIST_LIMIT).toBeGreaterThan(0)
  })
})
