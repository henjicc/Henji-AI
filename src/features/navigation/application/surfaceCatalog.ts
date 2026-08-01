import type { SettingsNavigationTarget } from '@/core/types/settingsNavigation'
import type { WorkspaceId } from '@/core/types/workspace'

export type SurfaceOpenPolicy = 'immediate' | 'after_target_resolved' | 'background_preferred'
export type SurfacePresentationDecision =
  | 'show_now'
  | 'resolve_target_first'
  | 'no_switch'
  | 'preserve_user_takeover'
  | 'unavailable'

export interface ApplicationSurfaceDefinition {
  id: string
  kind: 'workspace' | 'tool' | 'settings' | 'overlay'
  workspace?: WorkspaceId
  toolId?: 'cameraStage' | 'imageMark'
  settingsTarget?: SettingsNavigationTarget
  acceptedRefKinds: string[]
  openPolicy: SurfaceOpenPolicy
  availability: string[]
  observationCapabilityId?: string
  observationProviderId?: string
}

const immediate = {
  acceptedRefKinds: [],
  openPolicy: 'immediate' as const,
  availability: ['应用界面已就绪。'],
}

export const APPLICATION_SURFACE_DEFINITIONS: readonly ApplicationSurfaceDefinition[] = [
  { id: 'workspace.generation', kind: 'workspace', workspace: 'generation', ...immediate },
  {
    id: 'workspace.canvas', kind: 'workspace', workspace: 'nodes', ...immediate,
    acceptedRefKinds: ['canvas.project', 'canvas.node', 'canvas.edge'],
    openPolicy: 'after_target_resolved',
  },
  { id: 'workspace.tools', kind: 'workspace', workspace: 'tools', ...immediate },
  {
    id: 'workspace.assets', kind: 'workspace', workspace: 'assets', ...immediate,
    acceptedRefKinds: ['asset', 'asset.library'],
  },
  {
    id: 'tool.image_edit', kind: 'tool', workspace: 'tools', toolId: 'imageMark', ...immediate,
    acceptedRefKinds: ['image_edit.document', 'image_edit.layer', 'generation.result', 'asset'],
    openPolicy: 'after_target_resolved',
  },
  {
    id: 'tool.camera_stage', kind: 'tool', workspace: 'tools', toolId: 'cameraStage', ...immediate,
    acceptedRefKinds: [
      'camera_stage.project', 'camera_stage.scene', 'camera_stage.object', 'camera_stage.camera',
      'camera_stage.shot', 'camera_stage.trajectory', 'camera_stage.keyframe',
    ],
    openPolicy: 'after_target_resolved',
    observationCapabilityId: 'observe_camera_stage_viewport',
    observationProviderId: 'camera_stage.viewport_observer',
  },
  { id: 'settings.general', kind: 'settings', settingsTarget: { tab: 'general' }, ...immediate },
  { id: 'settings.general.basic', kind: 'settings', settingsTarget: { tab: 'general', sectionId: 'general-basic' }, ...immediate },
  { id: 'settings.storage', kind: 'settings', settingsTarget: { tab: 'general', sectionId: 'general-storage' }, ...immediate },
  { id: 'settings.general.behavior', kind: 'settings', settingsTarget: { tab: 'general', sectionId: 'general-behavior' }, ...immediate },
  { id: 'settings.general.maintenance', kind: 'settings', settingsTarget: { tab: 'general', sectionId: 'general-maintenance' }, ...immediate },
  { id: 'settings.api_keys', kind: 'settings', settingsTarget: { tab: 'api', sectionId: 'api-keys' }, ...immediate },
  { id: 'settings.upload', kind: 'settings', settingsTarget: { tab: 'api', sectionId: 'api-upload' }, ...immediate },
  { id: 'settings.llm', kind: 'settings', settingsTarget: { tab: 'api', sectionId: 'api-llm' }, ...immediate },
  { id: 'settings.assistant_preferences', kind: 'settings', settingsTarget: { tab: 'api', sectionId: 'api-agent-preferences' }, ...immediate },
  { id: 'settings.models', kind: 'settings', settingsTarget: { tab: 'models', sectionId: 'models-visibility' }, ...immediate },
  { id: 'settings.interface', kind: 'settings', settingsTarget: { tab: 'interface' }, ...immediate },
  { id: 'settings.interface.layout', kind: 'settings', settingsTarget: { tab: 'interface', sectionId: 'interface-layout' }, ...immediate },
  { id: 'settings.interface.theme', kind: 'settings', settingsTarget: { tab: 'interface', sectionId: 'interface-theme' }, ...immediate },
  { id: 'settings.interface.assets', kind: 'settings', settingsTarget: { tab: 'interface', sectionId: 'interface-assets' }, ...immediate },
  { id: 'settings.interface.canvas', kind: 'settings', settingsTarget: { tab: 'interface', sectionId: 'interface-canvas' }, ...immediate },
  {
    id: 'overlay.assets', kind: 'overlay', ...immediate,
    acceptedRefKinds: ['asset'],
    openPolicy: 'background_preferred',
  },
]

const surfaceMap = new Map(APPLICATION_SURFACE_DEFINITIONS.map((surface) => [surface.id, surface]))
if (surfaceMap.size !== APPLICATION_SURFACE_DEFINITIONS.length) throw new Error('应用 Surface ID 重复')

export function listApplicationSurfaces(): readonly ApplicationSurfaceDefinition[] {
  return APPLICATION_SURFACE_DEFINITIONS
}

export function getApplicationSurface(surfaceId: string): ApplicationSurfaceDefinition | null {
  return surfaceMap.get(surfaceId) ?? null
}

export function resolveSurfaceForRefKind(refKind: string): ApplicationSurfaceDefinition | null {
  return APPLICATION_SURFACE_DEFINITIONS.find((surface) => surface.acceptedRefKinds.includes(refKind)) ?? null
}

export function decideSurfacePresentation(input: {
  surfaceId: string
  hasStableTarget: boolean
  alreadyActive: boolean
  userTookOver: boolean
  available?: boolean
}): SurfacePresentationDecision {
  const surface = getApplicationSurface(input.surfaceId)
  if (!surface || input.available === false) return 'unavailable'
  if (input.userTookOver) return 'preserve_user_takeover'
  if (input.alreadyActive || surface.openPolicy === 'background_preferred') return 'no_switch'
  if (surface.openPolicy === 'after_target_resolved' && !input.hasStableTarget) {
    return 'resolve_target_first'
  }
  return 'show_now'
}
