import type { ApplicationCapabilityDefinition } from '../applicationCapabilities'
import { CAMERA_STAGE_MOTION_APPLICATION_CAPABILITIES } from './cameraStageMotionApplicationCapabilities'
import { CAMERA_STAGE_PROJECT_APPLICATION_CAPABILITIES } from './cameraStageProjectApplicationCapabilities'
import { CAMERA_STAGE_SCENE_APPLICATION_CAPABILITIES } from './cameraStageSceneApplicationCapabilities'

export const CAMERA_STAGE_APPLICATION_CAPABILITIES: ApplicationCapabilityDefinition[] = [
  ...CAMERA_STAGE_PROJECT_APPLICATION_CAPABILITIES,
  ...CAMERA_STAGE_SCENE_APPLICATION_CAPABILITIES,
  ...CAMERA_STAGE_MOTION_APPLICATION_CAPABILITIES,
]
