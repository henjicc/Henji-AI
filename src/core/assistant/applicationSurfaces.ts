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
