import type {
  AgentTaskCapabilityKind,
  AgentTaskFacet,
  AgentTaskRequiredEffect,
} from '../../../../../src/core/assistant/taskGraph'
import type { AgentToolDomain } from './types'
import { explicitlyCreatesProject } from './task-intent-semantics'

export interface DeterministicFacetInput {
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
  requiredEffects?: AgentTaskRequiredEffect[]
  uncertainties?: string[]
  confidence?: number
}

interface CameraGoalRequirements {
  createsProject: boolean
  sceneMutation: boolean
  motion: boolean
  objectAnimation: boolean
  objectCount: number
  styledObjectCount: number
}

const primitivePattern = /(?:立方体|正方体|球体|圆柱体|圆锥体|棱锥|金字塔|圆环)/gi
const colorPattern = /(?:紫色|红色|蓝色|绿色|黄色|橙色|粉色|黑色|白色|灰色|青色|褐色|棕色|#[0-9a-f]{6})/gi

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

function analyzeCameraGoal(goal: string): CameraGoalRequirements {
  const normalized = goal.normalize('NFKC')
  const primitiveMentions = [...normalized.matchAll(primitivePattern)].length
  const objectCount = Math.min(256, Math.max(
    inferRequestedCount(normalized),
    primitiveMentions,
  ))
  const colorMentions = [...normalized.matchAll(colorPattern)].length
  return {
    createsProject: explicitlyCreatesProject(normalized),
    sceneMutation: /(?:添加|放|放置|摆放|创建).{0,20}(?:物体|对象|立方体|正方体|球体|圆柱体|圆锥体|棱锥|金字塔|圆环|摄像机|相机)|(?:位置|坐标|旋转|缩放)/i.test(normalized),
    motion: /(?:运镜|轨迹|环绕|围绕|绕着|旋转|转圈|推拉|推近|拉远|横移|升降|orbit|dolly|truck|crane)/i.test(normalized),
    objectAnimation: /(?:动画|关键帧|漂浮|浮动|上下移动|起伏|摆动|自转|缩放动画|animate|keyframe|float)/i.test(normalized),
    objectCount,
    styledObjectCount: colorMentions > 0 ? Math.min(objectCount, colorMentions) : 0,
  }
}

function effect(
  effectId: string,
  kind: AgentTaskRequiredEffect['effect'],
  entityTypes: string[],
  minimumCount: number,
  actionGroupId: string,
  verificationRequired: boolean,
): AgentTaskRequiredEffect {
  return {
    effectId,
    effect: kind,
    entityTypes,
    propertyIds: [],
    minimumCount,
    targetRefs: [],
    verificationRequired,
    actionGroupId,
  }
}

export function buildDeterministicCameraFacets(
  goal: string,
  buildFacet: (input: DeterministicFacetInput) => AgentTaskFacet,
  includeNavigation: boolean,
): AgentTaskFacet[] {
  const requirements = analyzeCameraGoal(goal)
  const facets: AgentTaskFacet[] = []
  const projectEffect = requirements.createsProject
    ? effect('camera_project_effect', 'create', ['camera_stage.project'], 1, 'camera_project_actions', true)
    : effect('camera_project_effect', 'observe', ['camera_stage.project', 'camera_stage.camera'], 1, 'camera_project_actions', false)
  facets.push(buildFacet({
    facetId: 'camera_project',
    domain: 'camera_stage',
    goal: requirements.createsProject
      ? '创建用户明确要求的新三维工程，并取得工程、默认摄像机和镜头的稳定引用。'
      : '观察现有三维工程、默认摄像机和镜头，优先复用满足要求的对象。',
    observationKinds: ['entity_state', 'entity_schema', 'operation_schema'],
    capabilityKinds: ['observe', 'query', 'plan', 'mutate'],
    completionConditions: [requirements.createsProject
      ? '新工程已创建并通过结构化读取确认，返回工程、默认摄像机和镜头引用及 revision。'
      : '取得可用三维工程、摄像机和镜头的稳定引用与 revision。'],
    requiredEffects: [projectEffect],
  }))

  const needsEarlySurface = requirements.sceneMutation || requirements.motion || includeNavigation
  if (needsEarlySurface) {
    facets.push(buildFacet({
      facetId: 'show_target_surface',
      domain: 'navigation',
      goal: '取得稳定工程引用后立即打开 3D 编辑器，让用户看到后续场景执行。',
      observationKinds: ['current_surface'],
      capabilityKinds: ['observe', 'navigate'],
      targetSurfaceId: 'tool.camera_stage',
      dependsOn: ['camera_project'],
      parallelizable: false,
      completionConditions: ['宿主返回实际打开的 tool.camera_stage Surface ID。'],
    }))
  }

  const visualDependency = needsEarlySurface ? 'show_target_surface' : 'camera_project'
  if (requirements.sceneMutation) {
    const sceneEffects = [
      effect('camera_scene_place_effect', 'execute', ['camera_stage.object'], requirements.objectCount, 'camera_scene_actions', true),
      ...(requirements.styledObjectCount > 0
        ? [effect('camera_scene_style_effect', 'update', ['camera_stage.object'], requirements.styledObjectCount, 'camera_scene_actions', true)]
        : []),
    ]
    facets.push(buildFacet({
      facetId: 'camera_scene',
      domain: 'camera_stage',
      goal: '按明确空间参数布置三维场景对象，并完成用户指定的颜色等对象属性，避免对象重叠。',
      observationKinds: ['entity_state', 'entity_schema', 'operation_schema'],
      capabilityKinds: ['observe', 'plan', 'mutate', 'execute'],
      dependsOn: [visualDependency],
      completionConditions: ['目标对象及其指定属性存在、空间参数可验证且没有无意重叠。'],
      requiredEffects: sceneEffects,
    }))
  }

  if (requirements.motion) {
    facets.push(buildFacet({
      facetId: 'camera_motion',
      domain: 'camera_stage',
      goal: '使用已注册的摄像机运镜或轨迹语义完成镜头运动。',
      observationKinds: ['entity_state', 'operation_schema'],
      capabilityKinds: ['observe', 'plan', 'execute'],
      dependsOn: [requirements.sceneMutation ? 'camera_scene' : visualDependency],
      completionConditions: ['镜头轨迹或运镜参数已提交并可由场景状态验证。'],
      requiredEffects: [effect('camera_motion_effect', 'execute', ['camera_stage.trajectory'], 1, 'camera_motion_actions', true)],
    }))
  }

  if (requirements.objectAnimation) {
    facets.push(buildFacet({
      facetId: 'camera_object_animation',
      domain: 'camera_stage',
      goal: '给场景对象写入属性关键帧，表达漂浮、旋转、缩放等自身动画。',
      observationKinds: ['entity_state', 'entity_schema'],
      capabilityKinds: ['observe', 'plan', 'mutate'],
      dependsOn: [requirements.sceneMutation ? 'camera_scene' : visualDependency],
      completionConditions: ['目标对象在相应属性路径上已存在覆盖所需时长的关键帧。'],
      requiredEffects: [effect('camera_animation_effect', 'create', ['camera_stage.keyframe'], 1, 'camera_animation_actions', true)],
    }))
  }

  const verificationDependencies = [
    ...(requirements.sceneMutation ? ['camera_scene'] : []),
    ...(requirements.motion ? ['camera_motion'] : []),
    ...(requirements.objectAnimation ? ['camera_object_animation'] : []),
  ]
  if (verificationDependencies.length > 0) {
    facets.push(buildFacet({
      facetId: 'camera_verify',
      domain: 'camera_stage',
      goal: '用结构化验证确认对象属性、位置、尺寸、无重叠、运镜和对象动画结果；可用时再结合截图判断构图。',
      observationKinds: ['entity_state', 'current_surface'],
      capabilityKinds: ['observe'],
      targetSurfaceId: 'tool.camera_stage',
      dependsOn: verificationDependencies,
      parallelizable: false,
      completionConditions: [
        '结构化验证返回 verified 或已如实列出未满足项。',
        '视觉证据要么来自实际读取的界面截图，要么明确标注为未做视觉验证。',
      ],
      requiredEffects: [effect(
        'camera_verify_effect',
        'observe',
        ['camera_stage.scene', 'camera_stage.object', 'camera_stage.trajectory', 'camera_stage.keyframe'],
        1,
        'camera_verify_actions',
        false,
      )],
    }))
  }
  return facets
}

function requiredEffectExists(
  facets: AgentTaskFacet[],
  kind: AgentTaskRequiredEffect['effect'],
  entityType: string,
  minimumCount = 1,
): boolean {
  return facets.some((facet) => facet.requiredEffects.some((required) => (
    required.effect === kind
    && required.entityTypes.includes(entityType)
    && required.minimumCount >= minimumCount
  )))
}

function dependsTransitively(
  facet: AgentTaskFacet,
  dependencyId: string,
  byId: Map<string, AgentTaskFacet>,
  seen = new Set<string>(),
): boolean {
  if (facet.dependsOn.includes(dependencyId)) return true
  if (seen.has(facet.facetId)) return false
  seen.add(facet.facetId)
  return facet.dependsOn.some((id) => {
    const dependency = byId.get(id)
    return dependency ? dependsTransitively(dependency, dependencyId, byId, seen) : false
  })
}

export function cameraTaskGraphCoversGoal(goal: string, facets: AgentTaskFacet[]): boolean {
  const requirements = analyzeCameraGoal(goal)
  if (requirements.createsProject
    && !requiredEffectExists(facets, 'create', 'camera_stage.project')) return false
  if (requirements.sceneMutation
    && !requiredEffectExists(facets, 'execute', 'camera_stage.object', requirements.objectCount)) return false
  if (requirements.styledObjectCount > 0
    && !requiredEffectExists(facets, 'update', 'camera_stage.object', requirements.styledObjectCount)) return false
  if (requirements.motion
    && !requiredEffectExists(facets, 'execute', 'camera_stage.trajectory')) return false
  if (requirements.objectAnimation
    && !requiredEffectExists(facets, 'create', 'camera_stage.keyframe')) return false

  const writeFacetIds = facets.flatMap((facet) => facet.requiredEffects.some((required) => (
    !['observe', 'navigate'].includes(required.effect)
    && required.entityTypes.some((entityType) => entityType.startsWith('camera_stage.'))
  )) ? [facet.facetId] : [])
  if (writeFacetIds.length === 0) return true
  const byId = new Map(facets.map((facet) => [facet.facetId, facet]))
  return facets.some((facet) => (
    facet.requiredEffects.some((required) => required.effect === 'observe'
      && required.entityTypes.some((entityType) => entityType.startsWith('camera_stage.')))
    && writeFacetIds.every((id) => dependsTransitively(facet, id, byId))
  ))
}
