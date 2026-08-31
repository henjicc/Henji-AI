import {
  AGENT_CONTRACT_VERSION,
  hostContextSnapshotSchema,
  type HostContextSnapshot,
  type HostScope,
  type HostScopeRevisions,
} from '@/core/assistant/hostContracts'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '@/core/assistant/builtinApplicationCapabilityRegistry'
import { useAssetLibraryStore } from '@/features/assets/store/assetLibraryStore'
import { useCanvasStore } from '@/stores/canvasStore'
import { useNavigationStore } from '@/stores/navigationStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'
import { useCameraStageStore } from '@/features/cameraStage/store/cameraStageStore'
import { imageMarkRevision } from '@/features/imageMark/application/imageMarkSessionAccess'
import {
  getImageEditV3LiveRevision,
  subscribeImageEditV3LiveSessions,
} from '@/features/imageEdit/v3/application/imageEditLiveSessionRegistry'
import { getGenerationModelsRevision } from '@/features/generation/application/generationModelFields'
import { useGenerationDraftStore } from '@/features/generation/store/generationDraftStore'
import {
  isVisibleGenerationTaskHandlerReady,
  subscribeVisibleGenerationTaskChanges,
} from '@/workspaces/GenerationWorkspace/application/visibleGenerationTaskCommand'
import {
  getApplicationDomainChangeRevision,
  subscribeApplicationDomainChanges,
} from '@/core/application-control/domainChangeSignal'

