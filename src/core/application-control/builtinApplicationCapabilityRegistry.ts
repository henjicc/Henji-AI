import type { ApplicationCapabilityMigration } from './coverage'
import { APPLICATION_SURFACE_IDS } from './applicationSurfaces'
import { MEMORY_CAPABILITIES } from './domains/assistantMemory/memoryCapabilities'
import { resampleImageEditCapability } from './domains/imageEdit/imageEditGeometryCapabilities'
import { CREATIVE_INTENT_CAPABILITIES } from './domains/creativeIntent/creativeIntentCapabilities'
import { imageEditClipboardCapability } from './domains/imageEdit/imageEditClipboardCapabilities'
import { paintImageEditTargetCapability } from './domains/imageEdit/imageEditPaintCapabilities'
import { convertImageEditFilterScopeCapability } from './domains/imageEdit/imageEditFilterCapabilities'
import { computeImageEditSelectionCapability } from './domains/imageEdit/imageEditAdvancedSelectionCapabilities'
import { selectImageEditRegionCapability } from './domains/imageEdit/imageEditSubjectCapabilities'
import { analyzeImageEditColorCapability, exportImageEditColorLutCapability, observeImageEditColorCapability } from './domains/imageEdit/imageEditColorCapabilities'
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
import { SOUND_LIBRARY_APPLICATION_CAPABILITIES } from './domains/soundLibrary/soundLibraryCapabilities'
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
import { RECORDING_CAPABILITIES } from './domains/screenRecording/recordingCapabilities'

