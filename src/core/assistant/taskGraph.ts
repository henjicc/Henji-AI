import { z } from 'zod'

export const AGENT_TASK_GRAPH_VERSION = 'agent-task-graph/v1' as const

/** 一张任务图最多多少个 Facet。路由裁剪、进度结算与事件契约共用这一份。 */
export const AGENT_TASK_FACET_LIMIT = 16
/** 单个 Facet 声明的实体类型数量上限。 */
export const AGENT_FACET_ENTITY_TYPE_LIMIT = 16

export const agentTaskFacetStatusSchema = z.enum([
  'pending',
  'active',
  'completed',
  'blocked',
  'waiting_user',
])
export type AgentTaskFacetStatus = z.infer<typeof agentTaskFacetStatusSchema>

export const agentTaskCapabilityKindSchema = z.enum([
  'observe',
  'query',
  'plan',
  'mutate',
  'navigate',
  'execute',
])
export type AgentTaskCapabilityKind = z.infer<typeof agentTaskCapabilityKindSchema>

export const agentTaskObservationNeedSchema = z.object({
  kind: z.enum(['current_surface', 'entity_state', 'entity_schema', 'operation_schema']),
  entityTypes: z.array(z.string().min(1).max(128)).max(AGENT_FACET_ENTITY_TYPE_LIMIT),
  reason: z.string().min(1).max(500),
}).strict()
export type AgentTaskObservationNeed = z.infer<typeof agentTaskObservationNeedSchema>

export const agentTaskFacetSchema = z.object({
  facetId: z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/),
  domain: z.string().regex(/^[a-z][a-z0-9_.-]{1,63}$/),
  goal: z.string().min(1).max(1_000),
  targetEntityTypes: z.array(z.string().min(1).max(128)).max(AGENT_FACET_ENTITY_TYPE_LIMIT),
  requiredObservations: z.array(agentTaskObservationNeedSchema).max(12),
  capabilityKinds: z.array(agentTaskCapabilityKindSchema).min(1).max(6),
  targetSurfaceId: z.string().min(1).max(128).nullable(),
  dependsOn: z.array(z.string().min(1).max(64)).max(12),
  parallelizable: z.boolean(),
  completionConditions: z.array(z.string().min(1).max(500)).min(1).max(12),
  uncertainties: z.array(z.string().min(1).max(500)).max(8),
  confidence: z.number().min(0).max(1),
  status: agentTaskFacetStatusSchema,
  statusReason: z.string().max(1_000),
  evidence: z.array(z.string().min(1).max(500)).max(12),
}).strict()
export type AgentTaskFacet = z.infer<typeof agentTaskFacetSchema>

export const agentTaskDependencySchema = z.object({
  fromFacetId: z.string().min(1).max(64),
  toFacetId: z.string().min(1).max(64),
}).strict()

export const agentTaskGraphSchema = z.object({
  version: z.literal(AGENT_TASK_GRAPH_VERSION),
  goal: z.string().min(1).max(32 * 1024),
  facets: z.array(agentTaskFacetSchema).min(1).max(AGENT_TASK_FACET_LIMIT),
  dependencies: z.array(agentTaskDependencySchema).max(64),
  stopConditions: z.array(z.string().min(1).max(500)).min(1).max(12),
}).strict().superRefine((graph, context) => {
  const ids = new Set<string>()
  for (const [index, facet] of graph.facets.entries()) {
    if (ids.has(facet.facetId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['facets', index, 'facetId'],
        message: 'Facet ID 不能重复',
      })
    }
    ids.add(facet.facetId)
  }
  for (const [index, edge] of graph.dependencies.entries()) {
    if (!ids.has(edge.fromFacetId) || !ids.has(edge.toFacetId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dependencies', index],
        message: '依赖边必须引用已声明的 Facet',
      })
    }
    if (edge.fromFacetId === edge.toFacetId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dependencies', index],
        message: 'Facet 不能依赖自身',
      })
    }
  }
  for (const [index, facet] of graph.facets.entries()) {
    for (const dependency of facet.dependsOn) {
      if (!ids.has(dependency) || dependency === facet.facetId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['facets', index, 'dependsOn'],
          message: 'Facet 依赖必须引用其他已声明 Facet',
        })
      }
    }
  }
})
export type AgentTaskGraph = z.infer<typeof agentTaskGraphSchema>

export function createSingleFacetTaskGraph(input: {
  goal: string
  facetId: string
  domain: string
  targetSurfaceId?: string | null
  capabilityKinds?: AgentTaskCapabilityKind[]
  completionCondition: string
  uncertainty?: string
}): AgentTaskGraph {
  return agentTaskGraphSchema.parse({
    version: AGENT_TASK_GRAPH_VERSION,
    goal: input.goal,
    facets: [{
      facetId: input.facetId,
      domain: input.domain,
      goal: input.goal,
      targetEntityTypes: [],
      requiredObservations: [],
      capabilityKinds: input.capabilityKinds ?? ['query'],
      targetSurfaceId: input.targetSurfaceId ?? null,
      dependsOn: [],
      parallelizable: false,
      completionConditions: [input.completionCondition],
      uncertainties: input.uncertainty ? [input.uncertainty] : [],
      confidence: input.uncertainty ? 0.35 : 1,
      status: 'pending',
      statusReason: '',
      evidence: [],
    }],
    dependencies: [],
    stopConditions: [
      '完成条件已有结构化证据时停止。',
      '能力缺失、权限不足或相同失败重复时停止并说明。',
    ],
  })
}
