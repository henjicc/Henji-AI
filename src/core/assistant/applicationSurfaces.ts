export const APPLICATION_SURFACE_IDS = [
  'workspace.generation', 'workspace.canvas', 'workspace.tools', 'workspace.assets',
  'tool.image_edit', 'tool.camera_stage',
  'settings.general', 'settings.general.basic', 'settings.storage', 'settings.api_keys', 'settings.upload',
  'settings.general.behavior', 'settings.general.maintenance',
  'settings.llm', 'settings.assistant_preferences',
  'settings.models', 'settings.interface', 'settings.interface.layout', 'settings.interface.theme',
  'settings.interface.assets', 'settings.interface.canvas', 'overlay.assets',
] as const

export type ApplicationSurfaceId = (typeof APPLICATION_SURFACE_IDS)[number]

export type SurfaceObservationStrategy =
  | 'native_media_preferred'
  | 'specialized_region'
  | 'registered_region'

/**
 * Surface 观察画像的唯一来源。
 *
 * 之前 `surfaceCatalog.ts`（运行时捕获策略）和 `applicationControlCoverage.ts`（覆盖清单）
 * 各写了一份提供者与敏感度判断，两边已经出现过 `workspace.assets` 模态不一致的漂移。
 * 新增 Surface 只改这里，两个消费方自动一致。
 */
export interface SurfaceObservationProfile {
  providerId: string
  strategy: SurfaceObservationStrategy
  dataClass: 'C1' | 'C2'
  maskPolicyId: 'surface.mask_declared_fields' | 'surface.mask_sensitive_fields'
  modalities: readonly ('image' | 'video' | 'audio')[]
}

const NATIVE_MEDIA_SURFACES: readonly string[] = [
  'workspace.generation', 'workspace.assets', 'overlay.assets',
]
const SPECIALIZED_REGION_SURFACES: readonly string[] = [
  'tool.camera_stage', 'tool.image_edit', 'workspace.canvas',
]
// 助手偏好分区含用户指令编辑器和会带出本地路径的状态行，用户可能在其中写入凭据；
// 文本链路的脱敏管不到截图，因此与密钥、存储路径同等对待。
const SENSITIVE_SURFACES: readonly string[] = [
  'settings.api_keys', 'settings.storage', 'settings.assistant_preferences',
]

const SPECIALIZED_PROVIDER_IDS: Readonly<Record<string, string>> = {
  'tool.camera_stage': 'camera_stage.viewport_observer',
  'tool.image_edit': 'image_edit.canvas_observer',
  'workspace.canvas': 'canvas.viewport_observer',
  'workspace.generation': 'generation.result_observer',
  'workspace.assets': 'assets.media_observer',
  'overlay.assets': 'assets.media_observer',
}

export function resolveSurfaceObservationProfile(surfaceId: string): SurfaceObservationProfile {
  const nativeMedia = NATIVE_MEDIA_SURFACES.includes(surfaceId)
  const sensitive = SENSITIVE_SURFACES.includes(surfaceId)
  return {
    providerId: SPECIALIZED_PROVIDER_IDS[surfaceId] ?? 'surface.region_observer',
    strategy: nativeMedia
      ? 'native_media_preferred'
      : SPECIALIZED_REGION_SURFACES.includes(surfaceId) ? 'specialized_region' : 'registered_region',
    dataClass: sensitive ? 'C2' : 'C1',
    maskPolicyId: sensitive ? 'surface.mask_sensitive_fields' : 'surface.mask_declared_fields',
    // 原生媒体 Surface 直接返回素材原件，视频和音频同样可以被观察模型消费。
    modalities: nativeMedia ? ['image', 'video', 'audio'] : ['image'],
  }
}

export function prefersNativeMediaObservation(surfaceId: string): boolean {
  return NATIVE_MEDIA_SURFACES.includes(surfaceId)
}
