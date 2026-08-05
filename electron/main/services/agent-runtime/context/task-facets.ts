import { z } from 'zod'

import type { HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import {
  AGENT_FACET_ENTITY_TYPE_LIMIT,
  AGENT_TASK_FACET_LIMIT,
  AGENT_TASK_GRAPH_VERSION,
  agentTaskGraphSchema,
  deriveActionGroups,
  type AgentTaskFacet,
  type AgentTaskGraph,
  type AgentTaskRequiredEffect,
} from '../../../../../src/core/assistant/taskGraph'
import { AGENT_TOOL_DOMAINS, type AgentIntent, type AgentToolDomain } from './types'
import {
  buildDeterministicCameraFacets,
  cameraTaskGraphCoversGoal,
  type DeterministicFacetInput,
} from './deterministic-camera-task'
import { explicitlyCreatesProject, inferIntentTaskSemantics } from './task-intent-semantics'

const modelFacetSchema = z.object({
  facetId: z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/),
  domain: z.enum(AGENT_TOOL_DOMAINS),
  goal: z.string().min(1).max(1_000),
  targetEntityTypes: z.array(z.string().min(1).max(128)).max(AGENT_FACET_ENTITY_TYPE_LIMIT).default([]),
  observationKinds: z.array(z.enum([
    'current_surface', 'entity_state', 'entity_schema', 'operation_schema',
  ])).max(4).default([]),
  capabilityKinds: z.array(z.enum([
    'observe', 'query', 'plan', 'mutate', 'navigate', 'execute',
  ])).min(1).max(6),
  targetSurfaceId: z.string().min(1).max(128).nullable().default(null),
  dependsOn: z.array(z.string().min(1).max(64)).max(12).default([]),
  parallelizable: z.boolean().default(false),
  completionConditions: z.array(z.string().min(1).max(500)).min(1).max(12),
  requiredEffects: z.array(z.object({
    effectId: z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/),
    effect: z.enum(['observe', 'create', 'update', 'delete', 'navigate', 'execute']),
    entityTypes: z.array(z.string().min(1).max(128)).max(16).default([]),
    propertyIds: z.array(z.string().min(1).max(128)).max(128).default([]),
    minimumCount: z.number().int().min(1).max(256).default(1),
    targetRefs: z.array(z.object({ kind: z.string().min(1), id: z.string().min(1) }).strict()).max(128).default([]),
    verificationRequired: z.boolean().default(false),
    actionGroupId: z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/),
  }).strict()).min(1).max(32),
  uncertainties: z.array(z.string().min(1).max(500)).max(8).default([]),
  confidence: z.number().min(0).max(1).default(0.5),
}).strict()

const surfaceByDomain: Partial<Record<AgentToolDomain, string>> = {
  navigation: 'workspace.generation',
  generation: 'workspace.generation',
  canvas: 'workspace.canvas',
  toolbox: 'workspace.tools',
  camera_stage: 'tool.camera_stage',
  image_edit: 'tool.image_edit',
  assets: 'workspace.assets',
  settings: 'settings.general',
}

const entityTypesByDomain: Partial<Record<AgentToolDomain, string[]>> = {
  generation: ['generation.task', 'generation.result'],
  canvas: ['canvas.project', 'canvas.node'],
  camera_stage: ['camera_stage.project', 'camera_stage.scene', 'camera_stage.camera'],
  image_edit: ['image_edit.session', 'generation.result', 'asset'],
  assets: ['asset'],
  settings: ['application.setting'],
  workflows: ['workflow', 'workflow.run'],
}

function unique<TValue extends string>(values: TValue[]): TValue[] {
  return [...new Set(values)]
}

function observationNeeds(
  kinds: Array<'current_surface' | 'entity_state' | 'entity_schema' | 'operation_schema'>,
  entityTypes: string[],
  goal: string
): AgentTaskFacet['requiredObservations'] {
  return unique(kinds).map((kind) => ({
    kind,
    entityTypes: kind === 'current_surface' ? [] : entityTypes,
    reason: kind === 'current_surface'
      ? '锚定用户当前可见位置与相对指代。'
      : `在执行“${goal.slice(0, 120)}”前读取真实${kind === 'entity_state' ? '状态' : '控制结构'}。`,
  }))
}

