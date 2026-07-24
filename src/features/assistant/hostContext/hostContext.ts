import {
  AGENT_CONTRACT_VERSION,
  hostContextSnapshotSchema,
  type HostCommandName,
  type HostContextSnapshot,
  type HostQueryName,
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
    'create_canvas_project',
  ]
  if (project.currentProjectId) {
    commands.push(
      'close_canvas_project',
      'rename_canvas_project',
      'delete_canvas_project',
      'add_canvas_node',
      'duplicate_canvas_node',
      'update_canvas_node',
      'delete_canvas_nodes',
      'add_asset_to_canvas',
      'select_canvas_node',
      'group_canvas_nodes',
      'connect_canvas_nodes',
      'disconnect_canvas_edge',
      'focus_canvas_node',
      'undo_canvas_change'
    )
    commands.push('commit_canvas_batch')
  }
  commands.push('select_toolbox_tool')
  if (navigation.activeToolId === 'cameraStage') {
    commands.push(
      'create_camera_stage_project',
      'open_camera_stage_project',
      'rename_camera_stage_project',
      'delete_camera_stage_project',
      'add_camera_stage_object',
      'duplicate_camera_stage_object',
      'delete_camera_stage_object',
      'update_camera_stage_object',
      'add_camera_stage_shot',
      'update_camera_stage_shot',
    )
  }
  if (navigation.activeToolId === 'imageMark') {
    commands.push('create_image_edit_preview', 'commit_image_edit')
  }
  commands.push(
    'select_asset',
    'set_asset_tags',
    'add_asset_to_library',
    'remove_asset_from_library',
    'delete_asset',
  )
  if (generationReady) commands.push('create_visible_generation_task')
  if (generationReady) commands.push('cancel_generation_task')
  const queries: HostQueryName[] = [
    'get_host_context',
    'list_canvas_projects',
    'get_canvas_project',
    'get_canvas_node',
    'plan_canvas_batch',
    'preview_canvas_batch',
    'search_canvas_node_types',
    'get_canvas_node_schema',
    'list_toolbox_tools',
    'get_toolbox_state',
    'list_camera_stage_projects',
    'get_camera_stage_project',
    'list_storyboard_projects',
    'get_storyboard_project',
    'query_assets',
    'get_asset',
    'list_asset_libraries',
    'list_asset_tags',
    'search_models',
    'get_model_schema',
    'prepare_generation_task',
  ]
  if (generationReady) queries.push('get_generation_task')

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
    availableQueries: queries,
    capturedAt: new Date().toISOString(),
  })
}
