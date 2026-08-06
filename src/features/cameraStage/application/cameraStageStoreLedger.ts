import type { ApplicationStoreActionBinding, ApplicationStoreActionLedger } from '@/core/application-control'

import type { useCameraStageStore } from '../store/cameraStageStore'
import { CAMERA_STAGE_ENTITY_TYPES as ENTITY } from './cameraStageReflection'

/*
 * 三维运镜的界面动作账本。
 *
 * 建这份账的过程本身就是逐条回答「这件事助手能不能做」。此前这个问题只能靠人记忆回答，
 * 于是场景外观 24 项界面能改、助手一项看不到，一直到用户实测才发现。
 *
 * `gap` 那一档是本次盘出来的真实缺口——不是"有意只读"，是确实还没做。它是个棘轮：
 * 汇总门禁盯住总数不许涨，各期补齐把它往下烧。
 */

type State = ReturnType<typeof useCameraStageStore.getState>
type ActionName = {
  [K in keyof State]-?: State[K] extends (...args: never[]) => unknown ? K : never
}[keyof State]

function sceneProperty(suffix: string): ApplicationStoreActionBinding {
  return { kind: 'property', propertyIds: [`${ENTITY.scene}.${suffix}`] }
}

function shotProperty(...suffixes: [string, ...string[]]): ApplicationStoreActionBinding {
  return {
    kind: 'property',
    propertyIds: suffixes.map((suffix) => `${ENTITY.shot}.${suffix}`) as [string, ...string[]],
  }
}

const OBJECT_TRANSFORM = [
  `${ENTITY.object}.transform.position`,
  `${ENTITY.object}.transform.rotation`,
  `${ENTITY.object}.transform.scale`,
] as [string, string, string]

const SELECTION_REASON = '选中态是鼠标操作的中间产物；助手用稳定引用直接寻址目标，不需要先选中，'
  + '而且改写选中态会与用户当前正在进行的操作打架。'

