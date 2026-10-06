import type { ApplicationCapabilityDefinition } from '../../applicationCapabilities'
import { CAMERA_STAGE_MOTION_APPLICATION_CAPABILITIES } from './cameraStageMotionApplicationCapabilities'
import { CAMERA_STAGE_RENDER_APPLICATION_CAPABILITIES } from './cameraStageRenderApplicationCapabilities'
import { CAMERA_STAGE_SCENE_APPLICATION_CAPABILITIES } from './cameraStageSceneApplicationCapabilities'

/*
 * 镜头参考的内容能力（场景、运镜、渲染）。文档本身的列出、新建、打开、改名、移动、副本、删除
 * 由通用文档能力承担（domains/documents，3.2 删除了本工具的项目管理能力）；这里的 documentId 都是镜头参考文档 ID。
 */
export const CAMERA_STAGE_APPLICATION_CAPABILITIES: ApplicationCapabilityDefinition[] = [
  ...CAMERA_STAGE_SCENE_APPLICATION_CAPABILITIES,
  ...CAMERA_STAGE_MOTION_APPLICATION_CAPABILITIES,
  ...CAMERA_STAGE_RENDER_APPLICATION_CAPABILITIES,
]
