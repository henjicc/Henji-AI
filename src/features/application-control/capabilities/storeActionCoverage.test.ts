// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest'

import type { ApplicationMutationExecutor, ApplicationStoreActionLedger } from '@/core/application-control'
import { auditStoreActionLedger } from '@/core/application-control'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '@/core/application-control/builtinApplicationCapabilityRegistry'
import { ASSET_STORE_LEDGER } from '@/features/assets/application/assetStoreLedger'
import { useAssetLibraryStore } from '@/features/assets/store/assetLibraryStore'
import { ASSISTANT_UI_STORE_LEDGER } from '@/features/assistant/application/assistantUiStoreLedger'
import { useAssistantUiStore } from '@/features/assistant/store/assistantUiStore'
import { AUDIO_EDIT_PLAYBACK_STORE_LEDGER } from '@/features/audioEdit/application/audioEditPlaybackStoreLedger'
import { AUDIO_EDIT_STORE_LEDGER } from '@/features/audioEdit/application/audioEditStoreLedger'
import { useAudioEditPlaybackStore } from '@/features/audioEdit/store/audioEditPlaybackStore'
import { useAudioEditStore } from '@/features/audioEdit/store/audioEditStore'
import { CAMERA_STAGE_SESSION_STORE_LEDGER } from '@/features/cameraStage/application/cameraStageSessionStoreLedger'
import { CAMERA_STAGE_STORE_LEDGER } from '@/features/cameraStage/application/cameraStageStoreLedger'
import { CAMERA_STAGE_TOOL_STORE_LEDGER } from '@/features/cameraStage/application/cameraStageToolStoreLedger'
import { CAMERA_STAGE_VIEWPORT_STORE_LEDGER } from '@/features/cameraStage/application/cameraStageViewportStoreLedger'
import { useCameraStageStore } from '@/features/cameraStage/store/cameraStageStore'
import { useCameraStageSessionStore } from '@/features/cameraStage/store/cameraStageSessionStore'
import { useCameraStageToolStore } from '@/features/cameraStage/store/cameraStageToolStore'
import { useCameraStageViewportStore } from '@/features/cameraStage/store/cameraStageViewportStore'
import { CANVAS_EXECUTION_STATE_STORE_LEDGER } from '@/features/canvas/application/canvasExecutionStateStoreLedger'
import { CAMERA_STAGE_RENDER_PROGRESS_STORE_LEDGER } from '@/features/canvas/application/cameraStageRenderProgressStoreLedger'
import { useCameraStageRenderProgressStore } from '@/features/canvas/application/cameraStageRenderProgress'
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
import { IMAGE_EDITOR_INTERACTION_STORE_LEDGER_V3 } from '@/features/imageEdit/v3/application/imageEditorInteractionStoreLedger'
import { IMAGE_EDITOR_SESSION_STORE_LEDGER_V3 } from '@/features/imageEdit/v3/application/imageEditorSessionStoreLedger'
import { useImageEditorInteractionStoreV3 } from '@/features/imageEdit/v3/store/imageEditorInteractionStoreV3'
import { useImageEditorSessionStoreV3 } from '@/features/imageEdit/v3/store/imageEditorSessionStoreV3'
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

import { getApplicationControlExecutionEngine, getApplicationReflectionRegistry } from './applicationControlRegistry'

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
  { ledger: AUDIO_EDIT_STORE_LEDGER, state: () => useAudioEditStore.getState() },
  { ledger: AUDIO_EDIT_PLAYBACK_STORE_LEDGER, state: () => useAudioEditPlaybackStore.getState() },
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
  { ledger: CAMERA_STAGE_RENDER_PROGRESS_STORE_LEDGER, state: () => useCameraStageRenderProgressStore.getState() },
  { ledger: CANVAS_GENERATION_PROGRESS_STORE_LEDGER, state: () => useCanvasGenerationProgressStore.getState() },
  { ledger: CANVAS_TEXT_STREAM_STORE_LEDGER, state: () => useCanvasTextStreamStore.getState() },
  { ledger: CANVAS_NODE_FOCUS_STORE_LEDGER, state: () => useCanvasNodeFocusStore.getState() },
  { ledger: GENERATION_TASK_PROGRESS_STORE_LEDGER, state: () => useGenerationTaskProgressStore.getState() },
  { ledger: GENERATION_HISTORY_FILTER_STORE_LEDGER, state: () => useGenerationHistoryFilterStore.getState() },
  { ledger: GENERATION_DRAFT_STORE_LEDGER, state: () => useGenerationDraftStore.getState() },
]

/** Store 动作必须绑定正式属性、集合或能力；有意排除与尚未覆盖均由账本声明。 */
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
