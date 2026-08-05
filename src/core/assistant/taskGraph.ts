import { z } from 'zod'

export const AGENT_TASK_GRAPH_VERSION = 'agent-task-graph/v2' as const
export const LEGACY_AGENT_TASK_GRAPH_VERSION = 'agent-task-graph/v1' as const

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

export const agentTaskEffectKindSchema = z.enum([
  'observe',
  'create',
  'update',
  'delete',
  'navigate',
  'execute',
])
export type AgentTaskEffectKind = z.infer<typeof agentTaskEffectKindSchema>

export const agentTaskEffectTargetSchema = z.object({
  kind: z.string().min(1).max(128),
  id: z.string().min(1).max(500),
}).strict()

export const agentTaskRequiredEffectSchema = z.object({
  effectId: z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/),
  effect: agentTaskEffectKindSchema,
  entityTypes: z.array(z.string().min(1).max(128)).max(AGENT_FACET_ENTITY_TYPE_LIMIT),
  propertyIds: z.array(z.string().min(1).max(128)).max(128),
  minimumCount: z.number().int().min(1).max(256),
  targetRefs: z.array(agentTaskEffectTargetSchema).max(128),
  verificationRequired: z.boolean(),
  actionGroupId: z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/),
}).strict()
export type AgentTaskRequiredEffect = z.infer<typeof agentTaskRequiredEffectSchema>

export const agentObservedEffectSchema = z.object({
  effect: agentTaskEffectKindSchema,
  entityTypes: z.array(z.string().min(1).max(128)).max(AGENT_FACET_ENTITY_TYPE_LIMIT),
  propertyIds: z.array(z.string().min(1).max(128)).max(128),
  targetRefs: z.array(agentTaskEffectTargetSchema).max(128),
  count: z.number().int().min(1).max(256),
  verified: z.boolean(),
  evidence: z.array(z.string().min(1).max(500)).max(12),
}).strict()
export type AgentObservedEffect = z.infer<typeof agentObservedEffectSchema>

export const agentTaskActionGroupSchema = z.object({
  actionGroupId: z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/),
  facetId: z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/),
  mode: z.enum(['parallel_read', 'atomic_batch', 'ordered_write', 'dependent']),
  effectIds: z.array(z.string().min(1).max(64)).min(1).max(32),
  dependsOn: z.array(z.string().min(1).max(64)).max(12),
}).strict()
export type AgentTaskActionGroup = z.infer<typeof agentTaskActionGroupSchema>

export const agentActionPlanDeclarationSchema = z.object({
  facets: z.array(z.object({
    facetId: z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/),
    requiredEffects: z.array(agentTaskRequiredEffectSchema).min(1).max(32),
  }).strict()).min(1).max(16),
  actionGroups: z.array(agentTaskActionGroupSchema).min(1).max(32),
}).strict()
export type AgentActionPlanDeclaration = z.infer<typeof agentActionPlanDeclarationSchema>

export const agentAcceptedActionPlanDeclarationSchema = agentActionPlanDeclarationSchema.extend({
  accepted: z.literal(true),
})

/**
 * 模型直接填写的 action plan 输入。
 *
 * 严格版（`agentActionPlanDeclarationSchema`）要求模型逐条给出 effectId、actionGroupId 和一份
 * 与 Facet 互相自洽的 actionGroups 列表——这些全是运行时可以自己推导的东西。实测里模型连着
 * 两次只拿到 "facets.0: Invalid input"，整次运行就被连续失败预算掐死。
 *
 * 这里只要求模型说清"要对什么实体产生什么 effect、至少几次"，其余 ID 与分组由
 * `normalizeDeclaredActionPlan` 推导；未知键直接剥离而不是判失败。
 */
const declaredRequiredEffectInputSchema = z.object({
  effectId: z.string().min(1).max(64).optional(),
  effect: agentTaskEffectKindSchema,
  entityTypes: z.array(z.string().min(1).max(128)).max(AGENT_FACET_ENTITY_TYPE_LIMIT).default([]),
  propertyIds: z.array(z.string().min(1).max(128)).max(128).default([]),
  minimumCount: z.number().int().min(1).max(256).default(1),
  targetRefs: z.array(agentTaskEffectTargetSchema).max(128).default([]),
  verificationRequired: z.boolean().default(false),
  actionGroupId: z.string().min(1).max(64).optional(),
})

