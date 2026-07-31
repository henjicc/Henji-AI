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
      if (state.activeToolId !== previous.activeToolId) bumpScope('toolbox')
    }),
    useProjectStore.subscribe((state, previous) => {
      if (state.currentProjectId !== previous.currentProjectId) bumpScope('canvas')
    }),
    useCanvasStore.subscribe((state, previous) => {
      if (state.nodes !== previous.nodes || state.edges !== previous.edges || state.selectedNodeId !== previous.selectedNodeId) {
        bumpScope('canvas')
      }
    }),
    useAssetLibraryStore.subscribe((state, previous) => {
      if (state.view !== previous.view || state.selectedAsset?.id !== previous.selectedAsset?.id) bumpScope('assets')
    }),
    useSettingsStore.subscribe((state, previous) => {
      if (state !== previous) bumpScope('settings')
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
