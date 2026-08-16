import type { StageVec3 } from '../domain/sceneTypes'
import type { StageCameraMovePreset, StageSpatialPath } from '../domain/stateKeyframeTypes'

export interface CameraStagePathActions {
  setStateKeyframeSpatialPath: (stateKeyframeId: string, objectId: string, path: StageSpatialPath | undefined) => void
  applyCameraPathPreset: (stateKeyframeId: string, objectId: string, preset: StageCameraMovePreset) => void
  setStateKeyframePathAnchor: (
    stateKeyframeId: string,
    objectId: string,
    endpoint: 'start' | 'end',
    position: StageVec3,
  ) => void
}
