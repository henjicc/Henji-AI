export const APPLICATION_SURFACE_IDS = [
  'workspace.generation', 'workspace.canvas', 'workspace.tools', 'workspace.assets',
  'tool.image_edit', 'tool.camera_stage',
  'settings.general', 'settings.storage', 'settings.api_keys', 'settings.upload',
  'settings.models', 'settings.interface', 'settings.interface.theme',
  'settings.interface.assets', 'settings.interface.canvas', 'overlay.assets',
] as const

export type ApplicationSurfaceId = (typeof APPLICATION_SURFACE_IDS)[number]