export const agentActionPlanDeclarationInputSchema = z.object({
  facets: z.array(z.object({
    facetId: z.string().min(1).max(64),
    requiredEffects: z.array(declaredRequiredEffectInputSchema).min(1).max(32),
  })).min(1).max(16),
  // 只为兼容旧调用保留；分组一律由运行时推导，模型写错也不会导致整次声明失败。
  actionGroups: z.array(z.object({
    actionGroupId: z.string().min(1).max(64),
    facetId: z.string().min(1).max(64),
    mode: z.enum(['parallel_read', 'atomic_batch', 'ordered_write', 'dependent']).optional(),
    effectIds: z.array(z.string().min(1).max(64)).max(32).default([]),
    dependsOn: z.array(z.string().min(1).max(64)).max(12).default([]),
  })).max(32).default([]),
})
export type AgentActionPlanDeclarationInput = z.infer<typeof agentActionPlanDeclarationInputSchema>

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
  requiredEffects: z.array(agentTaskRequiredEffectSchema).max(32).default([]),
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

const agentTaskGraphV2Schema = z.object({
  version: z.literal(AGENT_TASK_GRAPH_VERSION),
  goal: z.string().min(1).max(32 * 1024),
  facets: z.array(agentTaskFacetSchema).min(1).max(AGENT_TASK_FACET_LIMIT),
  actionGroups: z.array(agentTaskActionGroupSchema).max(32).default([]),
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
  const effectOwners = new Map(graph.facets.flatMap((facet) => (
    facet.requiredEffects.map((effect) => [effect.effectId, facet.facetId] as const)
  )))
  const effectIds = new Set(effectOwners.keys())
  const groupIds = new Set(graph.actionGroups.map((group) => group.actionGroupId))
  if (effectIds.size !== graph.facets.reduce((count, facet) => count + facet.requiredEffects.length, 0)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['facets'], message: 'Effect ID 不能重复' })
  }
  if (groupIds.size !== graph.actionGroups.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['actionGroups'], message: 'Action Group ID 不能重复' })
  }
  for (const [index, group] of graph.actionGroups.entries()) {
    if (!ids.has(group.facetId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['actionGroups', index, 'facetId'], message: 'Action Group 必须引用已声明 Facet' })
    }
    if (group.effectIds.some((effectId) => !effectIds.has(effectId))) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['actionGroups', index, 'effectIds'], message: 'Action Group 必须引用已声明 Effect' })
    }
    if (group.effectIds.some((effectId) => effectOwners.get(effectId) !== group.facetId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['actionGroups', index, 'effectIds'], message: 'Action Group 只能包含所属 Facet 的 Effect' })
    }
    if (group.dependsOn.some((groupId) => !groupIds.has(groupId) || groupId === group.actionGroupId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['actionGroups', index, 'dependsOn'], message: 'Action Group 依赖必须引用其他已声明组' })
    }
  }
  for (const [facetIndex, facet] of graph.facets.entries()) {
    for (const [effectIndex, effect] of facet.requiredEffects.entries()) {
      if (!groupIds.has(effect.actionGroupId)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['facets', facetIndex, 'requiredEffects', effectIndex, 'actionGroupId'], message: 'Effect 必须引用已声明 Action Group' })
        continue
      }
      const group = graph.actionGroups.find((candidate) => candidate.actionGroupId === effect.actionGroupId)
      if (group?.facetId !== facet.facetId || !group.effectIds.includes(effect.effectId)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['facets', facetIndex, 'requiredEffects', effectIndex, 'actionGroupId'], message: 'Effect 必须被所属 Facet 的 Action Group 完整收录' })
      }
    }
  }
})

function derivedId(facetId: string, suffix: string): string {
  return `${facetId.slice(0, Math.max(2, 64 - suffix.length))}${suffix}`
}