function buildFacet(input: DeterministicFacetInput): AgentTaskFacet {
  const declaredEntityTypes = unique(input.entityTypes ?? entityTypesByDomain[input.domain] ?? [])
  const defaultEffect: AgentTaskRequiredEffect['effect'] = input.capabilityKinds.includes('navigate')
    ? 'navigate'
    : input.capabilityKinds.includes('execute')
      ? 'execute'
      : input.capabilityKinds.includes('mutate') ? 'update' : 'observe'
  const targetSurfaceId = input.targetSurfaceId ?? surfaceByDomain[input.domain] ?? null
  const requiredEffects = (input.requiredEffects ?? [{
    effectId: `${input.facetId}_effect`,
    effect: defaultEffect,
    entityTypes: declaredEntityTypes,
    propertyIds: [],
    minimumCount: 1,
    targetRefs: [],
    verificationRequired: defaultEffect !== 'observe' && defaultEffect !== 'navigate',
    actionGroupId: `${input.facetId}_actions`,
  }]).map((effect) => (
    /*
     * "打开 X 页面"的完成条件必须绑定到 X 本身。
     *
     * 不绑的话 effectMatches 对 navigate 只比 effect 名，切到任意工作区都算数——实测里
     * switch_workspace 切到工具工作区就把"打开三维编辑器"标成完成，三维工程页面始终没打开。
     */
    effect.effect === 'navigate' && targetSurfaceId && effect.targetRefs.length === 0
      ? { ...effect, targetRefs: [{ kind: 'application.surface', id: targetSurfaceId }] }
      : effect
  ))
  const entityTypes = unique([
    ...declaredEntityTypes,
    ...requiredEffects.flatMap((effect) => effect.entityTypes),
  ]).slice(0, AGENT_FACET_ENTITY_TYPE_LIMIT)
  return {
    facetId: input.facetId,
    domain: input.domain,
    goal: input.goal,
    targetEntityTypes: entityTypes,
    requiredObservations: observationNeeds(
      input.observationKinds ?? (entityTypes.length > 0 ? ['entity_state', 'operation_schema'] : []),
      entityTypes,
      input.goal
    ),
    capabilityKinds: unique(input.capabilityKinds),
    targetSurfaceId,
    dependsOn: unique(input.dependsOn ?? []),
    parallelizable: input.parallelizable ?? false,
    completionConditions: unique(input.completionConditions),
    requiredEffects,
    uncertainties: unique(input.uncertainties ?? []),
    confidence: input.confidence ?? 1,
    status: 'pending',
    statusReason: '',
    evidence: [],
  }
}

/**
 * 打断依赖环。
 *
 * schema 只拦自环和悬空边，**多节点环是放行的**。一旦成环，环上的 Facet 永远没有一个"依赖
 * 全部完成"的可运行项，任务图无法自行推进；而结算侧看到的是"没有受阻、没有等待用户"，
 * 于是把整张图判成完成并下发停止指令——实测就是这样丢掉了圆柱体、环绕运镜和漂浮动画。
 *
 * 这里按声明顺序做一次深度优先，只丢掉指回祖先的那条边：任务图是运行时按启发式拼出来的，
 * 为一条多余的依赖边把整次运行否掉，代价远大于少一条排序约束。
 */
