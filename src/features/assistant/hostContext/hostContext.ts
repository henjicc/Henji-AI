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
import {
  isVisibleGenerationTaskHandlerReady,
  subscribeVisibleGenerationTaskChanges,
} from '@/workspaces/GenerationWorkspace/application/visibleGenerationTaskCommand'

const rendererSessionId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
  ? crypto.randomUUID()
  : `renderer-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

const scopeRevisions: HostScopeRevisions = {
  navigation: 0,
  generation: 0,
  canvas: 0,
  toolbox: 0,
  assets: 0,
  settings: 0,
  surface: 0,
}

const listeners = new Set<() => void>()
let revision = 0
let trackingRefCount = 0
let disposeTracking: (() => void) | null = null

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
        || state.editorMode !== previous.editorMode
        || state.shots !== previous.shots
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