/**
 * Action Group 完全由 Facet 的 Effect 与依赖决定，**只在这里推导一次**。
 *
 * 之前确定性任务图（task-facets）和模型声明（declare_action_plan）各推一份，两份稍有出入就会
 * 在 `agentTaskGraphV2Schema.superRefine` 的交叉引用校验上炸掉，而错误只显示成 "Invalid input"。
 */
export function deriveActionGroups(facets: AgentTaskFacet[]): AgentTaskActionGroup[] {
  const groups = facets.flatMap((facet) => {
    const byGroup = new Map<string, AgentTaskRequiredEffect[]>()
    for (const effect of facet.requiredEffects) {
      byGroup.set(effect.actionGroupId, [...(byGroup.get(effect.actionGroupId) ?? []), effect])
    }
    return [...byGroup.entries()].map(([actionGroupId, effects]) => ({
      actionGroupId,
      facetId: facet.facetId,
      mode: effects.every((effect) => effect.effect === 'observe' || effect.effect === 'navigate')
        ? 'parallel_read' as const
        : effects.length > 1 ? 'atomic_batch' as const : 'ordered_write' as const,
      effectIds: effects.map((effect) => effect.effectId),
      dependsOn: [] as string[],
    }))
  })
  const groupIdsByFacet = new Map<string, string[]>()
  for (const group of groups) {
    groupIdsByFacet.set(group.facetId, [
      ...(groupIdsByFacet.get(group.facetId) ?? []),
      group.actionGroupId,
    ])
  }
  const facetById = new Map(facets.map((facet) => [facet.facetId, facet]))
  return groups.map((group) => {
    const dependsOn = [...new Set((facetById.get(group.facetId)?.dependsOn ?? [])
      .flatMap((dependency) => groupIdsByFacet.get(dependency) ?? []))]
    return {
      ...group,
      mode: dependsOn.length > 0 ? 'dependent' as const : group.mode,
      dependsOn,
    }
  })
}

/**
 * 把模型的宽松声明补全为严格 Effect：ID 一律按 Facet 派生，保证全图唯一且与推导出的分组自洽。
 */
export function normalizeDeclaredRequiredEffects(
  facetId: string,
  declared: AgentActionPlanDeclarationInput['facets'][number]['requiredEffects']
): AgentTaskRequiredEffect[] {
  const actionGroupId = derivedId(facetId, '_actions')
  return declared.map((effect, index) => ({
    effectId: derivedId(facetId, `_e${index + 1}`),
    effect: effect.effect,
    entityTypes: effect.entityTypes,
    propertyIds: effect.propertyIds,
    minimumCount: effect.minimumCount,
    targetRefs: effect.targetRefs,
    verificationRequired: effect.verificationRequired,
    actionGroupId,
  }))
}

function implicitEffectForFacet(facet: Record<string, unknown>): AgentTaskRequiredEffect {
  const capabilityKinds = Array.isArray(facet.capabilityKinds) ? facet.capabilityKinds : []
  const effect: AgentTaskRequiredEffect['effect'] = capabilityKinds.includes('navigate')
    ? 'navigate'
    : capabilityKinds.includes('execute')
      ? 'execute'
      : capabilityKinds.includes('mutate') ? 'update' : 'observe'
  const facetId = typeof facet.facetId === 'string' ? facet.facetId : 'legacy_facet'
  return {
    effectId: derivedId(facetId, '_effect'),
    effect,
    entityTypes: Array.isArray(facet.targetEntityTypes)
      ? facet.targetEntityTypes.filter((value): value is string => typeof value === 'string')
      : [],
    propertyIds: [],
    minimumCount: 1,
    targetRefs: [],
    verificationRequired: false,
    actionGroupId: derivedId(facetId, '_actions'),
  }
}