export const BUILTIN_APPLICATION_CAPABILITIES: ApplicationCapabilityDefinition[] = [
  ...MEMORY_CAPABILITIES,
  ...RECORDING_CAPABILITIES,
  ...CREATIVE_INTENT_CAPABILITIES,
  getCurrentApplicationContextCapability,
  observeApplicationSurfaceCapability,
  openApplicationSurfaceCapability,
  closeApplicationSurfaceCapability,
  focusApplicationEntityCapability,
  ...SETTINGS_APPLICATION_CAPABILITIES,
  cancelLocalModelDownloadCapability,
  ...SOUND_LIBRARY_APPLICATION_CAPABILITIES,
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
  imageEditClipboardCapability,
  computeImageEditSelectionCapability,
  paintImageEditTargetCapability,
  convertImageEditFilterScopeCapability,
  ...IMAGE_EDIT_REPAIR_CAPABILITIES,
  ...IMAGE_EDIT_OUTPAINT_CAPABILITIES,
  resampleImageEditCapability,
  selectImageEditRegionCapability,
  observeImageEditColorCapability,
  analyzeImageEditColorCapability,
  exportImageEditColorLutCapability,
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

/** 领域登记附带独立的审计来源；实体与操作名称由实际注册结果派生，不再抄写。 */
export interface ApplicationDomainCoverageMetadata {
  migrationTask: string
  formalService: string
  propertySources: string[]
  operationSource: string
  targetKind: ApplicationCapabilityMigration['targetKind']
  surfaceIds: string[]
}

export const BUILTIN_APPLICATION_DOMAIN_METADATA: Readonly<Record<string, ApplicationDomainCoverageMetadata>> = {
  memory: { migrationTask: '3.4', formalService: 'src/services/assistantMemory/memoryService.ts',
    propertySources: ['src/features/assistant/application/memoryReflection.ts'], operationSource: 'src/core/application-control/domains/assistantMemory/memoryCapabilities.ts', targetKind: 'operation', surfaceIds: [] },
  screen_recording: { migrationTask: '1.5', formalService: 'src/features/screenRecording/application/recordingService.ts',
    propertySources: ['src/features/screenRecording/application/recordingReflection.ts'], operationSource: 'src/core/application-control/domains/screenRecording/recordingCapabilities.ts', targetKind: 'operation', surfaceIds: ['tool.screen_recording'] },
  video_edit: { migrationTask: '7.2', formalService: 'src/features/videoEdit/application/videoEditService.ts',
    propertySources: ['src/features/videoEdit/application/videoEditFields.ts'], operationSource: 'videoEditApplicationCapabilities.ts', targetKind: 'operation', surfaceIds: ['workspace.video_edit'] },
  application: { migrationTask: '2.2', formalService: 'src/core/application-control/',
    propertySources: ['src/core/application-control/reflection.ts'], operationSource: 'src/core/application-control/builtinApplicationCapabilities.ts', targetKind: 'query', surfaceIds: [] },
  navigation: { migrationTask: '5.1', formalService: 'src/features/navigation/application/',
    propertySources: ['surfaceCatalog.ts'], operationSource: 'src/core/application-control/builtinApplicationCapabilities.ts', targetKind: 'operation', surfaceIds: [...APPLICATION_SURFACE_IDS] },
  settings: { migrationTask: '5.1', formalService: 'src/features/settings/application-control/',
    propertySources: ['generalSettingDefinitions.ts','interfaceSettingDefinitions.ts'], operationSource: 'src/core/application-control/builtinApplicationCapabilities.ts', targetKind: 'property', surfaceIds: APPLICATION_SURFACE_IDS.filter(id => id.startsWith('settings.')) },
  local_models: { migrationTask: '4.11', formalService: 'electron/main/services/local-models/service.ts',
    propertySources: ['src/features/localModels/application/localModelsReflection.ts'], operationSource: 'src/core/application-control/domains/localModels/localModelCapabilities.ts', targetKind: 'operation', surfaceIds: ['settings.files.models'] },
  sound_library: { migrationTask: '7.2', formalService: 'electron/main/services/sound-library/service.ts',
    propertySources: ['src/features/soundLibrary/application/soundLibraryReflection.ts'], operationSource: 'src/core/application-control/domains/soundLibrary/soundLibraryCapabilities.ts', targetKind: 'operation', surfaceIds: ['settings.files.sounds'] },
  generation: { migrationTask: '5.4', formalService: 'src/features/generation/application/',
    propertySources: ['packages/ai-sdk/src/catalog/**.model.ts','src/models/presentation/**.presentation.ts'], operationSource: 'generationApplicationService.ts 与 generationApplicationCapabilities.ts', targetKind: 'operation', surfaceIds: ['workspace.generation'] },
  models: { migrationTask: '5.4', formalService: 'src/features/generation/application/generationPreparationService.ts',
    propertySources: ['packages/ai-sdk/src/catalog/**.model.ts','src/models/presentation/**.presentation.ts'], operationSource: 'generationApplicationCapabilities.ts', targetKind: 'query', surfaceIds: ['workspace.generation', 'settings.providers_models'] },
  image_edit: { migrationTask: '5.3', formalService: 'src/features/imageEdit/application/',
    propertySources: ['src/features/imageEdit/tools/registry.ts'], operationSource: 'toolboxApplicationCapabilities.ts 与 builtinApplicationCapabilities.ts', targetKind: 'operation', surfaceIds: ['tool.image_edit'] },
  assets: { migrationTask: '5.3', formalService: 'src/features/assets/application/',
    propertySources: ['src/features/assets/application/assetReflection.ts'], operationSource: 'assetApplicationCapabilities.ts', targetKind: 'operation', surfaceIds: ['workspace.assets', 'overlay.assets'] },
  canvas: { migrationTask: '5.2', formalService: 'src/features/canvas/application/',
    propertySources: ['src/features/canvas/domain/nodeRegistry.ts'], operationSource: 'canvas*ApplicationCapabilities.ts', targetKind: 'property', surfaceIds: ['workspace.canvas'] },
  camera_stage: { migrationTask: '5.1', formalService: 'src/features/cameraStage/application/ 与 projects/cameraStageProjectService.ts',
    propertySources: ['src/features/cameraStage/application/cameraStageReflection.ts','src/features/cameraStage/domain/animatableProps.ts'], operationSource: 'cameraStage*ApplicationCapabilities.ts', targetKind: 'operation', surfaceIds: ['tool.camera_stage'] },
  audio_edit: { migrationTask: '7.1', formalService: 'src/features/audioEdit/application/ 与 electron/main/services/audio-edit/',
    propertySources: ['src/features/audioEdit/application/audioEditReflection.ts'], operationSource: '通用实体读改与 audioEdit 平台服务', targetKind: 'property', surfaceIds: ['tool.audio_edit'] },
  toolbox: { migrationTask: '5.3', formalService: 'src/features/toolbox/application/',
    propertySources: ['src/features/imageEdit/tools/registry.ts'], operationSource: 'toolboxApplicationCapabilities.ts', targetKind: 'operation', surfaceIds: ['workspace.tools'] },
  documents: { migrationTask: '2.5', formalService: 'src/features/documents/documentOperations.ts',
    propertySources: ['src/features/documents/application/documentsFields.ts'], operationSource: 'documentsApplicationCapabilities.ts', targetKind: 'operation', surfaceIds: [] },
  storyboard: { migrationTask: '5.3', formalService: 'src/features/canvas/application/storyboardProjectService.ts',
    propertySources: ['src/features/canvas/application/storyboardReflection.ts'], operationSource: 'toolboxApplicationCapabilities.ts', targetKind: 'operation', surfaceIds: [] },
}
