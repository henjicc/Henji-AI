import { fieldLedgerEntries, type ApplicationStoreActionLedger } from '@/core/application-control'

import type { useCameraStageStore } from '../store/cameraStageStore'
import { CAMERA_FIELDS, OBJECT_FIELDS } from './cameraStageObjectFields'
import { CAMERA_STAGE_ENTITY_TYPES as ENTITY } from './cameraStageReflection'
import { SCENE_APPEARANCE_FIELDS, SCENE_TIMELINE_FIELDS } from './cameraStageSceneFields'
import { KEYFRAME_FIELDS, PLAYBACK_FIELDS, SHOT_FIELDS } from './cameraStageTimelineFields'

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
    /*
     * updateObject/updateObjectAcrossShots/updateTransform（object 域）与 updateCameraView
     * （camera 域）定义收敛在 cameraStageObjectFields.ts，账本条目从 storeActions 派生。
     */
    ...fieldLedgerEntries(OBJECT_FIELDS),
    ...fieldLedgerEntries(CAMERA_FIELDS),

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

    /*
     * ── 场景外观（25 项）与时间轴（3 项）─────────────────────
     * 定义收敛在 cameraStageSceneFields.ts，账本条目从 storeActions 派生，不再逐条手写。
     */
    ...fieldLedgerEntries(SCENE_APPEARANCE_FIELDS),
    ...fieldLedgerEntries(SCENE_TIMELINE_FIELDS),

    /* ── 播放 ───────────────────────────────────────────────── */
    // 播放控制注册成 camera_stage.playback 单例实体的三条属性，零新增工具。
    // 助手做完动画能自己预览验证，而不是让用户去点播放。定义收敛在 cameraStageTimelineFields.ts。
    ...fieldLedgerEntries(PLAYBACK_FIELDS),
    setPlaybackTime: {
      kind: 'excluded',
      category: 'derived',
      reason: '由 play 的播放循环与 seek 写入，本身不是用户入口；用户可达的入口是 seek，'
        + '助手要跳转时间点用 seek 对应的属性即可。',
    },

    /* ── 镜头卡 ─────────────────────────────────────────────── */
    // 增删接到集合写入（2.1）：专用能力 add_camera_stage_shot 已删除，避免同功能两条路。
    addShot: { kind: 'collection', entityType: ENTITY.shot, operation: 'create' },
    removeShot: { kind: 'collection', entityType: ENTITY.shot, operation: 'remove' },
    removeShots: { kind: 'collection', entityType: ENTITY.shot, operation: 'remove' },
    // 定义收敛在 cameraStageTimelineFields.ts；time 被 moveShotTime 与 updateShotTiming 共用。
    ...fieldLedgerEntries(SHOT_FIELDS),
    /*
     * 重排顺序完全由 time 决定：reorderShot 内部把移动后各位置重新赋以排序后的 time 值，
     * 结果与"直接把目标卡的 time 改成目标位置对应的值"完全等价（验证见 2.1 执行记录）。
     * 不新增 collection reorder 操作，直接绑到已经可写的 time 属性。
     */
    reorderShot: { kind: 'property', propertyIds: [`${ENTITY.shot}.time`] },
    /*
     * 助手版不依赖"选中态"（选中是鼠标操作中间产物，助手用稳定引用直接寻址目标），
     * 而是显式指定目标镜头卡，写 capture_object_refs 属性即可（2.2，见重要记录 004 最终结论）。
     */
    captureIntoSelectedShot: { kind: 'property', propertyIds: [`${ENTITY.shot}.capture_object_refs`] },

    /* ── 关键帧 ─────────────────────────────────────────────── */
    keyframeAtCurrentTime: { kind: 'collection', entityType: ENTITY.keyframe, operation: 'create' },
    toggleKeyframe: { kind: 'collection', entityType: ENTITY.keyframe, operation: 'create' },
    toggleKeyframeGroup: { kind: 'collection', entityType: ENTITY.keyframe, operation: 'create' },
    removeKeyframe: { kind: 'collection', entityType: ENTITY.keyframe, operation: 'remove' },
    // 定义收敛在 cameraStageTimelineFields.ts。
    ...fieldLedgerEntries(KEYFRAME_FIELDS),
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
