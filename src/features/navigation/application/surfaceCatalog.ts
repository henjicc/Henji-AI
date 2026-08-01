import type { SettingsNavigationTarget } from '@/core/types/settingsNavigation'
import type { WorkspaceId } from '@/core/types/workspace'
import type { ApplicationSurfaceId } from '@/core/assistant/applicationSurfaces'

export type SurfaceOpenPolicy = 'immediate' | 'after_target_resolved' | 'background_preferred'
export type SurfacePresentationDecision =
  | 'show_now'
  | 'resolve_target_first'
  | 'no_switch'
  | 'preserve_user_takeover'
  | 'unavailable'

export interface ApplicationSurfaceDefinition {
  id: ApplicationSurfaceId
  kind: 'workspace' | 'tool' | 'settings' | 'overlay'
  workspace?: WorkspaceId
  toolId?: 'cameraStage' | 'imageMark'
  settingsTarget?: SettingsNavigationTarget
  acceptedRefKinds: readonly string[]
  openPolicy: SurfaceOpenPolicy
  availability: readonly string[]
  observationCapabilityId: 'observe_application_surface'
  observationProviderId: string
  observationPolicy: {
    strategy: 'native_media_preferred' | 'specialized_region' | 'registered_region'
    captureScope: 'native_media_or_surface' | 'registered_surface' | 'specialized_region'
    dataClass: 'C1' | 'C2'
    maskPolicyId: 'surface.mask_declared_fields' | 'surface.mask_sensitive_fields'
    supportedModalities: readonly ('image' | 'video' | 'audio')[]
    maxEdge: number
    invalidWhen: readonly string[]
  }
}

const immediate = {
  acceptedRefKinds: [],
  openPolicy: 'immediate' as const,
  availability: ['应用界面已就绪。'],
}

function observationProviderId(surfaceId: string): string {
  if (surfaceId === 'tool.camera_stage') return 'camera_stage.viewport_observer'
  if (surfaceId === 'tool.image_edit') return 'image_edit.canvas_observer'
  if (surfaceId === 'workspace.canvas') return 'canvas.viewport_observer'
  if (surfaceId === 'workspace.generation') return 'generation.result_observer'
  if (surfaceId === 'workspace.assets' || surfaceId === 'overlay.assets') return 'assets.media_observer'
  return 'surface.region_observer'
}

function observationPolicy(surfaceId: ApplicationSurfaceId): ApplicationSurfaceDefinition['observationPolicy'] {
  const nativeMedia = ['workspace.generation', 'workspace.assets', 'overlay.assets'].includes(surfaceId)
  const specialized = ['tool.camera_stage', 'tool.image_edit', 'workspace.canvas'].includes(surfaceId)
  const sensitive = surfaceId === 'settings.api_keys' || surfaceId === 'settings.storage'
  return {
    strategy: nativeMedia ? 'native_media_preferred' : specialized ? 'specialized_region' : 'registered_region',
    captureScope: nativeMedia ? 'native_media_or_surface' : specialized ? 'specialized_region' : 'registered_surface',
    dataClass: sensitive ? 'C2' : 'C1',
    maskPolicyId: sensitive ? 'surface.mask_sensitive_fields' : 'surface.mask_declared_fields',
    supportedModalities: nativeMedia ? ['image', 'video', 'audio'] : ['image'],
    maxEdge: 1_600,
    invalidWhen: ['目标 Surface 不可见。', '稳定媒体引用失效。', '用户取消观察。'],
  }
}

const surfaceDefinitions = [
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
] as const

export const APPLICATION_SURFACE_DEFINITIONS: readonly ApplicationSurfaceDefinition[] = surfaceDefinitions.map(
  (surface) => ({
    ...surface,
    observationCapabilityId: 'observe_application_surface',
    observationProviderId: observationProviderId(surface.id),
    observationPolicy: observationPolicy(surface.id),
  })
)

const surfaceMap = new Map<string, ApplicationSurfaceDefinition>(
  APPLICATION_SURFACE_DEFINITIONS.map((surface) => [surface.id, surface])
)
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