export const CAMERA_STAGE_STORE_LEDGER: ApplicationStoreActionLedger<ActionName> = {
  storeId: 'cameraStage',
  title: '三维运镜',
  entries: {
    /* ── 对象增删改 ─────────────────────────────────────────── */
    addPrimitive: { kind: 'capability', capabilityId: 'place_camera_stage_object' },
    addCharacter: { kind: 'capability', capabilityId: 'place_camera_stage_object' },
    addCamera: { kind: 'capability', capabilityId: 'place_camera_stage_object' },
    duplicateObject: { kind: 'capability', capabilityId: 'duplicate_camera_stage_object' },
    removeObject: { kind: 'capability', capabilityId: 'delete_camera_stage_object' },
    updateObject: {
      kind: 'property',
      propertyIds: [`${ENTITY.object}.name`, `${ENTITY.object}.visible`, `${ENTITY.object}.color`, `${ENTITY.object}.character_variant`],
    },
    updateObjectAcrossShots: {
      kind: 'property',
      propertyIds: [`${ENTITY.object}.name`, `${ENTITY.object}.visible`, `${ENTITY.object}.color`, `${ENTITY.object}.character_variant`],
    },
    updateTransform: { kind: 'property', propertyIds: OBJECT_TRANSFORM },
    updateCameraView: {
      kind: 'property',
      propertyIds: [`${ENTITY.camera}.transform.position`, `${ENTITY.camera}.transform.rotation`, `${ENTITY.camera}.look_at_target`],
    },

    /* ── 角色姿态 ───────────────────────────────────────────── */
    updatePoseJoint: {
      kind: 'gap',
      plannedPhase: '期 2',
      reason: '角色 15 个关节的欧拉偏移在反射层是 animatable.* 只读属性，助手只能建关键帧、'
        + '不能直接摆姿势。放开前要先定"直接写值遇上已有关键帧"的语义，否则播放头一动值就被插值覆盖。',
    },
    applyPosePreset: {
      kind: 'gap',
      plannedPhase: '期 2',
      reason: '一键预设姿势整体替换姿态，与 updatePoseJoint 同属姿态写入，缺同一个入口。',
    },

    /* ── 场景外观（界面 25 项，逐项对上）─────────────────────── */
    setSceneSkyColor: sceneProperty('sky_color'),
    setSceneGroundColor: sceneProperty('ground_color'),
    setSceneGroundPattern: sceneProperty('ground_pattern'),
    setSceneGroundDensity: sceneProperty('ground_density'),
    setSceneGroundGridLineColor: sceneProperty('ground_grid_line_color'),
    setSceneGroundGridLineThickness: sceneProperty('ground_grid_line_thickness'),
    setSceneGroundCheckerLightColor: sceneProperty('ground_checker_light_color'),
    setSceneGroundCheckerDarkColor: sceneProperty('ground_checker_dark_color'),
    setSceneSunlightEnabled: sceneProperty('sunlight_enabled'),
    setSceneSunlightIntensity: sceneProperty('sunlight_intensity'),
    setSceneSunlightTimeOfDay: sceneProperty('sunlight_time_of_day'),
    setSceneFogEnabled: sceneProperty('fog_enabled'),
    setSceneFogDistance: sceneProperty('fog_distance'),
    setSceneShowNameLabels: sceneProperty('show_name_labels'),
    setSceneNameLabelScale: sceneProperty('name_label_scale'),
    setSceneNameLabelOffset: sceneProperty('name_label_offset'),
    setSceneNameLabelTextColor: sceneProperty('name_label_text_color'),
    setSceneNameLabelFollowObjectColor: sceneProperty('name_label_follow_object_color'),
    setSceneNameLabelBackgroundColor: sceneProperty('name_label_background_color'),
    setSceneNameLabelBackgroundOpacity: sceneProperty('name_label_background_opacity'),
    setSceneNameLabelShadowColor: sceneProperty('name_label_shadow_color'),
    setSceneNameLabelShadowOpacity: sceneProperty('name_label_shadow_opacity'),
    setSceneNameLabelShadowBlur: sceneProperty('name_label_shadow_blur'),
    setSceneNameLabelShadowDistance: sceneProperty('name_label_shadow_distance'),
    setSceneNameLabelShadowAngle: sceneProperty('name_label_shadow_angle'),

    /* ── 时间轴与播放 ───────────────────────────────────────── */
    setDuration: sceneProperty('duration'),
    setFps: sceneProperty('fps'),
    setActiveCameraId: sceneProperty('active_camera_ref'),
    play: {
      kind: 'gap',
      plannedPhase: '期 2',
      reason: '播放控制完全没注册。助手做完动画后无法预览验证，只能让用户自己去点播放。'
        + '计划注册成 camera_stage.playback 单例实体的属性，不新增工具。',
    },
    pause: { kind: 'gap', plannedPhase: '期 2', reason: '同 play，属于未注册的播放控制这一组。' },
    stop: { kind: 'gap', plannedPhase: '期 2', reason: '同 play，属于未注册的播放控制这一组。' },
    seek: {
      kind: 'gap',
      plannedPhase: '期 2',
      reason: '跳转播放头是用户可达入口，也是助手按时间点检查画面的前提，目前完全没有对应属性。',
    },
    toggleLoop: { kind: 'gap', plannedPhase: '期 2', reason: '循环播放开关未注册，属于播放控制这一组。' },
    setPlaybackTime: {
      kind: 'excluded',
      category: 'derived',
      reason: '由 play 的播放循环与 seek 写入，本身不是用户入口；用户可达的入口是 seek，'
        + '助手要跳转时间点用 seek 对应的属性即可。',
    },

    /* ── 镜头卡 ─────────────────────────────────────────────── */
    addShot: { kind: 'capability', capabilityId: 'add_camera_stage_shot' },
    updateShotName: shotProperty('name'),
    moveShotTime: shotProperty('time'),
    updateShotTiming: shotProperty('time', 'hold'),
    updateShotTransition: shotProperty('transition_duration'),
    updateShotContinuity: shotProperty('continuity'),
    updateShotCamera: shotProperty('camera_ref'),
    removeShot: {
      kind: 'gap',
      plannedPhase: '期 2',
      reason: '镜头卡没有声明 collectionWrite，助手能加不能删。计划补 collectionWrite 与集合执行器，'
        + '同时删掉专用能力 add_camera_stage_shot，避免同功能两条路。',
    },
    removeShots: { kind: 'gap', plannedPhase: '期 2', reason: '批量删除镜头卡，与 removeShot 同一个缺口。' },
    reorderShot: {
      kind: 'gap',
      plannedPhase: '期 2',
      reason: '重排镜头卡顺序没有对应入口；补 collectionWrite 时一并处理。',
    },
    captureIntoSelectedShot: {
      kind: 'gap',
      plannedPhase: '期 2',
      reason: '把当前对象状态记录进选中的镜头卡，是简易模式的核心动作，助手没有对应入口。',
    },

    /* ── 关键帧 ─────────────────────────────────────────────── */
    keyframeAtCurrentTime: { kind: 'collection', entityType: ENTITY.keyframe, operation: 'create' },
    toggleKeyframe: { kind: 'collection', entityType: ENTITY.keyframe, operation: 'create' },
    toggleKeyframeGroup: { kind: 'collection', entityType: ENTITY.keyframe, operation: 'create' },
    removeKeyframe: { kind: 'collection', entityType: ENTITY.keyframe, operation: 'remove' },
    moveKeyframe: { kind: 'property', propertyIds: [`${ENTITY.keyframe}.time`] },
    setKeyframeValue: { kind: 'property', propertyIds: [`${ENTITY.keyframe}.value`] },
    setKeyframesEasing: { kind: 'property', propertyIds: [`${ENTITY.keyframe}.easing`] },
    clearTrack: {
      kind: 'gap',
      plannedPhase: '期 2',
      reason: '清空整条动画轨道要能一次删掉该轨道上的全部关键帧，目前集合删除只支持逐条指定引用。',
    },

    /* ── 轨迹 ───────────────────────────────────────────────── */
    setShotSpatialPath: {
      kind: 'gap',
      plannedPhase: '期 2',
      reason: '空间轨迹整条曲线的写入。camera_stage.trajectory 目前整实体 writeExclusion，'
        + '要开放需要把控制点建成 trajectory.knot 子实体。',
    },
    setShotPathAnchor: {
      kind: 'gap',
      plannedPhase: '期 2',
      reason: '拖动轨迹端点控制点，与 setShotSpatialPath 同属轨迹编辑这一块缺口。',
    },
    applyCameraPathPreset: {
      kind: 'capability',
      capabilityId: 'apply_camera_stage_camera_move',
    },

    /* ── 工程与编辑模式 ─────────────────────────────────────── */
    newScene: { kind: 'capability', capabilityId: 'create_camera_stage_project' },
    setEditorMode: {
      kind: 'gap',
      plannedPhase: '期 2',
      reason: 'project.editor_mode 标着只读，理由「只能通过正式烘焙操作切换」只对简易→专业成立'
        + '（烘焙不可逆）；专业→简易与同模式内切换没有这个约束，助手却一并被挡住了。',
    },
    bakeToProMode: {
      kind: 'gap',
      plannedPhase: '期 2',
      reason: '烘焙成专业模式是不可逆操作，需要作为带审批的语义能力注册；界面上做得了的完整关键帧'
        + '编辑要先进专业模式，所以这一条挡住了助手做精细动画。',
    },
    bindProject: {
      kind: 'excluded',
      category: 'internal',
      reason: '保存或加载工程后由工程服务回填工程标识，不改动任何场景数据，不是用户在界面上的动作。',
    },
    loadSnapshot: {
      kind: 'excluded',
      category: 'internal',
      reason: '由工程加载链路整体重置场景，是 open_camera_stage_project 的内部步骤，不单独暴露。',
    },
    prepareSimpleEdit: {
      kind: 'excluded',
      category: 'internal',
      reason: '简易模式鼠标交互开始前冻结当前帧，避免首个变换增量触发插帧重编译；'
        + '是拖拽手势的内部步骤，助手的写入不经过手势。',
    },

    /* ── 选中与视图 ─────────────────────────────────────────── */
    setSelected: { kind: 'excluded', category: 'transient_selection', reason: SELECTION_REASON },
    selectShot: { kind: 'excluded', category: 'transient_selection', reason: SELECTION_REASON },
    setSelectedShotIds: { kind: 'excluded', category: 'transient_selection', reason: SELECTION_REASON },
    setSelectedShotIdOnly: { kind: 'excluded', category: 'transient_selection', reason: SELECTION_REASON },
    setSelectedKeyframes: { kind: 'excluded', category: 'transient_selection', reason: SELECTION_REASON },
    requestFocusSelected: { kind: 'capability', capabilityId: 'focus_application_entity' },
    setGizmoMode: {
      kind: 'excluded',
      category: 'view_state',
      reason: '手柄模式只决定用户下一次鼠标拖拽被解释成移动还是旋转，不写入工程文件也不影响出片；'
        + '助手改变换值直接写 camera_stage.object.transform.*，不经过手柄。',
    },
    setViewMode: {
      kind: 'excluded',
      category: 'view_state',
      reason: '导演视角与机位视角的切换只影响本机当前窗口看到的画面，不进工程文件；'
        + '助手要看某个机位的画面用 observe_camera_stage_scene 读结构化状态。',
    },
  },
}
