import { z } from 'zod'

import type { HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import {
  AGENT_FACET_ENTITY_TYPE_LIMIT,
  AGENT_TASK_FACET_LIMIT,
  AGENT_TASK_GRAPH_VERSION,
  agentTaskGraphSchema,
  deriveActionGroups,
  type AgentTaskFacet,
  type AgentTaskEffectKind,
  type AgentTaskGraph,
  type AgentTaskRequiredEffect,
} from '../../../../../src/core/assistant/taskGraph'
import { AGENT_TOOL_DOMAINS, type AgentIntent, type AgentToolDomain } from './types'
import {
  buildDeterministicCameraFacets,
  cameraTaskGraphCoversGoal,
  type DeterministicFacetInput,
} from './deterministic-camera-task'
import {
  asksToGenerateMedia,
  explicitlyCreatesProject,
  hasAffirmativeIntent,
  hasNegatedIntent,
  inferIntentTaskSemantics,
} from './task-intent-semantics'

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
  settings: ['settings.registry'],
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
    forbiddenEffects: inferForbiddenEffects(goal),
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

function inferForbiddenEffects(goal: string): AgentTaskEffectKind[] {
  const effects: AgentTaskEffectKind[] = []
  if (hasNegatedIntent(goal, /(?:打开|进入|切换|定位|聚焦|展示|open|navigate|switch|focus)/i)) {
    effects.push('navigate')
  }
  if (hasNegatedIntent(goal, /(?:删除|移除|清空|delete|remove)/i)) effects.push('delete')
  return effects
}

function ensureExplicitCameraSurface(goal: string, facets: AgentTaskFacet[]): AgentTaskFacet[] {
  const navigationRequested = hasAffirmativeIntent(
    goal,
    /(?:打开|进入|切换|展示|查看|定位|让我看到|open|show|navigate)/i,
  )
  if (!navigationRequested) {
    return facets.filter((facet) => !(
      facet.targetSurfaceId === 'tool.camera_stage'
      && facet.capabilityKinds.includes('navigate')
    ))
  }
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
  const hasCanvasTask = hasCanvas
    && /(?:节点|连线|流程图|画布项目|画布里|画布中|canvas\s*(?:node|edge|project)|布局)/i.test(normalized)
  const hasGeneration = hasCanvasTask && asksToGenerateMedia(normalized)
  const usesGenerationResult = hasCanvasTask
    && /(?:生成结果|生成的(?:图片|图像|照片|海报|插画|视频|音频)|generation\.result|generated\s+(?:result|image|media))/i.test(normalized)
  const hasNavigation = hasAffirmativeIntent(
    normalized,
    /(?:打开|进入|切换|展示|查看|定位|让我看到|open|show|navigate)/i,
  )
  const hasAssets = /(?:素材|素材库|素材集|asset\s*(?:library|collection)?)/i.test(normalized)
  const hasAssetLibrary = /(?:素材库|素材集|素材集合|asset\s*(?:library|collection))/i.test(normalized)
  const createsAssetLibrary = hasAssets && hasAffirmativeIntent(
    normalized,
    /(?:创建|新建|建立).{0,24}(?:素材库|素材集|素材集合|asset\s*(?:library|collection))|(?:素材库|素材集|素材集合).{0,16}(?:创建|新建|建立)/i,
  )
  const updatesAsset = hasAssets && hasAffirmativeIntent(
    normalized,
    /(?:重命名|改名|标签|归类|加入|添加到|放入|rename|tag|categorize)/i,
  )
  const updatesAssetLibrary = hasAssetLibrary && hasAffirmativeIntent(
    normalized,
    /(?:素材库|素材集|素材集合).{0,8}(?:重命名|改名)|(?:重命名|改名)(?:这个|该|上述|新建的)?(?:素材库|素材集|素材集合)|(?:将它|把它|这个集合|该集合|上述集合).{0,8}(?:重命名|改名)/i,
  )
  const deletesAsset = hasAssets && hasAffirmativeIntent(
    normalized,
    /(?:删除|永久删除|delete).{0,20}(?:素材|图片|视频|音频|asset)|(?:素材|图片|视频|音频|asset).{0,20}(?:删除|永久删除|delete)/i,
  )
  const deletesAssetLibrary = hasAssetLibrary && hasAffirmativeIntent(
    normalized,
    /(?:删除|移除)(?:这个|该|上述|新建的)?(?:素材库|素材集|素材集合)|(?:素材库|素材集|素材集合).{0,8}(?:删除|移除)|(?:然后删除|并删除|再删除|删除)(?:这个|该|上述)?集合/i,
  )
  const updatesConcreteAsset = updatesAsset && !updatesAssetLibrary
  const deletesConcreteAsset = deletesAsset && !deletesAssetLibrary
  const hasAssetTask = createsAssetLibrary || updatesConcreteAsset || deletesConcreteAsset
    || updatesAssetLibrary || deletesAssetLibrary
  if (!hasCamera && !hasCanvasTask && !hasAssetTask) return null

  const facets: AgentTaskFacet[] = []
  if (hasAssetTask) {
    const lookupEntityType = updatesConcreteAsset || deletesConcreteAsset ? 'asset' : 'asset.library'
    facets.push(buildFacet({
      facetId: 'asset_lookup', domain: 'assets',
      goal: '从正式素材状态源取得目标素材与现有素材库的完整稳定引用。',
      entityTypes: ['asset', 'asset.library'],
      observationKinds: ['entity_state', 'entity_schema'],
      capabilityKinds: ['observe', 'query'],
      completionConditions: ['目标素材与素材库引用已从正式状态源读得，不使用截断或猜测 ID。'],
      requiredEffects: [{
        effectId: 'asset_lookup_effect', effect: 'observe', entityTypes: [lookupEntityType],
        propertyIds: [], minimumCount: 1, targetRefs: [], verificationRequired: false,
        actionGroupId: 'asset_lookup_actions',
      }],
    }))
    if (createsAssetLibrary) facets.push(buildFacet({
      facetId: 'asset_library_create', domain: 'assets',
      goal: '创建用户明确要求的新素材库，并取得完整稳定引用。',
      entityTypes: ['asset.library'],
      observationKinds: ['entity_state', 'entity_schema'],
      capabilityKinds: ['observe', 'plan', 'mutate'],
      dependsOn: ['asset_lookup'],
      completionConditions: ['新素材库已创建并可从正式状态源读回。'],
      requiredEffects: [{
        effectId: 'asset_library_create_effect', effect: 'create', entityTypes: ['asset.library'],
        propertyIds: [], minimumCount: 1, targetRefs: [], verificationRequired: !deletesAssetLibrary,
        actionGroupId: 'asset_library_create_actions',
      }],
    }))
    if (updatesConcreteAsset) facets.push(buildFacet({
      facetId: 'asset_update', domain: 'assets',
      goal: '完成素材重命名、标签或素材库归类等用户明确要求的属性更新。',
      entityTypes: ['asset'],
      observationKinds: ['entity_state', 'entity_schema'],
      capabilityKinds: ['observe', 'plan', 'mutate'],
      dependsOn: ['asset_lookup', ...(createsAssetLibrary ? ['asset_library_create'] : [])],
      completionConditions: ['素材全部目标属性已经从正式状态源读回。'],
      requiredEffects: [{
        effectId: 'asset_update_effect', effect: 'update', entityTypes: ['asset'],
        propertyIds: [], minimumCount: 1, targetRefs: [], verificationRequired: true,
        actionGroupId: 'asset_update_actions',
      }],
    }))
    if (updatesAssetLibrary) facets.push(buildFacet({
      facetId: 'asset_library_update', domain: 'assets',
      goal: '完成用户明确要求的素材库重命名。',
      entityTypes: ['asset.library'],
      observationKinds: ['entity_state', 'entity_schema'],
      capabilityKinds: ['observe', 'plan', 'mutate'],
      dependsOn: ['asset_lookup', ...(createsAssetLibrary ? ['asset_library_create'] : [])],
      completionConditions: ['素材库重命名已由正式写入回执确认。'],
      requiredEffects: [{
        effectId: 'asset_library_update_effect', effect: 'update', entityTypes: ['asset.library'],
        propertyIds: ['asset.library.name'], minimumCount: 1, targetRefs: [],
        verificationRequired: !deletesAssetLibrary,
        actionGroupId: 'asset_library_update_actions',
      }],
    }))
    if (deletesConcreteAsset) facets.push(buildFacet({
      facetId: 'asset_delete', domain: 'assets',
      goal: '删除用户明确指定的素材，并验证目标实体不再存在。',
      entityTypes: ['asset'],
      observationKinds: ['entity_state'],
      capabilityKinds: ['observe', 'plan', 'mutate'],
      dependsOn: ['asset_lookup'],
      completionConditions: ['正式状态源确认目标素材已删除。'],
      requiredEffects: [{
        effectId: 'asset_delete_effect', effect: 'delete', entityTypes: ['asset'],
        propertyIds: [], minimumCount: 1, targetRefs: [], verificationRequired: true,
        actionGroupId: 'asset_delete_actions',
      }],
    }))
    if (deletesAssetLibrary) facets.push(buildFacet({
      facetId: 'asset_library_delete', domain: 'assets',
      goal: '删除用户明确指定的素材库，并验证目标实体不再存在。',
      entityTypes: ['asset.library'],
      observationKinds: ['entity_state'],
      capabilityKinds: ['observe', 'plan', 'mutate'],
      dependsOn: [
        'asset_lookup',
        ...(createsAssetLibrary ? ['asset_library_create'] : []),
        ...(updatesAssetLibrary ? ['asset_library_update'] : []),
      ],
      completionConditions: ['正式状态源确认目标素材库已删除。'],
      requiredEffects: [{
        effectId: 'asset_library_delete_effect', effect: 'delete', entityTypes: ['asset.library'],
        propertyIds: [], minimumCount: 1, targetRefs: [], verificationRequired: true,
        actionGroupId: 'asset_library_delete_actions',
      }],
    }))
    facets.push(buildFacet({
      facetId: 'asset_verify', domain: 'assets',
      goal: '从正式素材状态源汇合验证素材及素材库的最终状态。',
      entityTypes: ['asset', 'asset.library'],
      observationKinds: ['entity_state'],
      capabilityKinds: ['observe', 'query'],
      dependsOn: [
        ...(createsAssetLibrary ? ['asset_library_create'] : []),
        ...(updatesConcreteAsset ? ['asset_update'] : []),
        ...(deletesConcreteAsset ? ['asset_delete'] : []),
        ...(updatesAssetLibrary ? ['asset_library_update'] : []),
        ...(deletesAssetLibrary ? ['asset_library_delete'] : []),
      ],
      completionConditions: ['所有要求的素材变化都有结构化读回证据，且没有执行被否定的动作。'],
      requiredEffects: [{
        effectId: 'asset_verify_effect', effect: 'observe', entityTypes: ['asset', 'asset.library'],
        propertyIds: [], minimumCount: 1, targetRefs: [], verificationRequired: false,
        actionGroupId: 'asset_verify_actions',
      }],
    }))
  }
  if (hasGeneration) facets.push(buildFacet({
    facetId: 'generation_result', domain: 'generation',
    goal: '提交用户要求的媒体生成，并在外部任务续接后从正式状态源确认成功结果与稳定 generation.result 引用。',
    entityTypes: ['generation.task', 'generation.result'],
    observationKinds: ['entity_state', 'operation_schema'],
    capabilityKinds: ['observe', 'query', 'execute'],
    completionConditions: ['生成任务达到正式成功终态，并返回可供后续步骤使用的完整 generation.result 引用。'],
    requiredEffects: [{
      effectId: 'generation_result_effect', effect: 'execute', entityTypes: ['generation.task'],
      propertyIds: [], minimumCount: 1, targetRefs: [], verificationRequired: true,
      actionGroupId: 'generation_result_actions',
    }],
  }))
  // 跨域“生成后放入画布”的画布侧事实永远是创建媒体源节点。不能让前半句的“生成”把
  // canvas 语义污染成 execute，也不能要求用户额外说出实现词“节点”。
  const canvasSemantics = hasCanvasTask
    ? hasGeneration || usesGenerationResult
      ? {
          effect: 'create' as const,
          entityTypes: ['canvas.node'],
          capabilityKinds: ['observe', 'query', 'plan', 'mutate'] as const,
        }
      : inferIntentTaskSemantics('canvas', normalized)
    : null
  let canvasNeedsVerification = false
  let canvasWriteFacetId = 'canvas_structure'
  if (hasCanvasTask) {
    const createsCanvasProject = explicitlyCreatesProject(normalized) || hasAffirmativeIntent(
      normalized,
      /(?:新建|创建|建立).{0,36}画布(?![^，。；;,.!?！？\n]{0,16}(?:节点|node))/i,
    )
    const explicitlyCreatesCanvasNode = hasAffirmativeIntent(
      normalized,
      /(?:创建|添加|新建|放置|摆放).{0,24}(?:节点|node)|(?:节点|node).{0,16}(?:创建|添加|新建|放置|摆放)/i,
    )
    const createsAdditionalCanvasNode = hasGeneration && hasAffirmativeIntent(
      normalized,
      /(?:(?:再|另|另外|额外|同时|并且).{0,12})?(?:创建|添加|新建|放置|摆放).{0,24}(?:文本|文字|说明|注释|输入|输出|处理)(?:.{0,8})(?:节点|node)|(?:再|另|另外|额外).{0,12}(?:创建|添加|新建|放置|摆放).{0,24}(?:节点|node)/i,
    )
    const targetsNode = hasGeneration || usesGenerationResult || /(?:节点|连线|node|edge)/i.test(normalized)
    // “生成媒体并放入画布”使用固定的媒体源节点，节点类型已由验证过的跨域 Recipe
    // 封装，不应再制造一个必须由模型单独查询的目录 Facet。只有用户另外要求创建其他
    // 类型节点时，才需要节点目录发现。
    const needsCanvasNodeCatalog = targetsNode && canvasSemantics?.effect === 'create'
      && (hasGeneration ? createsAdditionalCanvasNode : (!usesGenerationResult || explicitlyCreatesCanvasNode))
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
    if (needsCanvasNodeCatalog) facets.push(buildFacet({
      facetId: 'canvas_node_catalog', domain: 'canvas',
      goal: '搜索允许创建的画布节点类型，并读取所选节点类型的正式结构。',
      entityTypes: ['canvas.node_type'],
      observationKinds: ['entity_schema', 'operation_schema'],
      capabilityKinds: ['observe', 'query'],
      completionConditions: ['已从正式目录取得节点类型稳定引用，并读取对应输入输出端口结构。'],
      requiredEffects: [{
        effectId: 'canvas_node_catalog_effect', effect: 'observe', entityTypes: ['canvas.node_type'],
        propertyIds: [], minimumCount: 2, targetRefs: [], verificationRequired: false,
        actionGroupId: 'canvas_node_catalog_actions',
      }],
    }))
    if (!createsCanvasProject || targetsNode) {
      const semantics = canvasSemantics as ReturnType<typeof inferIntentTaskSemantics>
      const facetId = targetsNode
        ? usesGenerationResult ? 'canvas_generation_result' : 'canvas_structure'
        : 'canvas_project'
      canvasWriteFacetId = facetId
      facets.push(buildFacet({
        facetId, domain: 'canvas',
        goal: targetsNode ? '完成用户要求的画布节点和连线结构。' : '完成用户要求的画布项目操作。',
        entityTypes: connectsNodes
          ? unique([...semantics.entityTypes, 'canvas.edge'])
          : semantics.entityTypes,
        observationKinds: ['entity_state', 'entity_schema', 'operation_schema'],
        capabilityKinds: semantics.capabilityKinds,
        dependsOn: [
          ...(createsCanvasProject ? ['canvas_project'] : []),
          ...(needsCanvasNodeCatalog ? ['canvas_node_catalog'] : []),
          ...(hasGeneration ? ['generation_result'] : []),
        ],
        completionConditions: ['目标画布项目或节点结构具有稳定引用、revision 和结构化结果。'],
        requiredEffects: [{
          effectId: `${facetId}_effect`, effect: semantics.effect,
          entityTypes: semantics.entityTypes, propertyIds: [],
          // 阈值恒为 1，理由同 deterministic-camera-task.ts：数量由脚本解释器逐步读回校验，
          // 不由正则从中文句子里猜。原先这里还有一条“提到文本节点且有生成就要求 2 个”的
          // 特判——那正是按单个提示词打补丁，删掉。
          minimumCount: 1,
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
    dependsOn: [canvasWriteFacetId], parallelizable: false,
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
      ...(hasGeneration ? ['generate' as const] : []),
      ...(hasAssetTask ? ['assets' as const] : []),
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
  const planned = graph(input.goal, ensureExplicitCameraSurface(input.goal, facets))
  return input.candidateDomains.includes('camera_stage')
    && !cameraTaskGraphCoversGoal(input.goal, planned.facets)
    ? null
    : planned
}
