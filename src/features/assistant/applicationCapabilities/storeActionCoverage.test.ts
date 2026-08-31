// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest'

import type {
  ApplicationMutationExecutor,
  ApplicationStoreActionLedger,
} from '@/core/application-control'
import { auditStoreActionLedger } from '@/core/application-control'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '@/core/assistant/builtinApplicationCapabilityRegistry'
import { ASSET_STORE_LEDGER } from '@/features/assets/application/assetStoreLedger'
import { useAssetLibraryStore } from '@/features/assets/store/assetLibraryStore'
import { ASSISTANT_UI_STORE_LEDGER } from '@/features/assistant/applicationCapabilities/assistantUiStoreLedger'
import { useAssistantUiStore } from '@/features/assistant/store/assistantUiStore'
import { CAMERA_STAGE_SESSION_STORE_LEDGER } from '@/features/cameraStage/application/cameraStageSessionStoreLedger'
import { CAMERA_STAGE_STORE_LEDGER } from '@/features/cameraStage/application/cameraStageStoreLedger'
import { CAMERA_STAGE_TOOL_STORE_LEDGER } from '@/features/cameraStage/application/cameraStageToolStoreLedger'
import { CAMERA_STAGE_VIEWPORT_STORE_LEDGER } from '@/features/cameraStage/application/cameraStageViewportStoreLedger'
import { useCameraStageStore } from '@/features/cameraStage/store/cameraStageStore'
import { useCameraStageSessionStore } from '@/features/cameraStage/store/cameraStageSessionStore'
import { useCameraStageToolStore } from '@/features/cameraStage/store/cameraStageToolStore'
import { useCameraStageViewportStore } from '@/features/cameraStage/store/cameraStageViewportStore'
import { CANVAS_EXECUTION_STATE_STORE_LEDGER } from '@/features/canvas/application/canvasExecutionStateStoreLedger'
import { CANVAS_GENERATION_PROGRESS_STORE_LEDGER } from '@/features/canvas/application/canvasGenerationProgressStoreLedger'
import { CANVAS_NODE_FOCUS_STORE_LEDGER } from '@/features/canvas/application/canvasNodeFocusStoreLedger'
import { CANVAS_TEXT_STREAM_STORE_LEDGER } from '@/features/canvas/application/canvasTextStreamStoreLedger'
import { CANVAS_STORE_LEDGER } from '@/features/canvas/application/canvasStoreLedger'
import { PANORAMA_INLINE_VIEWER_STORE_LEDGER } from '@/features/canvas/application/panoramaInlineViewerStoreLedger'
import { PROJECT_STORE_LEDGER } from '@/features/canvas/application/projectStoreLedger'
import { SPECIAL_EDITOR_CONTROLLER_STORE_LEDGER } from '@/features/canvas/application/specialEditorControllerStoreLedger'
import { GENERATION_DRAFT_STORE_LEDGER } from '@/features/generation/application/generationDraftStoreLedger'
import { GENERATION_HISTORY_FILTER_STORE_LEDGER } from '@/features/generation/application/generationHistoryFilterStoreLedger'
import { GENERATION_TASK_PROGRESS_STORE_LEDGER } from '@/features/generation/application/generationTaskProgressStoreLedger'
import { useGenerationDraftStore } from '@/features/generation/store/generationDraftStore'
import { NAVIGATION_STORE_LEDGER } from '@/features/navigation/application/navigationStoreLedger'
import { IMAGE_EDITOR_HANDOFF_STORE_LEDGER } from '@/features/imageEdit/application/imageEditorHandoffStoreLedger'
import { IMAGE_EDITOR_UI_STORE_LEDGER } from '@/features/imageEdit/application/imageEditorUiStoreLedger'
import { useImageEditorHandoffStore } from '@/features/imageEdit/store/imageEditorHandoffStore'
import { useImageEditorUiStore } from '@/features/imageEdit/store/imageEditorUiStore'
import { useImageEditSessionStore } from '@/features/imageEdit/store/imageEditSessionStore'
import {
  IMAGE_EDITOR_INTERACTION_STORE_LEDGER_V3,
} from '@/features/imageEdit/v3/application/imageEditorInteractionStoreLedger'
import {
  IMAGE_EDITOR_SESSION_STORE_LEDGER_V3,
} from '@/features/imageEdit/v3/application/imageEditorSessionStoreLedger'
import { useImageEditorInteractionStoreV3 } from '@/features/imageEdit/v3/store/imageEditorInteractionStoreV3'
import { useImageEditorSessionStoreV3 } from '@/features/imageEdit/v3/store/imageEditorSessionStoreV3'
import { IMAGE_MARK_STORE_LEDGER } from '@/features/imageMark/application/imageMarkStoreLedger'
import { ALERT_DIALOG_STORE_LEDGER } from '@/features/settings/application-control/alertDialogStoreLedger'
import { LARGE_UPLOAD_POLICY_STORE_LEDGER } from '@/features/settings/application-control/largeUploadPolicyStoreLedger'
import { SETTINGS_STORE_LEDGER } from '@/features/settings/application-control/settingsStoreLedger'
import { THEME_STORE_LEDGER } from '@/features/settings/application-control/themeStoreLedger'
import { UI_STORE_LEDGER } from '@/features/settings/application-control/uiStoreLedger'
import { useLargeUploadPromptStore } from '@/services/largeUploadPolicy'
import { useAlertDialogStore } from '@/stores/alertDialogStore'
import { useCanvasExecutionStateStore } from '@/stores/canvasExecutionStateStore'
import { useCanvasNodeFocusStore } from '@/features/canvas/hooks/useCanvasNodeFocus'
import { useCanvasGenerationProgressStore } from '@/stores/canvasGenerationProgressStore'
import { useCanvasTextStreamStore } from '@/stores/canvasTextStreamStore'
import { useCanvasStore } from '@/stores/canvasStore'
import { usePanoramaInlineViewerStore } from '@/stores/panoramaInlineViewerStore'
import { useCanvasSpecialEditorController } from '@/features/canvas/application/specialEditorController'
import { useGenerationHistoryFilterStore } from '@/stores/generationHistoryFilterStore'
import { useGenerationTaskProgressStore } from '@/stores/generationTaskProgressStore'
import { useNavigationStore } from '@/stores/navigationStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useThemeStore } from '@/stores/themeStore'
import { useUiStore } from '@/stores/uiStore'
import { loadRealModelsIntoRegistry } from '@/tests/loadRealModels'

