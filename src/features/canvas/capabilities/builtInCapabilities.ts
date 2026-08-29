import { CANVAS_NODE_TYPES, NODE_TOOL_TYPES } from '../domain/canvasNodes';
import {
  PANORAMA_MODEL_POLICY,
  PANORAMA_PROMPT_POLICY,
} from './panoramaPolicy';
import {
  RELIGHT_MANUAL_MODEL_POLICY,
  RELIGHT_MANUAL_TEMPLATE_VERSION,
  RELIGHT_SMART_TEMPLATE_VERSION,
} from './relightPolicy';
import { UPSCALE_MODEL_POLICY } from './upscalePolicy';
import { MULTI_ANGLE_MAX_VIEW_COUNT } from './multiAnglePolicy';
import {
  createNineGridNodeInitialData,
  NINE_GRID_PROMPT_TEMPLATE_VERSION,
} from './nineGridPolicy';
import {
  PORTRAIT_TEXTURE_MODEL_POLICY,
  PORTRAIT_TEXTURE_TEMPLATE_VERSION,
} from './portraitTexturePolicy';
import {
  ELEMENT_EDIT_FIXED_SEMANTIC_PARAMS,
  ELEMENT_EDIT_MODEL_POLICY,
  ELEMENT_EDIT_PROMPT_TEMPLATE_VERSION,
} from './elementEditPolicy';
import {
  LAYER_SEPARATION_MODEL_POLICY,
  LAYER_STACK_CONTRACT_VERSION,
} from './layerSeparationPolicy';
import {
  CANVAS_IMAGE_CAPABILITY_IDS,
  type CanvasImageCapabilityDefinition,
} from './types';

const IMAGE_SOURCE = {
  mediaTypes: ['image'],
  minCount: 1,
  maxCount: 1,
  requireMaterializedMedia: true,
} as const;