function breakDependencyCycles(facets: AgentTaskFacet[]): AgentTaskFacet[] {
  const byId = new Map(facets.map((facet) => [facet.facetId, facet]))
  const kept = new Map(facets.map((facet) => [facet.facetId, [...facet.dependsOn]]))
  const state = new Map<string, 'visiting' | 'done'>()
  const visit = (facetId: string): void => {
    if (state.get(facetId) === 'done') return
    state.set(facetId, 'visiting')
    const dependencies = kept.get(facetId) ?? []
    kept.set(facetId, dependencies.filter((dependency) => {
      if (!byId.has(dependency)) return false
      if (state.get(dependency) === 'visiting') return false
      visit(dependency)
      return true
    }))
    state.set(facetId, 'done')
  }
  for (const facet of facets) visit(facet.facetId)
  return facets.map((facet) => ({ ...facet, dependsOn: kept.get(facet.facetId) ?? [] }))
}

function graph(goal: string, facets: AgentTaskFacet[]): AgentTaskGraph {
  const facetIds = new Set(facets.map((facet) => facet.facetId))
  const normalized = breakDependencyCycles(facets.map((facet) => ({
    ...facet,
    dependsOn: facet.dependsOn.filter((dependency) => facetIds.has(dependency)),
  })))
  return agentTaskGraphSchema.parse({
    version: AGENT_TASK_GRAPH_VERSION,
    goal,
    facets: normalized,
    actionGroups: deriveActionGroups(normalized),
    dependencies: normalized.flatMap((facet) => facet.dependsOn.map((dependency) => ({
      fromFacetId: dependency,
      toFacetId: facet.facetId,
    }))),
    stopConditions: [
      '全部 Facet 完成条件都有结构化证据时停止。',
      '能力不存在、权限不足或需要用户选择时结算为受阻或等待用户。',
      '相同发现、相同写入或相同失败没有产生新 revision、验证差异或 schema 时停止。',
    ],
  })
}

function ensureEarlyCameraSurface(facets: AgentTaskFacet[]): AgentTaskFacet[] {
  const cameraWrites = facets.filter((facet) => facet.domain === 'camera_stage'
    && facet.capabilityKinds.some((kind) => kind === 'mutate' || kind === 'execute'))
  if (cameraWrites.length === 0) return facets
  const existingNavigation = facets.find((facet) => facet.targetSurfaceId === 'tool.camera_stage'
    && facet.capabilityKinds.includes('navigate'))
  const anchor = facets.find((facet) => facet.domain === 'camera_stage'
    && facet.capabilityKinds.some((kind) => kind === 'query' || kind === 'plan'))
  const navigation = existingNavigation ?? buildFacet({
    facetId: 'show_camera_surface',
    domain: 'navigation',
    goal: '取得稳定三维工程引用后立即打开目标编辑器，让用户看到后续执行。',
    observationKinds: ['current_surface'],
    capabilityKinds: ['observe', 'navigate'],
    targetSurfaceId: 'tool.camera_stage',
    dependsOn: anchor ? [anchor.facetId] : [],
    parallelizable: false,
    completionConditions: ['宿主返回 surfaceId=tool.camera_stage，且工程引用与当前编辑器一致。'],
  })
  const navigationId = navigation.facetId
  const normalized = facets.map((facet) => {
    if (facet.facetId === navigationId) return {
      ...facet,
      dependsOn: anchor && facet.facetId !== anchor.facetId ? unique([...facet.dependsOn, anchor.facetId]) : facet.dependsOn,
      parallelizable: false,
    }
    if (!cameraWrites.some((candidate) => candidate.facetId === facet.facetId) || facet.facetId === anchor?.facetId) return facet
    return { ...facet, dependsOn: unique([...facet.dependsOn, navigationId]), parallelizable: false }
  })
  return existingNavigation ? normalized : [...normalized, navigation]
}

function inferNavigationSurface(goal: string, snapshot: HostContextSnapshot): string | null {
  if (/(?:3d|三维|镜头|运镜|摄像机)/i.test(goal)) return 'tool.camera_stage'
  if (/(?:画布|节点|连线)/i.test(goal)) return 'workspace.canvas'
  if (/(?:素材|资源库)/i.test(goal)) return 'workspace.assets'
  if (/(?:设置|偏好)/i.test(goal)) return 'settings.general'
  if (/(?:生成|生图|视频|音频)/i.test(goal)) return 'workspace.generation'
  return snapshot.surface?.id ?? null
}