import {
  getApplicationControlExecutionEngine,
  getApplicationReflectionRegistry,
} from './applicationControlRegistry'

/**
 * 覆盖门禁：**人在界面上能做的每一件事，助手要么也能做，要么账上写明为什么不能。**
 *
 * 此前所有覆盖门禁都从「已注册的描述」出发做双向比对，从不反向看 store。于是三维场景外观
 * 24 项界面能改、助手一项都看不到这件事，没有任何检查能发现——不是被权限挡住，是根本没注册。
 *
 * 这里的断言方向是**从 store 运行时枚举**：任何新增的界面动作都会出现在 actionNames 里，
 * 账上没有就红。用运行时枚举而不是手写清单，是这条门禁的全部意义所在。
 */

interface LedgerCase {
  ledger: ApplicationStoreActionLedger<string>
  state: () => object
}

const LEDGERS: LedgerCase[] = [
  { ledger: CAMERA_STAGE_STORE_LEDGER, state: () => useCameraStageStore.getState() },
  { ledger: CAMERA_STAGE_TOOL_STORE_LEDGER, state: () => useCameraStageToolStore.getState() },
  { ledger: CAMERA_STAGE_VIEWPORT_STORE_LEDGER, state: () => useCameraStageViewportStore.getState() },
  { ledger: CAMERA_STAGE_SESSION_STORE_LEDGER, state: () => useCameraStageSessionStore.getState() },
  { ledger: CANVAS_STORE_LEDGER, state: () => useCanvasStore.getState() },
  { ledger: PANORAMA_INLINE_VIEWER_STORE_LEDGER, state: () => usePanoramaInlineViewerStore.getState() },
  { ledger: SPECIAL_EDITOR_CONTROLLER_STORE_LEDGER, state: () => useCanvasSpecialEditorController.getState() },
  { ledger: ASSET_STORE_LEDGER, state: () => useAssetLibraryStore.getState() },
  { ledger: PROJECT_STORE_LEDGER, state: () => useProjectStore.getState() },
  { ledger: NAVIGATION_STORE_LEDGER, state: () => useNavigationStore.getState() },
  { ledger: UI_STORE_LEDGER, state: () => useUiStore.getState() },
  { ledger: THEME_STORE_LEDGER, state: () => useThemeStore.getState() },
  { ledger: SETTINGS_STORE_LEDGER, state: () => useSettingsStore.getState() },
  { ledger: IMAGE_EDITOR_UI_STORE_LEDGER, state: () => useImageEditorUiStore.getState() },
  { ledger: IMAGE_EDITOR_HANDOFF_STORE_LEDGER, state: () => useImageEditorHandoffStore.getState() },
  { ledger: IMAGE_EDITOR_INTERACTION_STORE_LEDGER_V3, state: () => useImageEditorInteractionStoreV3.getState() },
  { ledger: IMAGE_EDITOR_SESSION_STORE_LEDGER_V3, state: () => useImageEditorSessionStoreV3.getState() },
  { ledger: ASSISTANT_UI_STORE_LEDGER, state: () => useAssistantUiStore.getState() },
  { ledger: ALERT_DIALOG_STORE_LEDGER, state: () => useAlertDialogStore.getState() },
  { ledger: LARGE_UPLOAD_POLICY_STORE_LEDGER, state: () => useLargeUploadPromptStore.getState() },
  { ledger: CANVAS_EXECUTION_STATE_STORE_LEDGER, state: () => useCanvasExecutionStateStore.getState() },
  { ledger: CANVAS_GENERATION_PROGRESS_STORE_LEDGER, state: () => useCanvasGenerationProgressStore.getState() },
  { ledger: CANVAS_TEXT_STREAM_STORE_LEDGER, state: () => useCanvasTextStreamStore.getState() },
  { ledger: CANVAS_NODE_FOCUS_STORE_LEDGER, state: () => useCanvasNodeFocusStore.getState() },
  { ledger: GENERATION_TASK_PROGRESS_STORE_LEDGER, state: () => useGenerationTaskProgressStore.getState() },
  { ledger: GENERATION_HISTORY_FILTER_STORE_LEDGER, state: () => useGenerationHistoryFilterStore.getState() },
  { ledger: GENERATION_DRAFT_STORE_LEDGER, state: () => useGenerationDraftStore.getState() },
  { ledger: IMAGE_MARK_STORE_LEDGER, state: () => useImageEditSessionStore.getState() },
]

