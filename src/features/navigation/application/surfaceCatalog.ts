import { SETTINGS_REGISTRATION, type SettingsNavigationTarget, type SettingsTabId } from '@/core/types/settingsNavigation'
import { TOOL_DESCRIPTORS, type ToolDescriptor } from '@/core/toolbox/toolCatalog'
import type { ToolboxToolId } from '@/core/types/workspace'
import type { WorkspaceId } from '@/core/types/workspace'
import {
  resolveSurfaceObservationProfile,
  type ApplicationSurfaceId,
} from '@/core/application-control/applicationSurfaces'

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
  toolId?: ToolboxToolId
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

function observationPolicy(surfaceId: ApplicationSurfaceId): ApplicationSurfaceDefinition['observationPolicy'] {
  const profile = resolveSurfaceObservationProfile(surfaceId)
  return {
    strategy: profile.strategy,
    captureScope: profile.strategy === 'native_media_preferred'
      ? 'native_media_or_surface'
      : profile.strategy === 'specialized_region' ? 'specialized_region' : 'registered_surface',
    dataClass: profile.dataClass,
    maskPolicyId: profile.maskPolicyId,
    supportedModalities: profile.modalities,
    maxEdge: 1_600,
    invalidWhen: ['目标 Surface 不可见。', '稳定媒体引用失效。', '用户取消观察。'],
  }
}

/** 工具 Surface 由纯登记派生；观察策略继续使用唯一画像入口。 */
export function createToolboxSurfaces<const T extends readonly ToolDescriptor[]>(tools: T): {
  id: T[number]['surfaceId']; toolId: T[number]['id']; kind: 'tool'; workspace: 'tools';
  acceptedRefKinds: readonly string[]; openPolicy: SurfaceOpenPolicy; availability: string[];
}[] {
  return tools.map((tool) => ({
    id: tool.surfaceId as T[number]['surfaceId'],
    kind: 'tool' as const,
    workspace: 'tools' as const,
    toolId: tool.id as T[number]['id'],
    ...immediate,
    acceptedRefKinds: tool.acceptedRefKinds,
    openPolicy: 'after_target_resolved' as const,
  }))
}

const surfaceDefinitions = [
  { id: 'overlay.assistant', kind: 'overlay', ...immediate },
  { id: 'workspace.generation', kind: 'workspace', workspace: 'generation', ...immediate },
  {
    id: 'workspace.canvas', kind: 'workspace', workspace: 'nodes', ...immediate,
    acceptedRefKinds: ['canvas.document', 'canvas.node', 'canvas.edge'],
    openPolicy: 'after_target_resolved',
  },
  { id: 'workspace.tools', kind: 'workspace', workspace: 'tools', ...immediate },
  { id: 'workspace.video_edit', kind: 'workspace', workspace: 'videoEdit', ...immediate, acceptedRefKinds: ['video_edit.document', 'video_edit.clip', 'video_edit.annotation'] },
  {
    id: 'workspace.assets', kind: 'workspace', workspace: 'assets', ...immediate,
    acceptedRefKinds: ['asset', 'asset.library'],
  },
  ...createToolboxSurfaces(TOOL_DESCRIPTORS),
  ...SETTINGS_REGISTRATION.surfaces.map(surface => ({ ...immediate, ...surface, kind: 'settings' as const })),
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
    observationProviderId: resolveSurfaceObservationProfile(surface.id).providerId,
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

/**
 * 设置弹窗当前可见分区对应的 Surface ID。
 *
 * 设置界面必须用这个入口标注 `data-application-surface-id`，不要在组件里另写一份
 * sectionId 映射：目录是唯一来源，新增分区只要在这里登记就同时获得导航和观察。
 * 分区尚未登记 Surface 时返回 null，由调用方决定是否退回大类 Surface。
 */
export function resolveSettingsSurfaceId(
  tab: SettingsTabId,
  sectionId?: string
): ApplicationSurfaceId | null {
  const bySection = sectionId
    ? APPLICATION_SURFACE_DEFINITIONS.find((surface) => (
      surface.settingsTarget?.tab === tab && surface.settingsTarget.sectionId === sectionId
    ))
    : undefined
  // 大类本身没有登记 Surface 时（api/models），退回该大类第一个分区 Surface，
  // 而不是退回不相关的 settings.general，避免观察结果标错来源。
  const tabSurfaces = APPLICATION_SURFACE_DEFINITIONS.filter((surface) => surface.settingsTarget?.tab === tab)
  const byTab = tabSurfaces.find((surface) => !surface.settingsTarget?.sectionId) ?? tabSurfaces[0]
  return (bySection ?? byTab)?.id ?? null
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
