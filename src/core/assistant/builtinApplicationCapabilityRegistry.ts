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
import { SETTINGS_APPLICATION_CAPABILITIES } from './capabilities/settingsApplicationCapabilities'
import { ASSET_APPLICATION_CAPABILITIES } from './capabilities/assetApplicationCapabilities'
import { CAMERA_STAGE_APPLICATION_CAPABILITIES } from './capabilities/cameraStageApplicationCapabilities'
import { APPLICATION_REFLECTION_APPLICATION_CAPABILITIES } from './capabilities/applicationReflectionApplicationCapabilities'
import { CANVAS_BATCH_APPLICATION_CAPABILITIES } from './capabilities/canvasBatchApplicationCapabilities'
import { CANVAS_EXPORT_APPLICATION_CAPABILITIES } from './capabilities/canvasExportApplicationCapabilities'
import { CANVAS_MUTATION_APPLICATION_CAPABILITIES } from './capabilities/canvasMutationApplicationCapabilities'
import { CANVAS_PROJECT_APPLICATION_CAPABILITIES } from './capabilities/canvasProjectApplicationCapabilities'
import { GENERATION_APPLICATION_CAPABILITIES } from './capabilities/generationApplicationCapabilities'
import { TOOLBOX_APPLICATION_CAPABILITIES } from './capabilities/toolboxApplicationCapabilities'
import {
  ASSISTANT_RUNTIME_APPLICATION_CAPABILITIES,
} from './capabilities/assistantRuntimeApplicationCapabilities'
import {
  ASSISTANT_SKILL_APPLICATION_CAPABILITIES,
} from './capabilities/assistantSkillApplicationCapabilities'
import { IMAGE_MARK_APPLICATION_CAPABILITIES } from './capabilities/imageMarkApplicationCapabilities'
import { HENJI_SCRIPT_APPLICATION_CAPABILITIES } from './capabilities/henjiScriptApplicationCapabilities'

export const BUILTIN_APPLICATION_CAPABILITIES: ApplicationCapabilityDefinition[] = [
  getCurrentApplicationContextCapability,
  observeApplicationSurfaceCapability,
  openApplicationSurfaceCapability,
  closeApplicationSurfaceCapability,
  focusApplicationEntityCapability,
  ...SETTINGS_APPLICATION_CAPABILITIES,
  listGenerationHistoryCapability,
  openImageEditorWithSourceCapability,
  ...GENERATION_APPLICATION_CAPABILITIES,
  ...ASSET_APPLICATION_CAPABILITIES,
  ...CANVAS_PROJECT_APPLICATION_CAPABILITIES,
  ...CANVAS_MUTATION_APPLICATION_CAPABILITIES,
  ...CANVAS_BATCH_APPLICATION_CAPABILITIES,
  ...CANVAS_EXPORT_APPLICATION_CAPABILITIES,
  ...CAMERA_STAGE_APPLICATION_CAPABILITIES,
  ...IMAGE_MARK_APPLICATION_CAPABILITIES,
  // 通用反射能力：领域只要注册实体和属性，助手就能读改增删，不必再写专用能力
  ...APPLICATION_REFLECTION_APPLICATION_CAPABILITIES,
  ...TOOLBOX_APPLICATION_CAPABILITIES,
  ...ASSISTANT_RUNTIME_APPLICATION_CAPABILITIES,
  ...ASSISTANT_SKILL_APPLICATION_CAPABILITIES,
  ...HENJI_SCRIPT_APPLICATION_CAPABILITIES,
]

export const BUILTIN_APPLICATION_CAPABILITY_REGISTRY = new ApplicationCapabilityRegistry()
for (const capability of BUILTIN_APPLICATION_CAPABILITIES) {
  BUILTIN_APPLICATION_CAPABILITY_REGISTRY.register(capability)
}
