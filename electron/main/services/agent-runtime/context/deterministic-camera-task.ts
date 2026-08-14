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

/**
 * 只描述**哪些领域参与**，不描述"要做几个"。
 *
 * 这些布尔量是软信号：它们决定任务图有哪些 Facet，从而决定模型发现得到哪些能力。判错的
 * 代价是多烧一轮（模型重写一段覆盖缺失 Effect 的完整 Henji Script），不是运行卡死。
 *
 * 数量**不在这里推导**。判断"写了几个、对不对"的唯一权威是 Henji Script 解释器：
 * `HenjiScriptService.verifyEntityCall` 对每一次 create/update/remove 都从正式状态源读回
 * 逐属性比对，不符立即抛 `SCRIPT_VERIFICATION_FAILED` 并带 stepId。任务图再用正则猜一个
 * `minimumCount` 去卡同一件事，只是把一个确定的保证换成一个 118 条正则的猜测。
 */
interface CameraGoalRequirements {
  createsProject: boolean
  sceneMutation: boolean
  motion: boolean
  objectAnimation: boolean
  cameraStateAnimation: boolean
  playback: boolean
  /** 用户是否点名了对象外观。只决定"要不要有这条 Effect"，不决定"要几个"。 */
  stylesObject: boolean
}

const colorPattern = /(?:紫色|红色|蓝色|绿色|黄色|橙色|粉色|黑色|白色|灰色|青色|褐色|棕色|#[0-9a-f]{6})/i
const sceneObjectCreationPattern = /(?:添加|加入|加(?:入|上|个|一)|放置|摆放|放入|放个|放一(?:个|枚|座)?|创建).{0,20}(?:物体|对象|球|立方体|正方体|球体|圆柱体|圆锥体|棱锥|金字塔|圆环|摄像机|相机)/i
const sceneObjectMutationPattern = new RegExp(`${sceneObjectCreationPattern.source}|(?:位置|坐标|旋转|缩放)`, 'i')

function analyzeCameraGoal(goal: string): CameraGoalRequirements {
  const normalized = goal.normalize('NFKC')
  // “3D 运镜工程”是产品/工程类型名称，不是用户要求摄像机做运镜。把固定名词先剥掉，
  // 否则任何“新建一个 3D 运镜工程，再让球浮动”的任务都会凭空多出 camera_motion Facet，
  // 最终要求一个用户从未提出的 trajectory Effect，真实工作已完成也无法结算。
  const motionIntentText = normalized.replace(/(?:3d|三维)?\s*运镜工程/gi, '')
  const cameraNoun = '(?:摄像机|相机|镜头|camera)'
  const motionVerb = '(?:轨迹|环绕|围绕|绕着|转圈|推拉|推近|拉远|横移|升降|orbit|dolly|truck|crane)'
  // “球沿环形轨迹旋转”描述的是对象动画，不是摄像机运镜。除产品专有词“运镜”外，通用
  // 运动词必须和摄像机/相机/镜头在同一短语内绑定；不再根据“轨迹、旋转”凭空扩张任务图。
  const hasCameraMotion = /运镜/i.test(motionIntentText)
    || new RegExp(`${cameraNoun}.{0,24}${motionVerb}|${motionVerb}.{0,24}${cameraNoun}`, 'i').test(motionIntentText)
  const hasCameraStateAnimation = /(?:摄像机|相机|camera).{0,40}(?:位置|坐标|旋转|fov|视野角)|(?:位置|坐标|旋转|fov|视野角).{0,40}(?:摄像机|相机|camera)/i.test(normalized)
    && /(?:动画|关键帧|时间点|\d+(?:\.\d+)?\s*秒|逐步|渐变|变化|animate|keyframe)/i.test(normalized)
  const hasObjectAnimation = /(?:动画|关键帧|漂浮|浮动|上下移动|起伏|摆动|自转|缩放动画|animate|keyframe|float)/i.test(normalized)
    || (/(?:播放|循环|play|loop)/i.test(normalized)
      && /(?:物体|对象|球|立方体|正方体|圆柱体|圆锥体|棱锥|金字塔|圆环).{0,40}(?:轨迹|运动|旋转|缩放|转圈)/i.test(normalized))
  return {
    createsProject: explicitlyCreatesProject(normalized) || /(?:新建|创建|建立).{0,48}(?:(?:3d|三维)\s*)?场景(?!物体|对象|节点)/i.test(normalized),
    sceneMutation: sceneObjectMutationPattern.test(normalized),
    motion: hasCameraMotion,
    objectAnimation: hasObjectAnimation,
    cameraStateAnimation: hasCameraStateAnimation,
    playback: /(?:播放|预览动画|循环|play|preview|loop)/i.test(normalized),
    stylesObject: normalized.split(/[，。；;,.!?！？\n]/)
      .some((clause) => sceneObjectCreationPattern.test(clause) && colorPattern.test(clause)),
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

  const needsEarlySurface = includeNavigation
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
    /*
     * 阈值恒为 1：门禁只回答"这个领域到底有没有发生过一次经过正式验证的写入"。
     *
     * "写了几个、颜色对不对"由脚本解释器逐步读回校验（见 CameraGoalRequirements 注释），
     * 那份保证比计数强得多；"数量是不是用户要的"是语义判断，任何门禁都答不了——正则假装
     * 能答，代价是判错时真实工作已完成却无法结算。
     */
    const sceneEffects = [
      effect('camera_scene_place_effect', 'execute', ['camera_stage.object'], 1, 'camera_scene_actions', true),
      ...(requirements.stylesObject
        ? [effect('camera_scene_style_effect', 'update', ['camera_stage.object'], 1, 'camera_scene_actions', true)]
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
      goal: '在不同播放头时间写入对象属性，由应用自动记录完整状态关键帧，表达漂浮、旋转、缩放等动画。',
      entityTypes: ['camera_stage.object', 'camera_stage.state_keyframe', 'camera_stage.playback'],
      observationKinds: ['entity_state', 'entity_schema'],
      capabilityKinds: ['observe', 'plan', 'mutate'],
      dependsOn: [requirements.sceneMutation ? 'camera_scene' : visualDependency],
      completionConditions: ['目标对象在多个时间点的状态关键帧值不同，并覆盖所需时长。'],
      // 自动记录在空时间点会 create，在已有时间点会 update。用户要的是对象动画，不是“必须新建卡”。
      // 对象可动画属性写入在两种情况下都稳定产出 update，因此用它做任务账本主 Effect；
      // 后续结构化读取仍负责证明多个时间点的状态确实不同。
      requiredEffects: [
        effect('camera_animation_effect', 'update', ['camera_stage.object'], 1, 'camera_animation_actions', true),
        ...(requirements.cameraStateAnimation ? [effect(
          'camera_state_animation_effect', 'update', ['camera_stage.camera'], 1,
          'camera_animation_actions', true,
        )] : []),
      ],
    }))
  }

  if (requirements.playback) {
    const playbackDependency = requirements.objectAnimation
      ? 'camera_object_animation'
      : requirements.motion
        ? 'camera_motion'
        : requirements.sceneMutation
          ? 'camera_scene'
          : visualDependency
    const playbackEffect = effect(
      'camera_playback_effect', 'update', ['camera_stage.playback'], 1,
      'camera_playback_actions', true,
    )
    playbackEffect.propertyIds = ['camera_stage.playback.playing']
    facets.push(buildFacet({
      facetId: 'camera_playback',
      domain: 'camera_stage',
      goal: '在动画状态写入并验证后启动播放；需要循环时同时开启循环。',
      entityTypes: ['camera_stage.playback'],
      observationKinds: ['entity_state', 'entity_schema'],
      capabilityKinds: ['observe', 'plan', 'mutate'],
      dependsOn: [playbackDependency],
      completionConditions: ['播放状态已写入并从正式播放控制实体读回。'],
      requiredEffects: [playbackEffect],
    }))
  }

  const verificationDependencies = [
    ...(requirements.sceneMutation ? ['camera_scene'] : []),
    ...(requirements.motion ? ['camera_motion'] : []),
    ...(requirements.objectAnimation ? ['camera_object_animation'] : []),
    ...(requirements.playback ? ['camera_playback'] : []),
  ]
  if (verificationDependencies.length > 0) {
    facets.push(buildFacet({
      facetId: 'camera_verify',
      domain: 'camera_stage',
      goal: '用一次结构化验证确认对象属性、位置、尺寸、无重叠、全部预期时间点的状态采样和播放状态；可用时再结合截图判断构图。',
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
        [
          'camera_stage.scene', 'camera_stage.object', 'camera_stage.camera',
          ...(requirements.motion ? ['camera_stage.trajectory'] : []),
          'camera_stage.state_keyframe',
        ],
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
): boolean {
  return facets.some((facet) => facet.requiredEffects.some((required) => (
    required.effect === kind
    && required.entityTypes.includes(entityType)
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
    && !requiredEffectExists(facets, 'execute', 'camera_stage.object')) return false
  if (requirements.stylesObject
    && !requiredEffectExists(facets, 'update', 'camera_stage.object')) return false
  if (requirements.motion
    && !requiredEffectExists(facets, 'execute', 'camera_stage.trajectory')) return false
  if (requirements.objectAnimation
    && !requiredEffectExists(facets, 'update', 'camera_stage.object')) return false
  if (requirements.cameraStateAnimation
    && !requiredEffectExists(facets, 'update', 'camera_stage.camera')) return false
  if (requirements.playback
    && !requiredEffectExists(facets, 'update', 'camera_stage.playback')) return false

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
