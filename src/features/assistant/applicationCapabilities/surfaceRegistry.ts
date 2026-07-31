import type { ApplicationRef } from '@/core/assistant/applicationCapabilities'
import { createLogger } from '@/core/logging'
import type { SettingsNavigationTarget } from '@/core/types/settingsNavigation'
import type { WorkspaceId } from '@/core/types/workspace'
import { useAssetLibraryStore } from '@/features/assets/store/assetLibraryStore'
import { closeAssetLibrary, openAssetLibrary, selectToolboxTool, switchWorkspace } from '@/stores/navigationStore'
import { openSettingsPanel, useUiStore } from '@/stores/uiStore'

import {
  focusCanvasNodeFromAgent,
  openCanvasProjectFromAgent,
} from '@/features/canvas/application/agentCanvasActions'
import { selectAssetFromAgent } from '../hostActions'
import { createHostContextSnapshot } from '../hostContext/hostContext'
import type { CapabilityExecutionContext } from './handlerTypes'

interface ApplicationSurfaceDefinition {
  id: string
  kind: 'workspace' | 'tool' | 'settings' | 'overlay'
  workspace?: WorkspaceId
  toolId?: 'cameraStage' | 'imageMark'
  settingsTarget?: SettingsNavigationTarget
}

const surfaces: ApplicationSurfaceDefinition[] = [
  { id: 'workspace.generation', kind: 'workspace', workspace: 'generation' },
  { id: 'workspace.canvas', kind: 'workspace', workspace: 'nodes' },
  { id: 'workspace.tools', kind: 'workspace', workspace: 'tools' },
  { id: 'workspace.assets', kind: 'workspace', workspace: 'assets' },
  { id: 'tool.image_edit', kind: 'tool', workspace: 'tools', toolId: 'imageMark' },
  { id: 'tool.camera_stage', kind: 'tool', workspace: 'tools', toolId: 'cameraStage' },
  { id: 'settings.general', kind: 'settings', settingsTarget: { tab: 'general' } },
  { id: 'settings.general.basic', kind: 'settings', settingsTarget: { tab: 'general', sectionId: 'general-basic' } },
  { id: 'settings.storage', kind: 'settings', settingsTarget: { tab: 'general', sectionId: 'general-storage' } },
  { id: 'settings.general.behavior', kind: 'settings', settingsTarget: { tab: 'general', sectionId: 'general-behavior' } },
  { id: 'settings.general.maintenance', kind: 'settings', settingsTarget: { tab: 'general', sectionId: 'general-maintenance' } },
  { id: 'settings.api_keys', kind: 'settings', settingsTarget: { tab: 'api', sectionId: 'api-keys' } },
  { id: 'settings.upload', kind: 'settings', settingsTarget: { tab: 'api', sectionId: 'api-upload' } },
  { id: 'settings.llm', kind: 'settings', settingsTarget: { tab: 'api', sectionId: 'api-llm' } },
  { id: 'settings.assistant_preferences', kind: 'settings', settingsTarget: { tab: 'api', sectionId: 'api-agent-preferences' } },
  { id: 'settings.models', kind: 'settings', settingsTarget: { tab: 'models', sectionId: 'models-visibility' } },
  { id: 'settings.interface', kind: 'settings', settingsTarget: { tab: 'interface' } },
  { id: 'settings.interface.layout', kind: 'settings', settingsTarget: { tab: 'interface', sectionId: 'interface-layout' } },
  { id: 'settings.interface.theme', kind: 'settings', settingsTarget: { tab: 'interface', sectionId: 'interface-theme' } },
  { id: 'settings.interface.assets', kind: 'settings', settingsTarget: { tab: 'interface', sectionId: 'interface-assets' } },
  { id: 'settings.interface.canvas', kind: 'settings', settingsTarget: { tab: 'interface', sectionId: 'interface-canvas' } },
  { id: 'overlay.assets', kind: 'overlay' },
]

const surfaceMap = new Map(surfaces.map((surface) => [surface.id, surface]))
const logger = createLogger('features.assistant.surfaces')

function settingsTargetMatches(
  current: SettingsNavigationTarget | null,
  expected: SettingsNavigationTarget
): boolean {
  return current?.tab === expected.tab
    && (current.sectionId ?? null) === (expected.sectionId ?? null)
}

