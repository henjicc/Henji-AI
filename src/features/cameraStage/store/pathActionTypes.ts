import type { StageVec3 } from '../domain/sceneTypes'
import type { StageCameraMovePreset, StageSpatialPath } from '../domain/shotTypes'

export interface CameraStagePathActions {
  setShotSpatialPath: (shotId: string, objectId: string, path: StageSpatialPath | undefined) => void
  applyCameraPathPreset: (shotId: string, objectId: string, preset: StageCameraMovePreset) => void
  setShotPathAnchor: (
    shotId: string,
    objectId: string,
    endpoint: 'start' | 'end',
    position: StageVec3,
  ) => void
}