function inferRequestedCount(goal: string): number {
  const numeric = [...goal.matchAll(/(?:创建|添加|放置|摆放|新建|设置|修改)?\s*(\d{1,3})\s*(?:个|项|条|组|枚|座)/gi)]
    .flatMap((match) => match[1] ? [Number(match[1])] : [])
  const values: Readonly<Record<string, number>> = {
    一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
  }
  const chinese = [...goal.matchAll(/(?:创建|添加|放置|摆放|新建|设置|修改)?\s*([一二两三四五六七八九十])\s*(?:个|项|条|组|枚|座)/g)]
    .flatMap((match) => match[1] ? [values[match[1]] ?? 1] : [])
  return Math.min(256, Math.max(1, ...numeric, ...chinese))
}

export interface DeterministicTaskGraphMatch {
  graph: AgentTaskGraph
  intents: AgentIntent[]
  domains: AgentToolDomain[]
}

export function createDeterministicTaskGraph(
  goal: string,
  snapshot: HostContextSnapshot
): DeterministicTaskGraphMatch | null {
  const normalized = goal.normalize('NFKC')
  const hasCamera = /(?:3d|三维|镜头|运镜|摄像机|相机|轨迹|场景|立方体|棱锥)/i.test(normalized)
  const hasCanvas = /(?:画布|节点|连线|流程图|canvas)/i.test(normalized)
  const hasCanvasTask = hasCanvas
    && /(?:节点|连线|流程图|画布项目|画布里|画布中|canvas\s*(?:node|edge|project)|布局)/i.test(normalized)
  const hasNavigation = /(?:打开|进入|切换|展示|查看|定位|让我看到|open|show|navigate)/i.test(normalized)
  if (!hasCamera && !hasCanvasTask) return null

  const facets: AgentTaskFacet[] = []
  const canvasSemantics = hasCanvasTask ? inferIntentTaskSemantics('canvas', normalized) : null
  let canvasNeedsVerification = false
  if (hasCanvasTask) {
    const createsCanvasProject = explicitlyCreatesProject(normalized)
    const targetsNode = /(?:节点|连线|node|edge)/i.test(normalized)
    const connectsNodes = /(?:连接|连线|接入|connect|edge)/i.test(normalized)
    if (createsCanvasProject) facets.push(buildFacet({
      facetId: 'canvas_project', domain: 'canvas',
      goal: '创建用户明确要求的新画布项目，并取得项目稳定引用。',
      observationKinds: ['entity_state', 'entity_schema', 'operation_schema'],
      capabilityKinds: ['observe', 'query', 'plan', 'mutate'],
      completionConditions: ['新画布项目已创建并通过结构化读取确认。'],
      requiredEffects: [{
        effectId: 'canvas_project_effect', effect: 'create', entityTypes: ['canvas.project'],
        propertyIds: [], minimumCount: 1, targetRefs: [], verificationRequired: true,
        actionGroupId: 'canvas_project_actions',
      }],
    }))
    if (!createsCanvasProject || targetsNode) {
      const semantics = canvasSemantics as ReturnType<typeof inferIntentTaskSemantics>
      const facetId = targetsNode ? 'canvas_structure' : 'canvas_project'
      facets.push(buildFacet({
        facetId, domain: 'canvas',
        goal: targetsNode ? '完成用户要求的画布节点和连线结构。' : '完成用户要求的画布项目操作。',
        entityTypes: connectsNodes
          ? unique([...semantics.entityTypes, 'canvas.edge'])
          : semantics.entityTypes,
        observationKinds: ['entity_state', 'entity_schema', 'operation_schema'],
        capabilityKinds: semantics.capabilityKinds,
        dependsOn: createsCanvasProject ? ['canvas_project'] : [],
        completionConditions: ['目标画布项目或节点结构具有稳定引用、revision 和结构化结果。'],
        requiredEffects: [{
          effectId: `${facetId}_effect`, effect: semantics.effect,
          entityTypes: semantics.entityTypes, propertyIds: [],
          minimumCount: targetsNode && semantics.effect === 'create' ? inferRequestedCount(normalized) : 1,
          targetRefs: [], verificationRequired: !['observe', 'navigate'].includes(semantics.effect),
          actionGroupId: `${facetId}_actions`,
        }, ...(connectsNodes && semantics.effect === 'create' ? [{
          effectId: `${facetId}_edge_effect` as const,
          effect: 'create' as const,
          entityTypes: ['canvas.edge'], propertyIds: [], minimumCount: 1,
          targetRefs: [], verificationRequired: true,
          actionGroupId: `${facetId}_actions`,
        }] : [])],
      }))
      canvasNeedsVerification = targetsNode && !['observe', 'navigate'].includes(semantics.effect)
    }
  }
  if (canvasNeedsVerification) facets.push(buildFacet({
    facetId: 'canvas_verify', domain: 'canvas',
    goal: '用结构化画布状态验证节点、连线和布局结果。',
    observationKinds: ['entity_state'], capabilityKinds: ['observe', 'query'],
    dependsOn: ['canvas_structure'], parallelizable: false,
    completionConditions: ['结构化读取确认目标节点、连线和布局满足要求。'],
    requiredEffects: [{
      effectId: 'canvas_verify_effect', effect: 'observe',
      entityTypes: ['canvas.project', 'canvas.node', 'canvas.edge'], propertyIds: [],
      minimumCount: 1, targetRefs: [], verificationRequired: false,
      actionGroupId: 'canvas_verify_actions',
    }],
  }))
  if (hasCamera) facets.push(...buildDeterministicCameraFacets(normalized, buildFacet, hasNavigation))
  if (hasNavigation && !hasCamera && (!canvasSemantics || canvasSemantics.effect !== 'navigate')) {
    facets.push(buildFacet({
      facetId: 'show_target_surface',
      domain: 'navigation',
      goal: '打开或定位用户明确要求查看的目标界面。',
      observationKinds: ['current_surface'],
      capabilityKinds: ['observe', 'navigate'],
      targetSurfaceId: inferNavigationSurface(goal, snapshot),
      parallelizable: true,
      completionConditions: ['宿主返回实际打开的目标 Surface ID。'],
    }))
  }
  return {
    graph: graph(goal, facets),
    intents: unique([
      ...(hasCamera ? ['camera_stage' as const] : []),
      ...(hasCanvasTask ? ['canvas' as const] : []),
      ...(hasNavigation ? ['navigate' as const] : []),
    ]),
    domains: unique(facets.map((facet) => facet.domain as AgentToolDomain)),
  }
}

