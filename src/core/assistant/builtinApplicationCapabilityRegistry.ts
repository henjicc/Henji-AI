import {
  ApplicationCapabilityRegistry,
  type ApplicationCapabilityDefinition,
} from './applicationCapabilities'
import {
  applyApplicationSettingsChangeCapability,
  closeApplicationSurfaceCapability,
  createImageEditPreviewFromRefCapability,
  focusApplicationEntityCapability,
  getApplicationSettingsCapability,
  getCurrentApplicationContextCapability,
  listGenerationHistoryCapability,
  openApplicationSurfaceCapability,
  openImageEditorWithSourceCapability,
  observeApplicationSurfaceCapability,
  planApplicationSettingsChangeCapability,
  searchApplicationSettingsCapability,
} from './builtinApplicationCapabilities'
import { ASSET_APPLICATION_CAPABILITIES } from './capabilities/assetApplicationCapabilities'
import { CAMERA_STAGE_APPLICATION_CAPABILITIES } from './capabilities/cameraStageApplicationCapabilities'
import { CANVAS_BATCH_APPLICATION_CAPABILITIES } from './capabilities/canvasBatchApplicationCapabilities'
import { CANVAS_EXPORT_APPLICATION_CAPABILITIES } from './capabilities/canvasExportApplicationCapabilities'
import { CANVAS_MUTATION_APPLICATION_CAPABILITIES } from './capabilities/canvasMutationApplicationCapabilities'
import { CANVAS_PROJECT_APPLICATION_CAPABILITIES } from './capabilities/canvasProjectApplicationCapabilities'
import { GENERATION_APPLICATION_CAPABILITIES } from './capabilities/generationApplicationCapabilities'
import { TOOLBOX_APPLICATION_CAPABILITIES } from './capabilities/toolboxApplicationCapabilities'
import {
  ASSISTANT_RUNTIME_APPLICATION_CAPABILITIES,
} from './capabilities/assistantRuntimeApplicationCapabilities'
import { WORKFLOW_APPLICATION_CAPABILITIES } from './capabilities/workflowApplicationCapabilities'

export const BUILTIN_APPLICATION_CAPABILITIES: ApplicationCapabilityDefinition[] = [
  getCurrentApplicationContextCapability,
  observeApplicationSurfaceCapability,
  openApplicationSurfaceCapability,
  closeApplicationSurfaceCapability,
  focusApplicationEntityCapability,
  searchApplicationSettingsCapability,
  getApplicationSettingsCapability,
  planApplicationSettingsChangeCapability,
  applyApplicationSettingsChangeCapability,
  listGenerationHistoryCapability,
  openImageEditorWithSourceCapability,
  createImageEditPreviewFromRefCapability,
  ...GENERATION_APPLICATION_CAPABILITIES,
  ...ASSET_APPLICATION_CAPABILITIES,
  ...CANVAS_PROJECT_APPLICATION_CAPABILITIES,
  ...CANVAS_MUTATION_APPLICATION_CAPABILITIES,
  ...CANVAS_BATCH_APPLICATION_CAPABILITIES,
  ...CANVAS_EXPORT_APPLICATION_CAPABILITIES,
  ...CAMERA_STAGE_APPLICATION_CAPABILITIES,
  ...TOOLBOX_APPLICATION_CAPABILITIES,
  ...ASSISTANT_RUNTIME_APPLICATION_CAPABILITIES,
  ...WORKFLOW_APPLICATION_CAPABILITIES,
]

export const BUILTIN_APPLICATION_CAPABILITY_REGISTRY = new ApplicationCapabilityRegistry()
for (const capability of BUILTIN_APPLICATION_CAPABILITIES) {
  BUILTIN_APPLICATION_CAPABILITY_REGISTRY.register(capability)
}