export const builtInCanvasImageCapabilities: readonly CanvasImageCapabilityDefinition[] = [
  {
    id: CANVAS_IMAGE_CAPABILITY_IDS.panorama,
    titleKey: 'imageCapabilities.items.panorama.title',
    descriptionKey: 'imageCapabilities.items.panorama.description',
    group: 'generation',
    groupLabelKey: 'imageCapabilities.groups.generation',
    icon: 'panorama',
    order: 10,
    source: IMAGE_SOURCE,
    node: { kind: 'standard-generation', editor: 'standard' },
    implementation: {
      status: 'implemented',
      execution: {
        kind: 'canvas-node',
        nodeType: CANVAS_NODE_TYPES.panoramaGen,
      },
    },
    availability: {
      releaseStage: 'available',
      defaultEnabled: true,
      unavailableReasonKey: null,
    },
    modelPolicy: PANORAMA_MODEL_POLICY,
    promptPolicy: PANORAMA_PROMPT_POLICY,
    outputPolicy: {
      resultKind: 'panorama',
      count: { mode: 'single' },
      postProcess: 'validate-panorama',
      failureMode: 'single-result',
    },
  },
  {
    id: CANVAS_IMAGE_CAPABILITY_IDS.relight,
    titleKey: 'imageCapabilities.items.relight.title',
    descriptionKey: 'imageCapabilities.items.relight.description',
    group: 'editing',
    groupLabelKey: 'imageCapabilities.groups.editing',
    icon: 'relight',
    order: 20,
    source: IMAGE_SOURCE,
    node: { kind: 'special-generation', editor: 'relight' },
    implementation: {
      status: 'implemented',
      execution: {
        kind: 'canvas-node',
        nodeType: CANVAS_NODE_TYPES.relightGen,
      },
    },
    availability: {
      releaseStage: 'available',
      defaultEnabled: true,
      unavailableReasonKey: null,
    },
    modelPolicy: RELIGHT_MANUAL_MODEL_POLICY,
    promptPolicy: {
      hiddenTemplateVersion: RELIGHT_MANUAL_TEMPLATE_VERSION,
      fixedSemanticParams: {
        relightContractVersion: 1,
        manualTemplateVersion: RELIGHT_MANUAL_TEMPLATE_VERSION,
        smartTemplateVersion: RELIGHT_SMART_TEMPLATE_VERSION,
      },
      visibleParameterKeys: [],
    },
    outputPolicy: {
      resultKind: 'image',
      count: { mode: 'single' },
      postProcess: 'none',
      failureMode: 'single-result',
    },
  },
  {
    id: CANVAS_IMAGE_CAPABILITY_IDS.multiAngle,
    titleKey: 'imageCapabilities.items.multiAngle.title',
    descriptionKey: 'imageCapabilities.items.multiAngle.description',
    group: 'structure',
    groupLabelKey: 'imageCapabilities.groups.structure',
    icon: 'multiAngle',
    order: 30,
    source: IMAGE_SOURCE,
    node: { kind: 'special-generation', editor: 'multiAngle' },
    implementation: {
      status: 'implemented',
      execution: { kind: 'canvas-node', nodeType: CANVAS_NODE_TYPES.multiAngleGen },
    },
    availability: {
      releaseStage: 'experimental',
      defaultEnabled: true,
      unavailableReasonKey: 'imageCapabilities.unavailable.experimental',
    },
    modelPolicy: {
      mode: 'verified-families',
      allowedCanonicalFamilies: [
        'qwen-image-edit-2509-multiple-angles',
        'perspective-change',
      ],
      requiredTags: ['multi-angle'],
      providerCompatibility: 'verified-combinations-only',
      allowedProviderConfigurations: [{ providerId: 'fal' }],
      semanticRequirements: { referenceImages: { min: 1, max: 1 } },
    },
    promptPolicy: {
      hiddenTemplateVersion: 'multi-angle-controls-v1',
      fixedSemanticParams: { contractVersion: 1, concurrency: 2 },
      visibleParameterKeys: [],
    },
    outputPolicy: {
      resultKind: 'image-group',
      count: {
        mode: 'parameter',
        parameterKey: 'viewCount',
        defaultCount: 4,
        minCount: 1,
        maxCount: MULTI_ANGLE_MAX_VIEW_COUNT,
      },
      postProcess: 'assemble-image-group',
      failureMode: 'atomic-results',
    },
  },
  {
    id: CANVAS_IMAGE_CAPABILITY_IDS.nineGrid,
    titleKey: 'imageCapabilities.items.nineGrid.title',
    descriptionKey: 'imageCapabilities.items.nineGrid.description',
    group: 'structure',
    groupLabelKey: 'imageCapabilities.groups.structure',
    icon: 'nineGrid',
    order: 40,
    source: IMAGE_SOURCE,
    node: { kind: 'standard-generation', editor: 'standard' },
    implementation: {
      status: 'implemented',
      execution: {
        kind: 'canvas-node',
        nodeType: CANVAS_NODE_TYPES.storyboardGen,
        initialData: { ...createNineGridNodeInitialData() },
      },
    },
    availability: {
      releaseStage: 'available',
      defaultEnabled: true,
      unavailableReasonKey: null,
    },
    modelPolicy: {
      mode: 'node-schema',
      requiredTags: ['image-to-image'],
    },
    promptPolicy: {
      hiddenTemplateVersion: NINE_GRID_PROMPT_TEMPLATE_VERSION,
      fixedSemanticParams: { rows: 3, columns: 3 },
      visibleParameterKeys: ['prompt'],
    },
    outputPolicy: {
      resultKind: 'image-group',
      count: { mode: 'fixed', count: 9 },
      postProcess: 'assemble-image-group',
      failureMode: 'atomic-results',
    },
  },
  {
    id: CANVAS_IMAGE_CAPABILITY_IDS.upscale,
    titleKey: 'imageCapabilities.items.upscale.title',
    descriptionKey: 'imageCapabilities.items.upscale.description',
    group: 'enhancement',
    groupLabelKey: 'imageCapabilities.groups.enhancement',
    icon: 'upscale',
    order: 50,
    source: IMAGE_SOURCE,
    node: { kind: 'standard-generation', editor: 'standard' },
    implementation: {
      status: 'implemented',
      execution: {
        kind: 'canvas-node',
        nodeType: CANVAS_NODE_TYPES.upscaleGen,
      },
    },
    availability: {
      releaseStage: 'available',
      defaultEnabled: true,
      unavailableReasonKey: null,
    },
    modelPolicy: UPSCALE_MODEL_POLICY,
    promptPolicy: {
      hiddenTemplateVersion: null,
      fixedSemanticParams: {
        maxOutputMegapixels: 48,
        maxInputFileBytes: 20 * 1024 * 1024,
      },
      visibleParameterKeys: [
        'falTopazUpscaleModel',
        'falTopazUpscaleFactor',
        'falTopazFaceEnhancement',
      ],
    },
    outputPolicy: {
      resultKind: 'image',
      count: { mode: 'single' },
      postProcess: 'none',
      failureMode: 'single-result',
    },
  },
  {
    id: CANVAS_IMAGE_CAPABILITY_IDS.portraitTexture,
    titleKey: 'imageCapabilities.items.portraitTexture.title',
    descriptionKey: 'imageCapabilities.items.portraitTexture.description',
    group: 'enhancement',
    groupLabelKey: 'imageCapabilities.groups.enhancement',
    icon: 'portraitTexture',
    order: 60,
    source: IMAGE_SOURCE,
    node: { kind: 'standard-generation', editor: 'standard' },
    implementation: {
      status: 'implemented',
      execution: {
        kind: 'canvas-node',
        nodeType: CANVAS_NODE_TYPES.portraitTextureGen,
      },
    },
    availability: {
      releaseStage: 'experimental',
      defaultEnabled: true,
      unavailableReasonKey: 'imageCapabilities.unavailable.experimental',
    },
    modelPolicy: PORTRAIT_TEXTURE_MODEL_POLICY,
    promptPolicy: {
      hiddenTemplateVersion: PORTRAIT_TEXTURE_TEMPLATE_VERSION,
      fixedSemanticParams: { portraitTextureContractVersion: 1 },
      visibleParameterKeys: [],
    },
    outputPolicy: {
      resultKind: 'image',
      count: { mode: 'single' },
      postProcess: 'none',
      failureMode: 'single-result',
    },
  },
  {
    id: CANVAS_IMAGE_CAPABILITY_IDS.elementEdit,
    titleKey: 'imageCapabilities.items.elementEdit.title',
    descriptionKey: 'imageCapabilities.items.elementEdit.description',
    group: 'editing',
    groupLabelKey: 'imageCapabilities.groups.editing',
    icon: 'elementEdit',
    order: 70,
    source: IMAGE_SOURCE,
    node: { kind: 'special-generation', editor: 'mask', openEditorOnCreate: true },
    implementation: {
      status: 'implemented',
      execution: {
        kind: 'canvas-node',
        nodeType: CANVAS_NODE_TYPES.elementEditGen,
      },
    },
    availability: {
      releaseStage: 'available',
      defaultEnabled: true,
      unavailableReasonKey: null,
    },
    modelPolicy: ELEMENT_EDIT_MODEL_POLICY,
    promptPolicy: {
      hiddenTemplateVersion: ELEMENT_EDIT_PROMPT_TEMPLATE_VERSION,
      fixedSemanticParams: { ...ELEMENT_EDIT_FIXED_SEMANTIC_PARAMS },
      visibleParameterKeys: [
        'apimartGptImage2MaskUrl',
        'falGptImage2MaskUrl',
      ],
    },
    outputPolicy: {
      resultKind: 'image',
      count: { mode: 'single' },
      postProcess: 'none',
      failureMode: 'single-result',
    },
  },
  {
    id: CANVAS_IMAGE_CAPABILITY_IDS.layerSeparation,
    titleKey: 'imageCapabilities.items.layerSeparation.title',
    descriptionKey: 'imageCapabilities.items.layerSeparation.description',
    group: 'structure',
    groupLabelKey: 'imageCapabilities.groups.structure',
    icon: 'layerSeparation',
    order: 80,
    source: IMAGE_SOURCE,
    node: { kind: 'special-generation', editor: 'layers' },
    implementation: {
      status: 'implemented',
      execution: { kind: 'canvas-node', nodeType: CANVAS_NODE_TYPES.layerSeparationGen },
    },
    availability: {
      releaseStage: 'experimental',
      defaultEnabled: true,
      unavailableReasonKey: 'imageCapabilities.unavailable.layerSeparationValidation',
    },
    modelPolicy: LAYER_SEPARATION_MODEL_POLICY,
    promptPolicy: {
      hiddenTemplateVersion: null,
      fixedSemanticParams: { layerStackContractVersion: LAYER_STACK_CONTRACT_VERSION },
      visibleParameterKeys: ['prompt'],
      visibleParameterTransferKeys: ['layer-output-size'],
    },
    outputPolicy: {
      resultKind: 'layer-stack',
      count: { mode: 'dynamic', minCount: 1, maxCount: 17 },
      postProcess: 'assemble-layer-stack',
      failureMode: 'atomic-results',
    },
  },
  {
    id: CANVAS_IMAGE_CAPABILITY_IDS.gridSplit,
    titleKey: 'imageCapabilities.items.gridSplit.title',
    descriptionKey: 'imageCapabilities.items.gridSplit.description',
    group: 'local',
    groupLabelKey: 'imageCapabilities.groups.local',
    icon: 'gridSplit',
    order: 90,
    source: IMAGE_SOURCE,
    node: { kind: 'local-tool', editor: 'gridSplit' },
    implementation: {
      status: 'implemented',
      execution: {
        kind: 'local-tool',
        toolType: NODE_TOOL_TYPES.splitStoryboard,
      },
    },
    availability: {
      releaseStage: 'available',
      defaultEnabled: true,
      unavailableReasonKey: null,
    },
    modelPolicy: { mode: 'not-applicable' },
    promptPolicy: {
      hiddenTemplateVersion: null,
      fixedSemanticParams: {},
      visibleParameterKeys: ['rows', 'columns', 'lineThickness'],
    },
    outputPolicy: {
      resultKind: 'image-group',
      count: {
        mode: 'parameter',
        parameterKey: 'cellCount',
        defaultCount: 9,
        minCount: 1,
        maxCount: 100,
      },
      postProcess: 'split-grid',
      failureMode: 'atomic-results',
    },
  },
];
