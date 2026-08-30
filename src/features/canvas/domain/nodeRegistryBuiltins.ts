import { CANVAS_NODE_TYPES, type CanvasNodeType } from './canvasNodes';
import {
  audioGenNodeDefinition,
  audioUploadNodeDefinition,
  exportAudioNodeDefinition,
  exportVideoNodeDefinition,
  videoGenNodeDefinition,
  videoUploadNodeDefinition,
} from './mediaNodeDefinitions';
import {
  audioModelSelectorNodeDefinition,
  imageModelSelectorNodeDefinition,
  videoModelSelectorNodeDefinition,
} from './modelSelectorDefinitions';
import {
  elementEditGenerationNodeDefinition,
  layerSeparationGenerationNodeDefinition,
  layerStackResultNodeDefinition,
  multiAngleGenerationNodeDefinition,
  portraitTextureGenerationNodeDefinition,
  relightGenerationNodeDefinition,
  upscaleGenerationNodeDefinition,
} from './nodeRegistryCapabilityDefinitions';
import {
  imageEditNodeDefinition,
  panoramaGenerationNodeDefinition,
  panoramaViewerNodeDefinition,
  universalUploadNodeDefinition,
  uploadNodeDefinition,
} from './nodeRegistryBaseDefinitions';
import type { CanvasNodeDefinition } from './nodeRegistryContracts';
import {
  assetGroupNodeDefinition,
  cameraStageNodeDefinition,
  exportImageNodeDefinition,
  groupNodeDefinition,
  storyboardGenNodeDefinition,
  storyboardSplitDefinition,
  textAnnotationNodeDefinition,
  textProcessingNodeDefinition,
} from './nodeRegistryStandardDefinitions';
import {
  booleanSourceNodeDefinition,
  floatSourceNodeDefinition,
  intSourceNodeDefinition,
  stringSourceNodeDefinition,
} from './valueNodeDefinitions';

export const canvasNodeDefinitions: Record<CanvasNodeType, CanvasNodeDefinition> = {
  [CANVAS_NODE_TYPES.universalUpload]: universalUploadNodeDefinition,
  [CANVAS_NODE_TYPES.upload]: uploadNodeDefinition,
  [CANVAS_NODE_TYPES.imageEdit]: imageEditNodeDefinition,
  [CANVAS_NODE_TYPES.panoramaGen]: panoramaGenerationNodeDefinition,
  [CANVAS_NODE_TYPES.panoramaViewer]: panoramaViewerNodeDefinition,
  [CANVAS_NODE_TYPES.relightGen]: relightGenerationNodeDefinition,
  [CANVAS_NODE_TYPES.multiAngleGen]: multiAngleGenerationNodeDefinition,
  [CANVAS_NODE_TYPES.upscaleGen]: upscaleGenerationNodeDefinition,
  [CANVAS_NODE_TYPES.portraitTextureGen]: portraitTextureGenerationNodeDefinition,
  [CANVAS_NODE_TYPES.elementEditGen]: elementEditGenerationNodeDefinition,
  [CANVAS_NODE_TYPES.layerSeparationGen]: layerSeparationGenerationNodeDefinition,
  [CANVAS_NODE_TYPES.layerStackResult]: layerStackResultNodeDefinition,
  [CANVAS_NODE_TYPES.exportImage]: exportImageNodeDefinition,
  [CANVAS_NODE_TYPES.textProcessing]: textProcessingNodeDefinition,
  [CANVAS_NODE_TYPES.textAnnotation]: textAnnotationNodeDefinition,
  [CANVAS_NODE_TYPES.group]: groupNodeDefinition,
  [CANVAS_NODE_TYPES.assetGroup]: assetGroupNodeDefinition,
  [CANVAS_NODE_TYPES.storyboardSplit]: storyboardSplitDefinition,
  [CANVAS_NODE_TYPES.storyboardGen]: storyboardGenNodeDefinition,
  [CANVAS_NODE_TYPES.videoGen]: videoGenNodeDefinition,
  [CANVAS_NODE_TYPES.audioGen]: audioGenNodeDefinition,
  [CANVAS_NODE_TYPES.exportVideo]: exportVideoNodeDefinition,
  [CANVAS_NODE_TYPES.exportAudio]: exportAudioNodeDefinition,
  [CANVAS_NODE_TYPES.videoUpload]: videoUploadNodeDefinition,
  [CANVAS_NODE_TYPES.audioUpload]: audioUploadNodeDefinition,
  [CANVAS_NODE_TYPES.intSource]: intSourceNodeDefinition,
  [CANVAS_NODE_TYPES.floatSource]: floatSourceNodeDefinition,
  [CANVAS_NODE_TYPES.stringSource]: stringSourceNodeDefinition,
  [CANVAS_NODE_TYPES.booleanSource]: booleanSourceNodeDefinition,
  [CANVAS_NODE_TYPES.imageModelSelector]: imageModelSelectorNodeDefinition,
  [CANVAS_NODE_TYPES.videoModelSelector]: videoModelSelectorNodeDefinition,
  [CANVAS_NODE_TYPES.audioModelSelector]: audioModelSelectorNodeDefinition,
  [CANVAS_NODE_TYPES.cameraStage]: cameraStageNodeDefinition,
};
