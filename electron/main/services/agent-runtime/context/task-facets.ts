import { z } from 'zod'

import {
  AGENT_FACET_ENTITY_TYPE_LIMIT,
  AGENT_TASK_FACET_LIMIT,
} from '../../../../../src/core/assistant/taskGraph'
import type { HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import {
  AGENT_TASK_GRAPH_VERSION,
  agentTaskGraphSchema,
  type AgentTaskCapabilityKind,
  type AgentTaskFacet,
  type AgentTaskGraph,
} from '../../../../../src/core/assistant/taskGraph'
import {
  AGENT_TOOL_DOMAINS,
  type AgentIntent,
  type AgentToolDomain,
} from './types'

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

function buildFacet(input: {
  facetId: string
  domain: AgentToolDomain
  goal: string
  entityTypes?: string[]
  observationKinds?: Array<'current_surface' | 'entity_state' | 'entity_schema' | 'operation_schema'>
  capabilityKinds: AgentTaskCapabilityKind[]
  targetSurfaceId?: string | null
  dependsOn?: string[]
  parallelizable?: boolean
  completionConditions: string[]
  uncertainties?: string[]
  confidence?: number
}): AgentTaskFacet {
  const entityTypes = unique(input.entityTypes ?? entityTypesByDomain[input.domain] ?? [])
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
    targetSurfaceId: input.targetSurfaceId ?? surfaceByDomain[input.domain] ?? null,
    dependsOn: unique(input.dependsOn ?? []),
    parallelizable: input.parallelizable ?? false,
    completionConditions: unique(input.completionConditions),
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
  const hasNavigation = /(?:打开|进入|切换|展示|查看|定位|让我看到|open|show|navigate)/i.test(normalized)
  const hasProject = /(?:新建|创建|建立|复用|项目|工程|project)/i.test(normalized)
  const hasSceneMutation = /(?:添加|放置|摆放|创建).{0,20}(?:物体|对象|立方体|棱锥|摄像机|相机)|(?:位置|坐标|旋转|缩放)/i.test(normalized)
  // 词表必须覆盖自然说法。实测目标写的是"摄像机围绕着它旋转"，一个关键词都没命中，于是
  // 运镜 Facet 根本没进任务图——任务图漏掉的部分，助手永远不会做，还会宣布"完成"。
  const hasMotion = /(?:运镜|轨迹|环绕|围绕|绕着|旋转|转圈|推拉|推近|拉远|横移|升降|orbit|dolly|truck|crane)/i.test(normalized)
  // 对象动画和摄像机运镜是两件事：前者写对象自己的关键帧，后者算镜头轨迹。
  const hasObjectAnimation = /(?:动画|关键帧|漂浮|浮动|上下移动|起伏|摆动|自转|缩放动画|animate|keyframe|float)/i.test(normalized)
  const isComposite = [hasCamera, hasCanvas, hasNavigation, hasProject, hasSceneMutation, hasMotion]
    .filter(Boolean).length >= 2
  if (!isComposite || (!hasCamera && !hasCanvas)) return null

  const facets: AgentTaskFacet[] = []
  if (hasCanvas) {
    facets.push(buildFacet({
      facetId: 'canvas_structure',
      domain: 'canvas',
      goal: hasProject ? '观察并复用或创建目标画布项目，再完成节点结构要求。' : '完成目标画布结构要求。',
      observationKinds: ['entity_state', 'entity_schema', 'operation_schema'],
      capabilityKinds: ['observe', 'query', 'plan', 'mutate'],
      completionConditions: ['目标画布项目与节点结构存在，并返回项目或节点稳定引用及 revision。'],
    }))
  }
  if (hasCamera) {
    const projectFacetId = 'camera_project'
    facets.push(buildFacet({
      facetId: projectFacetId,
      domain: 'camera_stage',
      goal: '先观察现有三维工程、默认摄像机和镜头，优先复用满足要求的对象。',
      observationKinds: ['entity_state', 'entity_schema', 'operation_schema'],
      capabilityKinds: ['observe', 'query', 'plan', 'mutate'],
      completionConditions: ['取得可用三维工程、摄像机和镜头的稳定引用与 revision。'],
    }))
    const needsEarlySurface = hasSceneMutation || hasMotion || hasNavigation
    if (needsEarlySurface) {
      facets.push(buildFacet({
        facetId: 'show_target_surface',
        domain: 'navigation',
        goal: '取得稳定工程引用后立即打开 3D 编辑器，让用户看到后续场景执行。',
        observationKinds: ['current_surface'],
        capabilityKinds: ['observe', 'navigate'],
        targetSurfaceId: 'tool.camera_stage',
        dependsOn: [projectFacetId],
        parallelizable: false,
        completionConditions: ['宿主返回实际打开的 tool.camera_stage Surface ID。'],
      }))
    }
    const visualDependency = needsEarlySurface ? 'show_target_surface' : projectFacetId
    if (hasSceneMutation) {
      facets.push(buildFacet({
        facetId: 'camera_scene',
        domain: 'camera_stage',
        goal: '按明确空间参数布置三维场景对象，避免对象重叠。',
        observationKinds: ['entity_state', 'entity_schema', 'operation_schema'],
        capabilityKinds: ['observe', 'plan', 'mutate'],
        dependsOn: [visualDependency],
        completionConditions: ['目标对象存在、空间参数可验证且没有无意重叠。'],
      }))
    }
    if (hasMotion) {
      facets.push(buildFacet({
        facetId: 'camera_motion',
        domain: 'camera_stage',
        goal: '使用已注册的摄像机运镜或轨迹语义完成镜头运动。',
        observationKinds: ['entity_state', 'operation_schema'],
        capabilityKinds: ['observe', 'plan', 'execute'],
        dependsOn: [hasSceneMutation ? 'camera_scene' : visualDependency],
        completionConditions: ['镜头轨迹或运镜参数已提交并可由场景状态验证。'],
      }))
    }
    if (hasObjectAnimation) {
      facets.push(buildFacet({
        facetId: 'camera_object_animation',
        domain: 'camera_stage',
        goal: '给场景对象写入属性关键帧，表达漂浮、旋转、缩放等自身动画。',
        observationKinds: ['entity_state', 'entity_schema'],
        capabilityKinds: ['observe', 'plan', 'mutate'],
        dependsOn: [hasSceneMutation ? 'camera_scene' : visualDependency],
        completionConditions: ['目标对象在相应属性路径上已存在覆盖所需时长的关键帧。'],
      }))
    }
    // 写入之后必须独立结算一次验证：没有这个 Facet，模型放完对象就会直接宣称完成。
    // 视觉证据是可选加成——本轮没有观察工具（模型读不了图）时只做参数验证也算完成，
    // 但答复必须说明未看画面，这条由系统提示词约束。
    if (hasSceneMutation || hasMotion || hasObjectAnimation) {
      facets.push(buildFacet({
        facetId: 'camera_verify',
        domain: 'camera_stage',
        goal: '用结构化验证确认对象位置、尺寸、无重叠与运镜结果；界面观察工具可用时再结合截图判断构图。',
        observationKinds: ['entity_state', 'current_surface'],
        capabilityKinds: ['observe'],
        targetSurfaceId: 'tool.camera_stage',
        dependsOn: [hasObjectAnimation ? 'camera_object_animation' : hasMotion ? 'camera_motion' : 'camera_scene'],
        parallelizable: false,
        completionConditions: [
          '结构化验证返回 verified 或已如实列出未满足项。',
          '视觉证据要么来自实际读取的界面截图，要么明确标注为未做视觉验证。',
        ],
      }))
    }
  }
  if (hasNavigation && !hasCamera) {
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
      ...(hasCanvas ? ['canvas' as const] : []),
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
    }))
  if (facets.length > 0) return graph(input.goal, ensureEarlyCameraSurface(facets))

  const fallbackDomain = input.candidateDomains.find((domain) => domain !== 'catalog') ?? 'catalog'
  return graph(input.goal, [buildFacet({
    facetId: input.primaryIntent === 'general' ? 'clarify_goal' : input.primaryIntent,
    domain: fallbackDomain,
    goal: input.goal,
    observationKinds: fallbackDomain === 'catalog' ? [] : ['current_surface'],
    capabilityKinds: fallbackDomain === 'catalog' ? ['query'] : ['observe', 'query'],
    targetSurfaceId: input.snapshot.surface?.id ?? surfaceByDomain[fallbackDomain] ?? null,
    completionConditions: [
      input.primaryIntent === 'general'
        ? '给出无需工具的一般回答，或向用户提出一个最小澄清问题。'
        : '目标动作有结构化结果或明确的受阻说明。',
    ],
    uncertainties: input.primaryIntent === 'general' ? ['路由模型没有返回可用 Facet。'] : [],
    confidence: input.primaryIntent === 'general' ? 0.25 : 0.5,
  })])
}