export function createModelTaskGraph(input: {
  goal: string
  rawFacets: unknown
  primaryIntent: AgentIntent
  candidateDomains: AgentToolDomain[]
  snapshot: HostContextSnapshot
}): AgentTaskGraph {
  const planned = tryCreateModelTaskGraph(input)
  if (planned) return planned

  const fallbackDomain = input.candidateDomains.find((domain) => domain !== 'catalog') ?? 'catalog'
  const fallbackSemantics = inferIntentTaskSemantics(input.primaryIntent, input.goal)
  return graph(input.goal, [buildFacet({
    facetId: input.primaryIntent === 'general' ? 'clarify_goal' : input.primaryIntent,
    domain: fallbackDomain,
    goal: input.goal,
    observationKinds: fallbackDomain === 'catalog' ? [] : ['current_surface'],
    entityTypes: fallbackSemantics.entityTypes,
    capabilityKinds: fallbackSemantics.capabilityKinds,
    targetSurfaceId: input.snapshot.surface?.id ?? surfaceByDomain[fallbackDomain] ?? null,
    completionConditions: [
      input.primaryIntent === 'general'
        ? '给出无需工具的一般回答，或向用户提出一个最小澄清问题。'
        : '目标动作有结构化结果或明确的受阻说明。',
    ],
    uncertainties: input.primaryIntent === 'general' ? ['结构化 Planner 没有返回可用 Effect。'] : [],
    confidence: input.primaryIntent === 'general' ? 0.25 : 0.5,
    requiredEffects: [{
      effectId: `${input.primaryIntent}_effect`,
      effect: fallbackSemantics.effect,
      entityTypes: fallbackSemantics.entityTypes,
      propertyIds: [],
      minimumCount: 1,
      targetRefs: [],
      verificationRequired: input.primaryIntent === 'generate',
      actionGroupId: `${input.primaryIntent}_actions`,
    }],
  })])
}

