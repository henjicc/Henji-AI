import { fieldLedgerEntries, type ApplicationStoreActionLedger } from '@/core/application-control'

import type { useCameraStageStore } from '../store/cameraStageStore'
import { CAMERA_FIELDS, OBJECT_FIELDS } from './cameraStageObjectFields'
import { CAMERA_STAGE_ENTITY_TYPES as ENTITY } from './cameraStageReflection'
import { SCENE_APPEARANCE_FIELDS, SCENE_TIMELINE_FIELDS } from './cameraStageSceneFields'
import { PLAYBACK_FIELDS, STATE_KEYFRAME_FIELDS } from './cameraStageTimelineFields'
import { TRAJECTORY_FIELDS } from './cameraStageTrajectoryFields'

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
  storeId: 'cameraStageStore',
  title: '三维运镜',
  entries: {
    /* ── 对象增删改 ─────────────────────────────────────────── */
    addPrimitive: { kind: 'capability', capabilityId: 'place_camera_stage_object' },
    addCharacter: { kind: 'capability', capabilityId: 'place_camera_stage_object' },
    addCamera: { kind: 'capability', capabilityId: 'place_camera_stage_object' },
    duplicateObject: { kind: 'capability', capabilityId: 'duplicate_camera_stage_object' },
    removeObject: { kind: 'capability', capabilityId: 'delete_camera_stage_object' },
    /*
     * updateObject/updateObjectAcrossStateKeyframes/updateTransform（object 域）与 updateCameraView
     * （camera 域）定义收敛在 cameraStageObjectFields.ts，账本条目从 storeActions 派生。
     * 2.4 又把 updatePoseJoint（63 条 animatable.* 里的姿态关节部分）与 applyPosePreset
     * （pose_preset 属性）并入同一批字段，账本条目同样从这里自动派生，不再手写。
     */
    ...fieldLedgerEntries(OBJECT_FIELDS),
    ...fieldLedgerEntries(CAMERA_FIELDS),

    /*
     * ── 场景外观（26 项）与时间轴（3 项）─────────────────────
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

    /* ── 状态关键帧 ─────────────────────────────────────────────── */
    // 增删接到集合写入（2.1）：专用能力 add_camera_stage_stateKeyframe 已删除，避免同功能两条路。
    addStateKeyframe: { kind: 'collection', entityType: ENTITY.stateKeyframe, operation: 'create' },
    removeStateKeyframe: { kind: 'collection', entityType: ENTITY.stateKeyframe, operation: 'remove' },
    removeStateKeyframes: { kind: 'collection', entityType: ENTITY.stateKeyframe, operation: 'remove' },
    // 定义收敛在 cameraStageTimelineFields.ts；time 被 moveStateKeyframeTime 与 updateStateKeyframeTiming 共用。
    ...fieldLedgerEntries(STATE_KEYFRAME_FIELDS),
    /*
     * 重排顺序完全由 time 决定：reorderStateKeyframe 内部把移动后各位置重新赋以排序后的 time 值，
     * 结果与"直接把目标状态关键帧的 time 改成目标位置对应的值"完全等价（验证见 2.1 执行记录）。
     * 不新增 collection reorder 操作，直接绑到已经可写的 time 属性。
     */
    reorderStateKeyframe: { kind: 'property', propertyIds: [`${ENTITY.stateKeyframe}.time`] },
    /*
     * 助手版不依赖"选中态"（选中是鼠标操作中间产物，助手用稳定引用直接寻址目标），
     * 而是显式指定目标状态关键帧，写 capture_object_refs 属性即可（2.2，见重要记录 004 最终结论）。
     */
    captureIntoSelectedStateKeyframe: { kind: 'property', propertyIds: [`${ENTITY.stateKeyframe}.capture_object_refs`] },

    /* ── 轨迹 ───────────────────────────────────────────────── */
    // 定义收敛在 cameraStageTrajectoryFields.ts；knots/start_out_tangent/end_in_tangent
    // 共用 setStateKeyframeSpatialPath（整条路径替换），start_position/end_position 走 setStateKeyframePathAnchor。
    ...fieldLedgerEntries(TRAJECTORY_FIELDS),
    applyCameraPathPreset: {
      kind: 'capability',
      capabilityId: 'apply_camera_stage_camera_move',
    },

    /* ── 工程 ──────────────────────────────────────────────── */
    newScene: { kind: 'capability', capabilityId: 'create_camera_stage_project' },
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
    prepareStateKeyframeEdit: {
      kind: 'excluded',
      category: 'internal',
      reason: '鼠标交互开始前冻结当前帧，避免首个变换增量触发插帧重编译；'
        + '是拖拽手势的内部步骤，助手的写入不经过手势。',
    },

    /* ── 选中与视图 ─────────────────────────────────────────── */
    setSelected: { kind: 'excluded', category: 'transient_selection', reason: SELECTION_REASON },
    selectStateKeyframe: { kind: 'excluded', category: 'transient_selection', reason: SELECTION_REASON },
    setSelectedStateKeyframeIds: { kind: 'excluded', category: 'transient_selection', reason: SELECTION_REASON },
    setSelectedStateKeyframeIdOnly: { kind: 'excluded', category: 'transient_selection', reason: SELECTION_REASON },
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