/**
 * 人机差集的燃尽基线：账上仍标为 gap 的动作总数。
 *
 * 这是个棘轮——新缺口进不来（超过基线就红），各期补齐把它往下调。降到 0 就是
 * 「助手能做的事等于人在界面上能做的事」。改这个数字只有两种正当理由：
 * 补齐了某项（调小），或者界面新增了一个确实还做不了的功能（连同 gap 理由一起说明）。
 *
 * 建账当天 21 项。播放控制 5 项已补齐（注册成 camera_stage.playback 单例实体，零新增工具），
 * 2.1 又烧掉状态关键帧增删排序 3 项（removeShot/removeShots 接到集合写入，reorderShot 绑到已可写
 * 的 time 属性，专用能力 add_camera_stage_shot 一并下线）。2.2 烧掉状态关键帧状态捕获 1 项
 * （captureIntoSelectedShot 绑到新增的 capture_object_refs 属性，不依赖选中态）。2.3 烧掉编辑
 * 模式切换与烘焙 2 项——读代码发现"专业→简易无约束"的假设不成立（store 直接拒绝这个方向），
 * setEditorMode 只是新建工程的内部步骤、已被 create_camera_stage_project 覆盖，改绑 excluded；
 * bakeToProMode 注册为带审批的语义能力 bake_camera_stage_to_pro。2.4 烧掉姿态直接写入 2 项——
 * updatePoseJoint 并入 63 条 animatable.* 逐分量属性（方案 C：轨道无关键帧写静态值，有关键帧
 * 等价于当前时间点打点，只在专业模式下可写），applyPosePreset 绑到新增的 pose_preset 枚举属性。
 * 2.5 烧掉三维最后 3 项——clearTrack 接到集合删除的轨道级引用（工程:对象:属性路径，不带时间）；
 * setShotSpatialPath/setShotPathAnchor 绑到 camera_stage.trajectory 新增的 5 条可写属性
 * （knots 等三条整条路径替换，start_position/end_position 挪相邻状态关键帧快照）。**三维 11 项
 * 缺口全部归零**。3.1 烧掉画布 3 项——clearCanvas/ungroupNode/redo 均注册为专用能力
 * （clear_canvas/ungroup_canvas_node/redo_canvas_change），与 undo_canvas_change/
 * group_canvas_nodes 同属工程级整体状态操作，不勉强表达成集合写入。3.2 烧掉最后 2 项——
 * updateStoryboardFrame/reorderStoryboardFrame 都绑到新增的 canvas.node.storyboard_frames
 * 属性（分镜格子没有独立于画布节点的身份，内容与排序都是按 id 定点写 note/order 字段）。
 * **画布 5 项缺口全部归零，本任务范围内 GAP_BASELINE 降到 0**——助手能做的事等于人在
 * 界面上能做的事。往后每新增一个界面动作，先在这里加一条账目，只能降不能升。
 *
 * 第四阶段开始给 `src/stores/*` 一类未建账的 store 补账，这里预期会盘出新缺口——4.1 只是把
 * 门禁的清点范围扩大到全部 store，不代表这些 store 之前就有对应能力。4.2 建 projectStore（10
 * 动作，零新增 gap）/ navigationStore（2 动作，零新增 gap）/ uiStore（2 动作，零新增 gap）/
 * themeStore（2 动作，零新增 gap——顺带发现这个 store 是死代码，全仓库没有调用方）/
 * settingsStore（31 动作，新增 2 个 gap）。这 2 个 gap 都对应 protected 设置：
 * `setProviderApiKey`（security.provider_keys）与 `setDownloadPresetPaths`
 * （storage.download_paths）——反射层还没把 7 项 protected 设置注册成正规属性，4.4 负责
 * 松绑其中 2 项、改写其余 5 项的只读理由，到时候回来把这两条 gap 改绑定。（这两个 store 方法
 * 本身在全仓库里也找不到除自身定义外的调用方，是死代码，但归类交给 4.4 统一判断，不在这里
 * 自行排除。）**GAP_BASELINE 0 → 2**。
 *
 * 4.3 给剩下 11 个 store 建账（4.1 复核后的准确总数，19/19 全覆盖）：三维三个视图态 store
 * （tool/viewport/session）与画布/生成两个进度投影 store 全部零新增 gap。图片编辑面板、图片
 * 交接中转态、助手自身面板、两个全局弹窗队列（alertDialogStore/largeUploadPolicy）同样零新增
 * gap——assistantUiStore.setApprovalMode 按任务文档要求单独归为 user_only（审批模式是用户对
 * 助手的授权开关，改它等于自我提权）。唯一有实质缺口的是 generationHistoryFilterStore（8 个
 * 动作，非最初估的 16）：核对 list_generation_history 的 inputSchema 后发现它只覆盖
 * mediaType（还有 status/limit，界面上没有对应筛选项），界面上另外 6 个筛选维度——keyword
 * （关键词）、providerId（供应商）、modelId（模型）、timePreset/startDate/endDate（时间范围）
 * ——助手完全没有对应查询入口，不是视图态，如实登记为 6 个新 gap；resetFilters 只清空这些
 * 筛选框的本地状态，没有对应"重置查询"的语义，归为 view_state。**GAP_BASELINE 2 → 8**，
 * 4.1 白名单里的 store 条目全部清空，19/19 全覆盖达成。
 */
