export const STAGE_VIEWPORT_IDS = ['perspective', 'top', 'front', 'right'] as const

export type StageViewportId = typeof STAGE_VIEWPORT_IDS[number]
export type StageFixedView = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right'

export type StageViewportSource =
  | { kind: 'director' }
  | { kind: 'fixed'; view: StageFixedView }
  | { kind: 'camera'; cameraId: string }

export interface StageViewportConfig {
  id: StageViewportId
  source: StageViewportSource
}

export const DEFAULT_STAGE_VIEWPORTS: Record<StageViewportId, StageViewportConfig> = {
  perspective: { id: 'perspective', source: { kind: 'director' } },
  top: { id: 'top', source: { kind: 'fixed', view: 'top' } },
  front: { id: 'front', source: { kind: 'fixed', view: 'front' } },
  right: { id: 'right', source: { kind: 'fixed', view: 'right' } },
}

export function cloneDefaultStageViewports(): Record<StageViewportId, StageViewportConfig> {
  return structuredClone(DEFAULT_STAGE_VIEWPORTS)
}