const rendererSessionId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
  ? crypto.randomUUID()
  : `renderer-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

/**
 * 宿主发布的乐观并发基线。
 *
 * **每个 provider 自报的 revision scope 都必须出现在这里。** 通用写入的计划器要求调用方为
 * 目标实体的每一个 revision scope 提供期望值（`assertRevisions` 按 `Object.keys(revisions)`
 * 逐个要），而调用方能拿到的只有这份快照——scope 没发布，模型就永远给不出期望值，
 * 那条属性于是"声明可写、实际写不了"，报 `EXPECTED_REVISION_REQUIRED:<scope>` 且没有任何
 * 恢复路径（重试分支只处理 REVISION_CONFLICT）。
 *
 * `generation_draft` 与 `models` 就是这样漏了很久：两个 provider 各自有真实 revision
 * （草稿 store 的 `revision`、模型可见性事件计数），却从没发布出来，于是助手改提示词草稿、
 * 隐藏模型这两条路一直是死的。门禁在 `hostScopeCoverage.test.ts`。
 */
const scopeRevisions: HostScopeRevisions = {
  navigation: 0,
  generation: 0,
  canvas: 0,
  toolbox: 0,
  assets: 0,
  settings: 0,
  surface: 0,
  generation_draft: 0,
  models: 0,
  image_mark: 0,
  image_edit: 0,
}

const listeners = new Set<() => void>()
let revision = 0
let trackingRefCount = 0
let disposeTracking: (() => void) | null = null
let observedAssetDomainRevision = 0

function syncAssetDomainRevision(): void {
  const current = getApplicationDomainChangeRevision('assets')
  const delta = Math.max(0, current - observedAssetDomainRevision)
  observedAssetDomainRevision = current
  if (delta === 0) return
  revision += delta
  scopeRevisions.assets += delta
  for (const listener of listeners) listener()
}

/**
 * 从**权威计数直接拉取**，而不是订阅后自增镜像。
 *
 * 这些 scope 的真相在各自的领域里（草稿 store 的 `revision`、模型可见性事件计数、
 * V2 标注会话与 V3 实时命令总线各自的单调领域计数），
 * 执行器返回的 `resultingRevisions` 用的也是同一个数。镜像一份出来就有两个真相源，
 * 而漂移的方向恰恰是基线失真——模型拿着对不上的期望值写入，只会得到无从修复的 CONFLICT。
 * 拉取没有这个问题：读到的永远就是执行器会拿来比对的那个数。
 */
function syncPulledRevisions(): void {
  scopeRevisions.generation_draft = useGenerationDraftStore.getState().revision
  scopeRevisions.models = getGenerationModelsRevision()
  scopeRevisions.image_mark = imageMarkRevision()
  scopeRevisions.image_edit = getImageEditV3LiveRevision()
}

/**
 * 推进一个作用域的 revision。
 *
 * **不变量：作用域 revision 只能由该领域的数据变化推进，不能由界面或选中状态推进。**
 * 因为作用域 revision 会被能力当成乐观并发基线（三维写入的 `baseRevision` 就是
 * `scopeRevisions.toolbox`），一旦纯界面动作也推进它，模型读到的基线会在它还没写入时就
 * 过期，写入必然 CONFLICT 且无法绕开。
 *
 * 界面与选中状态的新鲜度由全局 `revision` 表达——它在这里一并推进，快照消费方不受影响。
 * 新增订阅时先问一句：这个字段变了，算不算"数据变了"？不算就挂到 `navigation` 或
 * `surface`，不要挂到会被写入能力当基线的领域作用域上。
 */
function bumpScope(scope: HostScope): void {
  revision += 1
  scopeRevisions[scope] += 1
  for (const listener of listeners) listener()
}

/** 非 Zustand 领域服务完成持久化写入后调用，统一推进对应宿主 revision。 */
export function notifyHostScopeChanged(scope: HostScope): void {
  bumpScope(scope)
}

function startTracking(): () => void {
  const unsubscribers = [
    useNavigationStore.subscribe((state, previous) => {
      if (state.activeWorkspace !== previous.activeWorkspace) bumpScope('navigation')
      /*
       * "当前打开的是哪个工具"属于导航状态，**不能**推进 toolbox。
       *
       * toolbox 这个 scope 同时被当成三维场景数据的乐观并发基线（`baseRevision`）。
       * 之前这里推进 toolbox，后果是：系统提示词要求可视编辑任务先打开目标 Surface 再写入，
       * 而打开 Surface 就会 selectToolboxTool → activeToolId 变化 → toolbox +1，于是模型
       * 拿着打开前读到的 baseRevision 发起第一次写入，必然 CONFLICT。实测日志里就是这样。
       *
       * 全局 revision 仍然会推进，宿主快照的新鲜度不受影响。
       */
      if (state.activeToolId !== previous.activeToolId) bumpScope('navigation')
    }),
    useProjectStore.subscribe((state, previous) => {
      if (state.currentProjectId !== previous.currentProjectId) bumpScope('canvas')
    }),
    useCanvasStore.subscribe((state, previous) => {
      if (state.nodes !== previous.nodes || state.edges !== previous.edges) bumpScope('canvas')
      // 选中项是界面状态，不是画布数据：它不能推进 canvas 基线，否则将来任何一个用
      // scopeRevisions.canvas 做乐观并发的写入，都会被"定位一下节点"这种纯导航动作弄失效。
      if (state.selectedNodeId !== previous.selectedNodeId) bumpScope('surface')
    }),
    useAssetLibraryStore.subscribe((state, previous) => {
      // 素材库的浮层开合与选中同理，都属于呈现层。
      if (state.view !== previous.view || state.selectedAsset?.id !== previous.selectedAsset?.id) {
        bumpScope('surface')
      }
    }),
    useSettingsStore.subscribe((state, previous) => {
      if (state !== previous) bumpScope('settings')
    }),
    useCameraStageStore.subscribe((state, previous) => {
      if (
        state.currentProjectId !== previous.currentProjectId
        || state.currentProjectName !== previous.currentProjectName
        || state.objects !== previous.objects
        || state.activeCameraId !== previous.activeCameraId
        || state.animation !== previous.animation
        || state.sceneSettings !== previous.sceneSettings
        || state.stateKeyframes !== previous.stateKeyframes
      ) {
        bumpScope('toolbox')
      }
    }),
    useUiStore.subscribe((state, previous) => {
      if (
        state.isSettingsOpen !== previous.isSettingsOpen
        || state.settingsTarget !== previous.settingsTarget
      ) {
        bumpScope('surface')
      }
    }),
    subscribeVisibleGenerationTaskChanges(() => bumpScope('generation')),
    subscribeApplicationDomainChanges((scope) => {
      if (scope === 'assets') syncAssetDomainRevision()
    }),
    subscribeImageEditV3LiveSessions(() => {
      revision += 1
      for (const listener of listeners) listener()
    }),
  ]
  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe()
  }
}

export function retainHostContextTracking(): () => void {
  trackingRefCount += 1
  if (!disposeTracking) disposeTracking = startTracking()
  return () => {
    trackingRefCount = Math.max(0, trackingRefCount - 1)
    if (trackingRefCount === 0 && disposeTracking) {
      disposeTracking()
      disposeTracking = null
    }
  }
}

export function subscribeHostContext(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getHostScopeRevisions(): HostScopeRevisions {
  // 即使素材写入发生在助手桥尚未挂载时，也在下一次读取基线时补齐，不能静默丢 revision。
  syncAssetDomainRevision()
  syncPulledRevisions()
  return { ...scopeRevisions }
}

export function getRendererSessionId(): string {
  return rendererSessionId
}

export function createHostContextSnapshot(uiReady = true): HostContextSnapshot {
  const navigation = useNavigationStore.getState()
  const project = useProjectStore.getState()
  const canvas = useCanvasStore.getState()
  const assets = useAssetLibraryStore.getState()
  const generationReady = isVisibleGenerationTaskHandlerReady()
  const ui = useUiStore.getState()
  const selectedRefs = [
    assets.selectedAsset ? `asset:${assets.selectedAsset.id}` : null,
    project.currentProjectId && canvas.selectedNodeId
      ? `canvas.node:${project.currentProjectId}:${canvas.selectedNodeId}`
      : null,
  ].filter((value): value is string => typeof value === 'string')
  const settingsSurface = ui.settingsTarget
    ? `settings.${ui.settingsTarget.tab}.${ui.settingsTarget.sectionId ?? 'root'}`
    : 'settings.general'
  const surface = ui.isSettingsOpen
    ? {
        id: settingsSurface,
        kind: 'settings' as const,
        focusedRef: null,
        selectedRefs,
      }
    : navigation.activeWorkspace === 'tools' && navigation.activeToolId
      ? {
          id: navigation.activeToolId === 'imageMark' ? 'tool.image_edit' : 'tool.camera_stage',
          kind: 'tool' as const,
          focusedRef: null,
          selectedRefs,
        }
      : assets.view === 'floating'
        ? {
            id: 'overlay.assets',
            kind: 'overlay' as const,
            focusedRef: assets.selectedAsset ? `asset:${assets.selectedAsset.id}` : null,
            selectedRefs,
          }
        : {
            id: navigation.activeWorkspace === 'nodes'
              ? 'workspace.canvas'
              : `workspace.${navigation.activeWorkspace}`,
            kind: 'workspace' as const,
            focusedRef: project.currentProjectId && canvas.selectedNodeId
              ? `canvas.node:${project.currentProjectId}:${canvas.selectedNodeId}`
              : assets.selectedAsset
                ? `asset:${assets.selectedAsset.id}`
                : null,
            selectedRefs,
          }
  const applicationCapabilities = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.list()
  const catalogRevision = applicationCapabilities
    .reduce((total, capability) => total + capability.version, applicationCapabilities.length)

  return hostContextSnapshotSchema.parse({
    schemaVersion: AGENT_CONTRACT_VERSION,
    rendererSessionId,
    revision,
    scopeRevisions: getHostScopeRevisions(),
    catalogRevision,
    surface,
    workspace: {
      id: navigation.activeWorkspace,
      activeToolId: navigation.activeToolId,
    },
    project: {
      id: project.currentProjectId,
      selectedNodeId: canvas.selectedNodeId,
    },
    generation: { commandReady: generationReady },
    assets: {
      view: assets.view,
      selectedAssetId: assets.selectedAsset?.id ?? null,
    },
    uiReady,
    availableCapabilities: applicationCapabilities.map((capability) => capability.id),
    capturedAt: new Date().toISOString(),
  })
}
