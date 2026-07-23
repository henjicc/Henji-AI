import {
  AGENT_CONTRACT_VERSION,
  hostContextSnapshotSchema,
  type HostCommandName,
  type HostContextSnapshot,
  type HostScope,
  type HostScopeRevisions,
} from '@/core/assistant/hostContracts'
import { useAssetLibraryStore } from '@/features/assets/store/assetLibraryStore'
import { useCanvasStore } from '@/stores/canvasStore'
import { useNavigationStore } from '@/stores/navigationStore'
import { useProjectStore } from '@/stores/projectStore'
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
  const commands: HostCommandName[] = [
    'switch_workspace',
    'open_canvas_project',
    'add_canvas_node',
  ]
  if (generationReady) commands.push('create_visible_generation_task')

  return hostContextSnapshotSchema.parse({
    schemaVersion: AGENT_CONTRACT_VERSION,
    rendererSessionId,
    revision,
    scopeRevisions: getHostScopeRevisions(),
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
    availableCommands: commands,
    capturedAt: new Date().toISOString(),
  })
}