function upgradeLegacyTaskGraph(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const graph = value as Record<string, unknown>
  if (graph.version !== LEGACY_AGENT_TASK_GRAPH_VERSION) return value
  const facets = Array.isArray(graph.facets)
    ? graph.facets.map((facet) => facet && typeof facet === 'object' && !Array.isArray(facet)
      ? {
          ...(facet as Record<string, unknown>),
          requiredEffects: [implicitEffectForFacet(facet as Record<string, unknown>)],
        }
      : facet)
    : graph.facets
  const actionGroups = Array.isArray(facets)
    ? facets.flatMap((facet) => {
        if (!facet || typeof facet !== 'object' || Array.isArray(facet)) return []
        const record = facet as Record<string, unknown>
        const effect = Array.isArray(record.requiredEffects) ? record.requiredEffects[0] : null
        if (!effect || typeof effect !== 'object' || Array.isArray(effect)) return []
        const required = effect as AgentTaskRequiredEffect
        const dependsOn = Array.isArray(record.dependsOn)
          ? record.dependsOn.flatMap((value) => (
              typeof value === 'string' ? [derivedId(value, '_actions')] : []
            ))
          : []
        return [{
          actionGroupId: required.actionGroupId,
          facetId: String(record.facetId),
          mode: dependsOn.length > 0
            ? 'dependent'
            : required.effect === 'observe' || required.effect === 'navigate'
              ? 'parallel_read'
              : 'ordered_write',
          effectIds: [required.effectId],
          dependsOn,
        }]
      })
    : []
  return { ...graph, version: AGENT_TASK_GRAPH_VERSION, facets, actionGroups }
}

/** 旧任务图只允许在这里升级；运行时和新保存点始终只处理 v2。 */
export const agentTaskGraphSchema = z.preprocess(upgradeLegacyTaskGraph, agentTaskGraphV2Schema)
export type AgentTaskGraph = z.infer<typeof agentTaskGraphSchema>

export function createSingleFacetTaskGraph(input: {
  goal: string
  facetId: string
  domain: string
  targetSurfaceId?: string | null
  capabilityKinds?: AgentTaskCapabilityKind[]
  effect?: AgentTaskRequiredEffect['effect']
  entityTypes?: string[]
  propertyIds?: string[]
  minimumCount?: number
  verificationRequired?: boolean
  completionCondition: string
  uncertainty?: string
}): AgentTaskGraph {
  const capabilityKinds = input.capabilityKinds ?? ['query']
  const effect: AgentTaskRequiredEffect['effect'] = input.effect ?? (capabilityKinds.includes('navigate')
    ? 'navigate'
    : capabilityKinds.includes('execute')
      ? 'execute'
      : capabilityKinds.includes('mutate') ? 'update' : 'observe')
  const effectId = derivedId(input.facetId, '_effect')
  const actionGroupId = derivedId(input.facetId, '_actions')
  return agentTaskGraphSchema.parse({
    version: AGENT_TASK_GRAPH_VERSION,
    goal: input.goal,
    facets: [{
      facetId: input.facetId,
      domain: input.domain,
      goal: input.goal,
      targetEntityTypes: input.entityTypes ?? [],
      requiredObservations: [],
      capabilityKinds,
      targetSurfaceId: input.targetSurfaceId ?? null,
      dependsOn: [],
      parallelizable: false,
      completionConditions: [input.completionCondition],
      requiredEffects: [{
        effectId,
        effect,
        entityTypes: input.entityTypes ?? [],
        propertyIds: input.propertyIds ?? [],
        minimumCount: input.minimumCount ?? 1,
        targetRefs: [],
        verificationRequired: input.verificationRequired ?? false,
        actionGroupId,
      }],
      uncertainties: input.uncertainty ? [input.uncertainty] : [],
      confidence: input.uncertainty ? 0.35 : 1,
      status: 'pending',
      statusReason: '',
      evidence: [],
    }],
    actionGroups: [{
      actionGroupId,
      facetId: input.facetId,
      mode: effect === 'observe' || effect === 'navigate' ? 'parallel_read' : 'ordered_write',
      effectIds: [effectId],
      dependsOn: [],
    }],
    dependencies: [],
    stopConditions: [
      '完成条件已有结构化证据时停止。',
      '能力缺失、权限不足或相同失败重复时停止并说明。',
    ],
  })
}