export function taskGraphCoversBaseline(
  candidate: AgentTaskGraph,
  baseline: AgentTaskGraph,
): boolean {
  const candidateEffects = candidate.facets.flatMap((facet) => facet.requiredEffects)
  const coversEffects = baseline.facets.every((facet) => facet.requiredEffects.every((required) => {
    const matching = candidateEffects.filter((effect) => (
      effect.effect === required.effect
      && (required.entityTypes.length === 0 || effect.entityTypes.length === 0
        || required.entityTypes.some((entityType) => effect.entityTypes.includes(entityType)))
      && (required.propertyIds.length === 0 || effect.propertyIds.length === 0
        || required.propertyIds.every((propertyId) => effect.propertyIds.includes(propertyId)))
    ))
    return matching.reduce((count, effect) => count + effect.minimumCount, 0) >= required.minimumCount
  }))
  if (!coversEffects) return false
  const baselineRequiresConvergence = baseline.facets.some((facet) => (
    facet.dependsOn.length > 0
    && facet.requiredEffects.some((effect) => effect.effect === 'observe')
  ))
  if (!baselineRequiresConvergence) return true
  const writeFacetIds = candidate.facets.flatMap((facet) => (
    facet.requiredEffects.some((effect) => !['observe', 'navigate'].includes(effect.effect))
      ? [facet.facetId] : []
  ))
  const byId = new Map(candidate.facets.map((facet) => [facet.facetId, facet]))
  const dependsOn = (facetId: string, dependencyId: string, seen = new Set<string>()): boolean => {
    const facet = byId.get(facetId)
    if (!facet || seen.has(facetId)) return false
    if (facet.dependsOn.includes(dependencyId)) return true
    seen.add(facetId)
    return facet.dependsOn.some((id) => dependsOn(id, dependencyId, seen))
  }
  return candidate.facets.some((facet) => (
    facet.requiredEffects.some((effect) => effect.effect === 'observe')
    && writeFacetIds.every((id) => dependsOn(facet.facetId, id))
  ))
}

/** 只接受完整的结构化 Planner 输出；调用方可在失败时保留确定性任务图。 */
export function tryCreateModelTaskGraph(input: {
  goal: string
  rawFacets: unknown
  primaryIntent: AgentIntent
  candidateDomains: AgentToolDomain[]
  snapshot: HostContextSnapshot
}): AgentTaskGraph | null {
  const rawItems = Array.isArray(input.rawFacets) ? input.rawFacets.slice(0, AGENT_TASK_FACET_LIMIT) : []
  const parsed = rawItems.flatMap((item) => {
    const result = modelFacetSchema.safeParse(item)
    return result.success ? [result.data] : []
  })
  const allowedDomains = new Set(input.candidateDomains)
  const facets = parsed
    .filter((item) => allowedDomains.has(item.domain))
    .map((item) => buildFacet({
      ...item,
      entityTypes: item.targetEntityTypes,
      observationKinds: item.observationKinds,
      targetSurfaceId: item.targetSurfaceId ?? surfaceByDomain[item.domain] ?? null,
      requiredEffects: item.requiredEffects,
    }))
  if (facets.length === 0) return null
  const planned = graph(input.goal, ensureEarlyCameraSurface(facets))
  return input.candidateDomains.includes('camera_stage')
    && !cameraTaskGraphCoversGoal(input.goal, planned.facets)
    ? null
    : planned
}