function isSurfaceActive(surface: ApplicationSurfaceDefinition): boolean {
  if (surface.settingsTarget) {
    const ui = useUiStore.getState()
    return ui.isSettingsOpen && settingsTargetMatches(ui.settingsTarget, surface.settingsTarget)
  }
  if (surface.id === 'overlay.assets') {
    return useAssetLibraryStore.getState().view === 'floating'
  }
  return createHostContextSnapshot().surface?.id === surface.id
}

export function listApplicationSurfaces(): ReadonlyArray<ApplicationSurfaceDefinition> {
  return surfaces
}

type SurfaceLogContext = Pick<CapabilityExecutionContext, 'requestId' | 'taskId'>

function getSurfaceLogContext(correlation: SurfaceLogContext): SurfaceLogContext {
  return {
    requestId: correlation.requestId,
    taskId: correlation.taskId,
  }
}

export function openApplicationSurface(
  surfaceId: string,
  correlation: SurfaceLogContext = {}
): Record<string, unknown> {
  const surface = surfaceMap.get(surfaceId)
  if (!surface) throw new Error('NOT_FOUND')
  logger.info('应用 Surface 打开开始', {
    event: 'assistant.surface.open.start',
    ...getSurfaceLogContext(correlation),
    surfaceId,
  })
  try {
    if (surface.settingsTarget) {
      openSettingsPanel(surface.settingsTarget)
    } else if (surface.id === 'overlay.assets') {
      openAssetLibrary('floating')
    } else {
      if (surface.workspace) switchWorkspace(surface.workspace)
      if (surface.toolId) selectToolboxTool(surface.toolId)
    }
    if (!isSurfaceActive(surface)) throw new Error('SURFACE_NOT_OPEN')
    logger.info('应用 Surface 打开完成', {
      event: 'assistant.surface.open.completed',
      ...getSurfaceLogContext(correlation),
      surfaceId,
      actualSurfaceId: createHostContextSnapshot().surface?.id,
    })
    return { surfaceId }
  } catch (error) {
    logger.error('应用 Surface 打开失败', error, {
      event: 'assistant.surface.open.failed',
      ...getSurfaceLogContext(correlation),
      surfaceId,
      actualSurfaceId: createHostContextSnapshot().surface?.id,
    })
    throw error
  }
}

export function closeApplicationSurface(surfaceId?: string): Record<string, unknown> {
  const current = createHostContextSnapshot()
  const targetId = surfaceId ?? current.surface?.id
  if (targetId?.startsWith('settings.')) {
    useUiStore.getState().closeSettings()
  } else if (targetId === 'overlay.assets' || targetId === 'workspace.assets') {
    closeAssetLibrary()
  } else if (targetId?.startsWith('tool.')) {
    selectToolboxTool(null)
  }
  return { closedSurfaceId: targetId ?? null }
}

export async function focusApplicationEntity(
  ref: ApplicationRef,
  signal: AbortSignal,
  correlation: SurfaceLogContext = {}
): Promise<Record<string, unknown>> {
  if (ref.kind === 'generation.record' || ref.kind === 'generation.result') {
    return { ref, ...openApplicationSurface('workspace.generation', correlation) }
  }
  if (ref.kind === 'asset') {
    await selectAssetFromAgent(ref.id)
    const surface = openApplicationSurface('workspace.assets', correlation)
    return { ref, ...surface }
  }
  if (ref.kind === 'canvas.project') {
    await openCanvasProjectFromAgent(ref.id, signal)
    return { ref, ...openApplicationSurface('workspace.canvas', correlation) }
  }
  if (ref.kind === 'canvas.node') {
    const separator = ref.id.indexOf(':')
    if (separator < 1) throw new Error('INVALID_INPUT')
    const projectId = ref.id.slice(0, separator)
    const nodeId = ref.id.slice(separator + 1)
    await openCanvasProjectFromAgent(projectId, signal)
    const surface = openApplicationSurface('workspace.canvas', correlation)
    await focusCanvasNodeFromAgent(projectId, nodeId, signal)
    return { ref, ...surface }
  }
  throw new Error('INVALID_INPUT')
}