const GAP_BASELINE = 0

function actionNames(state: object): string[] {
  return Object.entries(state)
    .filter(([, value]) => typeof value === 'function')
    .map(([key]) => key)
}

function auditAll() {
  const registry = getApplicationReflectionRegistry()
  const engine = getApplicationControlExecutionEngine() as unknown as {
    mutationExecutors: Map<string, ApplicationMutationExecutor>
    collectionExecutors: Map<string, unknown>
  }
  const writable = new Set<string>()
  for (const executor of engine.mutationExecutors.values()) {
    for (const propertyId of executor.writableProperties) writable.add(propertyId)
  }
  const declaredCollections = new Set(registry
    .describe({}, {
      exposure: 'assistant' as const,
      permissions: new Set(registry.listDeclaredPropertyPermissions()),
      acceptedDataClasses: new Set(['C0', 'C1', 'C2'] as const),
    }).entities
    .filter((entity) => entity.collectionWrite)
    .map((entity) => entity.id)
    .filter((entityType) => engine.collectionExecutors.has(entityType)))
  const capabilityIds = new Set(BUILTIN_APPLICATION_CAPABILITY_REGISTRY.list().map((capability) => capability.id))

  return LEDGERS.map(({ ledger, state }) => ({
    ledger,
    audit: auditStoreActionLedger({
      ledger,
      actionNames: actionNames(state()),
      writableProperties: writable,
      collectionEntityTypes: declaredCollections,
      capabilityIds,
    }),
  }))
}

