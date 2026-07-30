import type { ApplicationRef } from '@/core/assistant/applicationCapabilities'
import type { SettingsNavigationTarget } from '@/core/types/settingsNavigation'
import type { WorkspaceId } from '@/core/types/workspace'
import { closeAssetLibrary, openAssetLibrary, selectToolboxTool, switchWorkspace } from '@/stores/navigationStore'
import { openSettingsPanel, useUiStore } from '@/stores/uiStore'

import {
  focusCanvasNodeFromAgent,
  openCanvasProjectFromAgent,
} from '@/features/canvas/application/agentCanvasActions'
import { selectAssetFromAgent } from '../hostActions'
import { createHostContextSnapshot } from '../hostContext/hostContext'

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
  { id: 'settings.storage', kind: 'settings', settingsTarget: { tab: 'general', sectionId: 'general-storage' } },
  { id: 'settings.api_keys', kind: 'settings', settingsTarget: { tab: 'api', sectionId: 'api-keys' } },
  { id: 'settings.upload', kind: 'settings', settingsTarget: { tab: 'api', sectionId: 'api-upload' } },
  { id: 'settings.models', kind: 'settings', settingsTarget: { tab: 'models', sectionId: 'models-visibility' } },
  { id: 'settings.interface', kind: 'settings', settingsTarget: { tab: 'interface' } },
  { id: 'settings.interface.theme', kind: 'settings', settingsTarget: { tab: 'interface', sectionId: 'interface-theme' } },
  { id: 'settings.interface.assets', kind: 'settings', settingsTarget: { tab: 'interface', sectionId: 'interface-assets' } },
  { id: 'settings.interface.canvas', kind: 'settings', settingsTarget: { tab: 'interface', sectionId: 'interface-canvas' } },
  { id: 'overlay.assets', kind: 'overlay' },
]

const surfaceMap = new Map(surfaces.map((surface) => [surface.id, surface]))

export function listApplicationSurfaces(): ReadonlyArray<ApplicationSurfaceDefinition> {
  return surfaces
}

export function openApplicationSurface(surfaceId: string): Record<string, unknown> {
  const surface = surfaceMap.get(surfaceId)
  if (!surface) throw new Error('NOT_FOUND')
  if (surface.settingsTarget) {
    openSettingsPanel(surface.settingsTarget)
  } else if (surface.id === 'overlay.assets') {
    openAssetLibrary('floating')
  } else {
    if (surface.workspace) switchWorkspace(surface.workspace)
    if (surface.toolId) selectToolboxTool(surface.toolId)
  }
  return { surfaceId }
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
  signal: AbortSignal
): Promise<Record<string, unknown>> {
  if (ref.kind === 'generation.record' || ref.kind === 'generation.result') {
    switchWorkspace('generation')
    return { ref, surfaceId: 'workspace.generation' }
  }
  if (ref.kind === 'asset') {
    openAssetLibrary('workspace')
    await selectAssetFromAgent(ref.id)
    return { ref, surfaceId: 'workspace.assets' }
  }
  if (ref.kind === 'canvas.project') {
    await openCanvasProjectFromAgent(ref.id, signal)
    return { ref, surfaceId: 'workspace.canvas' }
  }
  if (ref.kind === 'canvas.node') {
    const separator = ref.id.indexOf(':')
    if (separator < 1) throw new Error('INVALID_INPUT')
    const projectId = ref.id.slice(0, separator)
    const nodeId = ref.id.slice(separator + 1)
    await focusCanvasNodeFromAgent(projectId, nodeId, signal)
    return { ref, surfaceId: 'workspace.canvas' }
  }
  throw new Error('INVALID_INPUT')
}
