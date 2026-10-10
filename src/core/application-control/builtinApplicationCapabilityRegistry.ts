import { resampleImageEditCapability } from './domains/imageEdit/imageEditGeometryCapabilities'
import { paintImageEditTargetCapability } from './domains/imageEdit/imageEditPaintCapabilities'
import { convertImageEditFilterScopeCapability } from './domains/imageEdit/imageEditFilterCapabilities'
import { computeImageEditSelectionCapability } from './domains/imageEdit/imageEditAdvancedSelectionCapabilities'
import { selectImageEditRegionCapability } from './domains/imageEdit/imageEditSubjectCapabilities'
import { AUDIO_EDIT_APPLICATION_CAPABILITIES } from './domains/audioEdit/audioEditApplicationCapabilities'
import { VIDEO_EDIT_APPLICATION_CAPABILITIES } from './domains/videoEdit/videoEditApplicationCapabilities'
import {
  ApplicationCapabilityRegistry,
  type ApplicationCapabilityDefinition,
} from './applicationCapabilities'
import {
  closeApplicationSurfaceCapability,
  focusApplicationEntityCapability,
  getCurrentApplicationContextCapability,
  listGenerationHistoryCapability,
  openApplicationSurfaceCapability,
  openImageEditorWithSourceCapability,
  observeApplicationSurfaceCapability,
} from './builtinApplicationCapabilities'
import { SETTINGS_APPLICATION_CAPABILITIES } from './domains/settings/settingsApplicationCapabilities'
import { cancelLocalModelDownloadCapability } from './domains/localModels/localModelCapabilities'
import { ASSET_APPLICATION_CAPABILITIES } from './domains/asset/assetApplicationCapabilities'
import { CAMERA_STAGE_APPLICATION_CAPABILITIES } from './domains/cameraStage/cameraStageApplicationCapabilities'
import { APPLICATION_REFLECTION_APPLICATION_CAPABILITIES } from './domains/shared/applicationReflectionApplicationCapabilities'
import { CANVAS_BATCH_APPLICATION_CAPABILITIES } from './domains/canvas/canvasBatchApplicationCapabilities'
import { CANVAS_EXPORT_APPLICATION_CAPABILITIES } from './domains/canvas/canvasExportApplicationCapabilities'
import { CANVAS_EDITOR_APPLICATION_CAPABILITIES } from './domains/canvas/canvasEditorApplicationCapabilities'
import { CANVAS_MUTATION_APPLICATION_CAPABILITIES } from './domains/canvas/canvasMutationApplicationCapabilities'
import { CANVAS_PROJECT_APPLICATION_CAPABILITIES } from './domains/canvas/canvasProjectApplicationCapabilities'
import { GENERATION_APPLICATION_CAPABILITIES } from './domains/generation/generationApplicationCapabilities'
import { TOOLBOX_APPLICATION_CAPABILITIES } from './domains/toolbox/toolboxApplicationCapabilities'
import {
  ASSISTANT_SKILL_APPLICATION_CAPABILITIES,
} from './domains/assistantSkill/assistantSkillApplicationCapabilities'
import { IMAGE_MARK_APPLICATION_CAPABILITIES } from './domains/imageMark/imageMarkApplicationCapabilities'
import { applyImageEditSelectionCapability } from './domains/imageEdit/imageEditSelectionCapabilities'
import { IMAGE_EDIT_REPAIR_CAPABILITIES } from './domains/imageEdit/imageEditRepairCapabilities'
import { IMAGE_EDIT_OUTPAINT_CAPABILITIES } from './domains/imageEdit/imageEditOutpaintCapabilities'
import { DOCUMENTS_APPLICATION_CAPABILITIES } from './domains/documents/documentsApplicationCapabilities'

export const BUILTIN_APPLICATION_CAPABILITIES: ApplicationCapabilityDefinition[] = [
  getCurrentApplicationContextCapability,
  observeApplicationSurfaceCapability,
  openApplicationSurfaceCapability,
  closeApplicationSurfaceCapability,
  focusApplicationEntityCapability,
  ...SETTINGS_APPLICATION_CAPABILITIES,
  cancelLocalModelDownloadCapability,
  listGenerationHistoryCapability,
  openImageEditorWithSourceCapability,
  ...GENERATION_APPLICATION_CAPABILITIES,
  ...ASSET_APPLICATION_CAPABILITIES,
  ...CANVAS_PROJECT_APPLICATION_CAPABILITIES,
  ...CANVAS_EDITOR_APPLICATION_CAPABILITIES,
  ...CANVAS_MUTATION_APPLICATION_CAPABILITIES,
  ...CANVAS_BATCH_APPLICATION_CAPABILITIES,
  ...CANVAS_EXPORT_APPLICATION_CAPABILITIES,
  ...CAMERA_STAGE_APPLICATION_CAPABILITIES,
  ...IMAGE_MARK_APPLICATION_CAPABILITIES,
  applyImageEditSelectionCapability,
  computeImageEditSelectionCapability,
  paintImageEditTargetCapability,
  convertImageEditFilterScopeCapability,
  ...IMAGE_EDIT_REPAIR_CAPABILITIES,
  ...IMAGE_EDIT_OUTPAINT_CAPABILITIES,
  resampleImageEditCapability,
  selectImageEditRegionCapability,
  // 通用反射能力：领域只要注册实体和属性，助手就能读改增删，不必再写专用能力
  ...APPLICATION_REFLECTION_APPLICATION_CAPABILITIES,
  ...TOOLBOX_APPLICATION_CAPABILITIES,
  ...AUDIO_EDIT_APPLICATION_CAPABILITIES,
  ...VIDEO_EDIT_APPLICATION_CAPABILITIES,
  ...ASSISTANT_SKILL_APPLICATION_CAPABILITIES,
  // 通用文档与项目（存储底座 2.5）：各工具的项目管理能力在 3.x 接入时删除，统一走这里
  ...DOCUMENTS_APPLICATION_CAPABILITIES,
]

export const BUILTIN_APPLICATION_CAPABILITY_REGISTRY = new ApplicationCapabilityRegistry()
for (const capability of BUILTIN_APPLICATION_CAPABILITIES) {
  BUILTIN_APPLICATION_CAPABILITY_REGISTRY.register(capability)
}