describe('界面动作与助手能力对齐', () => {
  beforeAll(async () => {
    await loadRealModelsIntoRegistry()
  })

  it('这条门禁不会因为账本或 store 为空而空转', () => {
    const results = auditAll()
    expect(results.length).toBeGreaterThanOrEqual(3)
    for (const { ledger, audit } of results) {
      const total = Object.keys(ledger.entries).length
      expect(total, `${ledger.title}账本为空`).toBeGreaterThan(0)
      expect(
        audit.unclassified.length + audit.stale.length + total,
        `${ledger.title}的 store 动作枚举为空，门禁失效`,
      ).toBeGreaterThan(0)
    }
  })

  it('界面上能做的每一个动作，账上都有一条', () => {
    for (const { ledger, audit } of auditAll()) {
      expect(
        audit.unclassified,
        `【${ledger.title}】以下 store 动作界面能做、账上没有——它是助手做不了却没人知道的能力缺口。`
        + `要么绑定到属性 / 集合 / 能力，要么进 excluded 写明由谁维护，要么标成 gap 写明缺什么：`
        + audit.unclassified.join('、'),
      ).toEqual([])
    }
  })

  it('账上每一条都对得上真实的 store 动作', () => {
    for (const { ledger, audit } of auditAll()) {
      expect(
        audit.stale,
        `【${ledger.title}】以下账目对应的 store 动作已不存在，账没销：${audit.stale.join('、')}`,
      ).toEqual([])
    }
  })

  it('账上写的助手入口真的存在，而且真的写得了', () => {
    for (const { ledger, audit } of auditAll()) {
      const problems = audit.brokenBindings.map((item) => item.problem)
      expect(
        problems,
        `【${ledger.title}】以下账目指向的属性 / 实体 / 能力对不上，账是假的：${problems.join('；')}`,
      ).toEqual([])
    }
  })

  it('排除与缺口的理由都能被验证', () => {
    for (const { ledger, audit } of auditAll()) {
      const problems = audit.weakExclusions.map((item) => item.problem)
      expect(
        problems,
        `【${ledger.title}】以下理由无法验证（过短，或把问题推给将来）：`
        + problems.join('；'),
      ).toEqual([])
    }
  })

  it('人机差集不许扩大：gap 总数不超过基线', () => {
    const results = auditAll()
    const gaps = results.flatMap(({ ledger, audit }) => audit.gaps.map((action) => `${ledger.storeId}.${action}`))
    expect(
      gaps.length,
      `人能做、助手还不能做的动作涨到了 ${gaps.length} 个（基线 ${GAP_BASELINE}）：${gaps.join('、')}。`
      + '新功能上线时助手侧要同步接上；确实要留缺口就连同理由一起把基线调高。',
    ).toBeLessThanOrEqual(GAP_BASELINE)
  })
})
