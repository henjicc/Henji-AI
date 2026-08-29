import {
  CANVAS_NODE_TYPES,
  DEFAULT_ASPECT_RATIO,
  type CanvasNodeData,
  type CanvasNodeType,
  type CameraStageNodeData,
  type ExportImageNodeData,
  type GroupNodeData,
  type AssetGroupNodeData,
  type ImageEditNodeData,
  type ElementEditGenerationNodeData,
  type LayerSeparationGenerationNodeData,
  type LayerStackResultNodeData,
  type MultiAngleGenerationNodeData,
  type PanoramaGenerationNodeData,
  type PanoramaViewerNodeData,
  type PortraitTextureGenerationNodeData,
  type UpscaleGenerationNodeData,
  type StoryboardSplitNodeData,
  type StoryboardGenNodeData,
  type TextAnnotationNodeData,
  type TextProcessingNodeData,
  type UniversalUploadNodeData,
  type UploadImageNodeData,
} from './canvasNodes';
import { DEFAULT_NODE_DISPLAY_NAME } from './nodeDisplay';
import { getDefaultModelId } from './defaultModels';
import {
  audioGenNodeDefinition,
  audioUploadNodeDefinition,
  exportAudioNodeDefinition,
  exportVideoNodeDefinition,
  videoGenNodeDefinition,
  videoUploadNodeDefinition,
} from './mediaNodeDefinitions';
import {
  booleanSourceNodeDefinition,
  floatSourceNodeDefinition,
  intSourceNodeDefinition,
  stringSourceNodeDefinition,
} from './valueNodeDefinitions';
import {
  audioModelSelectorNodeDefinition,
  imageModelSelectorNodeDefinition,
  videoModelSelectorNodeDefinition,
} from './modelSelectorDefinitions';
import {
  arePortsCompatible,
  getSourcePortMediaKind,
  mediaSourcePortId,
  type MediaKind,
  type MediaPortKind,
  type NodeGenerationSpec,
  type NodeMediaOutput,
  type NodePorts,
  type NodeValueOutput,
} from './nodePorts';
import { CANVAS_BG_HEX, CANVAS_TEXT_HEX } from '@/core/theme/colorTokens';
import { DEFAULT_PPIO_MODEL_ID, DEFAULT_PPIO_PROVIDER_ID } from '@/core/llm/defaults';
import type { ModelTag } from '@/core/types';
import { createPlainTextPromptDocument } from '@/core/inputs/promptDocument';
import { registry } from '@/core/ModelRegistry';
import { CANVAS_IMAGE_CAPABILITY_IDS } from '../capabilities/types';
import {
  mapCanvasCapabilityModelParams,
  resolveCanvasCapabilityModelCandidates,
} from '../capabilities/modelCompatibility';
import {
  PANORAMA_MODEL_POLICY,
  PANORAMA_PROMPT_POLICY,
  PANORAMA_DEFAULT_PROMPT,
  PANORAMA_DEFAULT_PROMPT_VERSION,
  PANORAMA_TEXT_TEMPLATE_VERSION,
} from '../capabilities/panoramaPolicy';
import {
  PANORAMA_DEFAULT_CAMERA_VIEW,
  PANORAMA_DEFAULT_VIEW_MODE,
  PANORAMA_DEFAULT_VIEWPORT_ASPECT_RATIO,
} from './panoramaViewer';
import {
  DEFAULT_RELIGHT_SETTINGS,
  prepareRelightRoute,
} from '../capabilities/relightPolicy';
import {
  MULTI_ANGLE_CONTINUOUS_MODEL_ID,
  createDefaultMultiAngleConfig,
} from '../capabilities/multiAnglePolicy';
import { UPSCALE_MODEL_POLICY } from '../capabilities/upscalePolicy';
import {
  ELEMENT_EDIT_FIXED_SEMANTIC_PARAMS,
  ELEMENT_EDIT_DEFAULT_MODEL_ID,
  ELEMENT_EDIT_MODEL_POLICY,
  ELEMENT_EDIT_PROMPT_TEMPLATE_VERSION,
  selectDefaultElementEditModel,
} from '../capabilities/elementEditPolicy';
import {
  DEFAULT_PORTRAIT_TEXTURE_SETTINGS,
  PORTRAIT_TEXTURE_DEFAULT_MODEL_ID,
  PORTRAIT_TEXTURE_TEMPLATE_VERSION,
  preparePortraitTextureRoute,
} from '../capabilities/portraitTexturePolicy';
import {
  LAYER_SEPARATION_DEFAULT_MODEL_ID,
  LAYER_SEPARATION_MODEL_POLICY,
  LAYER_STACK_CONTRACT_VERSION,
  selectDefaultLayerSeparationModel,
} from '../capabilities/layerSeparationPolicy';

/**
 * 新增画布节点 SOP：
 * 1. `canvasNodes.ts`：添加节点类型常量、Data 接口与类型守卫
 * 2. 本文件：添加 CanvasNodeDefinition（声明 media/ports/generation/getOutputs，
 *    生成类节点务必填 generation 与 ports，输出类节点填 getOutputs）
 * 3. `nodes/`：实现组件（生成类节点复用 nodes/shared/GenerationNodeShell，约 100~150 行）
 * 4. `nodes/index.ts`：注册到 nodeTypes 映射
 * 5. i18n：补充 `node.menu.*` 等文案键（zh-CN / en-US）
 *
 * 约束：禁止在组件或通用逻辑中写 `if (type === 'xxxNode')` 特判，
 * 行为差异一律通过本注册表的声明字段表达。
 */

export type MenuIconKey =
  | 'upload'
  | 'imageUpload'
  | 'videoUpload'
  | 'audioUpload'
  | 'imageGeneration'
  | 'videoGeneration'
  | 'audioGeneration'
  | 'panorama'
  | 'storyboard'
  | 'textProcessing'
  | 'textAnnotation'
  | 'cameraStage'
  | 'imageModel'
  | 'videoModel'
  | 'audioModel'
  | 'integer'
  | 'float'
  | 'text'
  | 'boolean'
  | 'assetGroup';

export type NodeMenuSection = 'media' | 'textTools' | 'models' | 'parameters' | 'extensions';

export interface CanvasNodeCapabilities {
  toolbar: boolean;
  promptInput: boolean;
  /** 是否在节点已有可用媒体结果时显示下载入口（默认 false）。 */
  toolbarDownload?: boolean;
  /**
   * 是否在选中节点时的顶部工具条显示"生成"按钮（默认 false）。
   * 仅逐行模式（GenerationNodeShell）节点声明为 true；节点内不再渲染生成按钮。
   */
  toolbarGenerate?: boolean;
  /** 是否在顶部工具条显示图片派生能力；图片结果默认显示，特殊结果节点可声明关闭。 */
  toolbarImageCapabilities?: boolean;
}

export interface CanvasNodeConnectivity {
  sourceHandle: boolean;
  targetHandle: boolean;
  connectMenu: {
    fromSource: boolean;
    fromTarget: boolean;
  };
  /** 是否允许从该节点的输出端口手动拖出连线（默认 false） */
  manualSource?: boolean;
  /**
   * 目标端口形态：
   * - 'rows'（逐行模式）：节点按媒体/模型/参数维度拥有多个独立类型化端口，由 NodeInputRows 渲染，
   *   端口 id 形如 `param:__image`/`param:__model`/`param:<paramId>`
   * - 缺省/'legacy'：单一 target handle，id 固定为 'target'（旧节点形态，如上传/导出/分镜节点）
   */
  targetHandleMode?: 'legacy' | 'rows';
  /** 首条类型化输出连线是否把节点锁定为该媒体类型。 */
  lockSourceMediaOnFirstConnection?: boolean;
}

export type CanvasNodeExecutionKind =
  | 'text-processing'
  | 'text-display'
  | 'standard-generation'
  | 'storyboard-generation';

export interface CanvasNodeDefinition<TData extends CanvasNodeData = CanvasNodeData> {
  type: CanvasNodeType;
  menuLabelKey: string;
  menuIcon: MenuIconKey;
  visibleInMenu: boolean;
  /** 菜单编排元数据；第三方定义缺省进入末尾的扩展分区。 */
  menuSection?: NodeMenuSection;
  menuOrder?: number;
  menuAggregationKey?: string;
  menuBehavior?: 'create' | 'chooseMediaBeforeCreate';
  /** 画布运行协调器使用的声明式执行角色。 */
  executionKind?: CanvasNodeExecutionKind;
  capabilities: CanvasNodeCapabilities;
  connectivity: CanvasNodeConnectivity;
  /** 节点主媒体类型与角色（source=素材输入 / generator=生成 / result=结果展示） */
  media?: {
    kind: MediaKind;
    role: 'source' | 'generator' | 'result';
  };
  /** 端口媒体类型声明（连接校验与连接菜单依据） */
  ports?: NodePorts;
  /** 生成类节点的生成规格 */
  generation?: NodeGenerationSpec;
  /** 提取该节点对下游的媒体输出（参数为宽类型以保证注册表协变，内部自行收窄） */
  getOutputs?: (data: CanvasNodeData, sourceHandle?: string) => NodeMediaOutput[];
  /** 提取该节点对下游参数端口的标量值输出（数值/源节点专用） */
  getValueOutput?: (data: CanvasNodeData) => NodeValueOutput | null;
  createDefaultData: () => TData;
}

/** 通用提取：节点 data 上的 imageUrl/previewImageUrl 作为图片输出 */
function imageOutputsFromData(data: CanvasNodeData): NodeMediaOutput[] {
  const imageUrl = (data as { imageUrl?: DynamicValue }).imageUrl;
  if (typeof imageUrl !== 'string' || !imageUrl) {
    return [];
  }
  const previewImageUrl = (data as { previewImageUrl?: DynamicValue }).previewImageUrl;
  return [{
    kind: 'image',
    url: imageUrl,
    previewUrl: typeof previewImageUrl === 'string' ? previewImageUrl : null,
  }];
}

const universalUploadNodeDefinition: CanvasNodeDefinition<UniversalUploadNodeData> = {
  type: CANVAS_NODE_TYPES.universalUpload,
  menuLabelKey: 'node.menu.upload',
  menuIcon: 'upload',
  visibleInMenu: true,
  menuSection: 'media',
  menuOrder: 10,
  menuAggregationKey: 'upload',
  menuBehavior: 'chooseMediaBeforeCreate',
  capabilities: { toolbar: true, promptInput: false },
  connectivity: {
    sourceHandle: true,
    targetHandle: false,
    connectMenu: { fromSource: false, fromTarget: false },
    manualSource: true,
    lockSourceMediaOnFirstConnection: true,
  },
  ports: {
    source: {
      emits: 'image',
      handles: {
        [mediaSourcePortId('image')]: 'image',
        [mediaSourcePortId('video')]: 'video',
        [mediaSourcePortId('audio')]: 'audio',
      },
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.universalUpload],
    lockedMediaKind: null,
    uploadError: null,
  }),
};

const uploadNodeDefinition: CanvasNodeDefinition<UploadImageNodeData> = {
  type: CANVAS_NODE_TYPES.upload,
  menuLabelKey: 'node.menu.uploadImage',
  menuIcon: 'imageUpload',
  visibleInMenu: false,
  menuSection: 'media',
  menuOrder: 10,
  menuAggregationKey: 'upload',
  capabilities: {
    toolbar: true,
    promptInput: false,
    toolbarDownload: true,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: false,
    connectMenu: {
      fromSource: false,
      fromTarget: true,
    },
    manualSource: true,
  },
  media: { kind: 'image', role: 'source' },
  ports: {
    source: { emits: 'image' },
  },
  getOutputs: imageOutputsFromData,

  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.upload],
    imageUrl: null,
    previewImageUrl: null,
    aspectRatio: '1:1',
    isSizeManuallyAdjusted: false,
    sourceFileName: null,
  }),
};

const imageEditNodeDefinition: CanvasNodeDefinition<ImageEditNodeData> = {
  type: CANVAS_NODE_TYPES.imageEdit,
  menuLabelKey: 'node.menu.aiImageGeneration',
  menuIcon: 'imageGeneration',
  visibleInMenu: true,
  menuSection: 'media',
  menuOrder: 20,
  executionKind: 'standard-generation',
  capabilities: {
    toolbar: true,
    promptInput: false,
    toolbarGenerate: true,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: true,
      fromTarget: false,
    },
    targetHandleMode: 'rows',
  },
  media: { kind: 'image', role: 'generator' },
  ports: {
    source: { emits: 'image' },
    target: { accepts: ['image'] },
  },
  generation: {
    modelType: 'image',
    resultNodeType: CANVAS_NODE_TYPES.exportImage,
  },
  getOutputs: imageOutputsFromData,

  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.imageEdit],
    imageUrl: null,
    previewImageUrl: null,
    aspectRatio: DEFAULT_ASPECT_RATIO,
    isSizeManuallyAdjusted: false,
    prompt: '',
    modelId: getDefaultModelId('image'),
    params: {},
    isGenerating: false,
    generationStartedAt: null,
    generationDurationMs: undefined,
  }),
};

const panoramaViewerNodeDefinition: CanvasNodeDefinition<PanoramaViewerNodeData> = {
  type: CANVAS_NODE_TYPES.panoramaViewer,
  menuLabelKey: 'node.menu.panoramaViewer',
  menuIcon: 'panorama',
  visibleInMenu: true,
  menuSection: 'media',
  menuOrder: 60,
  capabilities: {
    toolbar: true,
    promptInput: false,
    toolbarDownload: true,
    toolbarImageCapabilities: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: { fromSource: false, fromTarget: false },
    manualSource: true,
    targetHandleMode: 'legacy',
  },
  media: { kind: 'image', role: 'result' },
  ports: { source: { emits: 'image' }, target: { accepts: ['image'] } },
  getOutputs: imageOutputsFromData,
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.panoramaViewer],
    imageUrl: null,
    previewImageUrl: null,
    aspectRatio: '2:1',
    isSizeManuallyAdjusted: false,
    resultKind: 'panorama',
    panoramaProjectionMode: 'strict-2:1',
    panoramaPreviewImageUrl: null,
    viewMode: PANORAMA_DEFAULT_VIEW_MODE,
    viewportAspectRatio: PANORAMA_DEFAULT_VIEWPORT_ASPECT_RATIO,
    cameraView: { ...PANORAMA_DEFAULT_CAMERA_VIEW },
  }),
};

function createPanoramaGenerationDefaultData(): PanoramaGenerationNodeData {
  const compatibleModels = resolveCanvasCapabilityModelCandidates(
    registry.getModelsByType('image'),
    PANORAMA_MODEL_POLICY,
  ).candidates;
  const modelId = compatibleModels[0]?.model.meta.id ?? getDefaultModelId('image');
  const model = registry.getModel(modelId);
  const params = model
    ? mapCanvasCapabilityModelParams(model, PANORAMA_MODEL_POLICY).params
    : {};
  return {
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.panoramaGen],
    imageUrl: null,
    previewImageUrl: null,
    aspectRatio: '2:1',
    isSizeManuallyAdjusted: false,
    prompt: PANORAMA_DEFAULT_PROMPT,
    promptDocument: createPlainTextPromptDocument(PANORAMA_DEFAULT_PROMPT),
    modelId,
    params,
    mediaInputs: {},
    isGenerating: false,
    generationStartedAt: null,
    generationDurationMs: undefined,
    capabilityId: CANVAS_IMAGE_CAPABILITY_IDS.panorama,
    promptTemplateVersion: PANORAMA_TEXT_TEMPLATE_VERSION,
    defaultPromptVersion: PANORAMA_DEFAULT_PROMPT_VERSION,
    fixedSemanticParams: { ...PANORAMA_PROMPT_POLICY.fixedSemanticParams },
  };
}

const panoramaGenerationNodeDefinition: CanvasNodeDefinition<PanoramaGenerationNodeData> = {
  type: CANVAS_NODE_TYPES.panoramaGen,
  menuLabelKey: 'node.menu.panoramaGeneration',
  menuIcon: 'imageGeneration',
  visibleInMenu: false,
  executionKind: 'standard-generation',
  capabilities: {
    toolbar: true,
    promptInput: false,
    toolbarGenerate: true,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: true,
      fromTarget: false,
    },
    targetHandleMode: 'rows',
  },
  media: { kind: 'image', role: 'generator' },
  ports: {
    source: { emits: 'image' },
    target: { accepts: ['image'] },
  },
  generation: {
    modelType: 'image',
    resultNodeType: CANVAS_NODE_TYPES.panoramaViewer,
  },
  getOutputs: imageOutputsFromData,
  createDefaultData: createPanoramaGenerationDefaultData,
};

function createRelightGenerationDefaultData(): ImageEditNodeData {
  const settings = {
    ...DEFAULT_RELIGHT_SETTINGS,
    manual: { ...DEFAULT_RELIGHT_SETTINGS.manual },
    smart: { ...DEFAULT_RELIGHT_SETTINGS.smart, lightingReferenceImages: [] },
  };
  const route = prepareRelightRoute(settings, registry.getModelsByType('image'));
  return {
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.relightGen],
    imageUrl: null,
    previewImageUrl: null,
    aspectRatio: DEFAULT_ASPECT_RATIO,
    isSizeManuallyAdjusted: false,
    prompt: route.prompt,
    modelId: route.model?.meta.id ?? '',
    params: route.params,
    mediaInputs: {},
    isGenerating: false,
    generationStartedAt: null,
    generationDurationMs: undefined,
    capabilityId: CANVAS_IMAGE_CAPABILITY_IDS.relight,
    relightSettings: settings as unknown as DynamicValue,
    promptTemplateVersion: route.templateVersion,
    lightingReferenceImages: [],
    relightRouteReasons: route.reasons,
  };
}

const relightGenerationNodeDefinition: CanvasNodeDefinition<ImageEditNodeData> = {
  type: CANVAS_NODE_TYPES.relightGen,
  menuLabelKey: 'node.menu.relightGeneration',
  menuIcon: 'imageGeneration',
  visibleInMenu: false,
  executionKind: 'standard-generation',
  capabilities: {
    toolbar: true,
    promptInput: false,
    toolbarGenerate: true,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: { fromSource: true, fromTarget: false },
    targetHandleMode: 'rows',
  },
  media: { kind: 'image', role: 'generator' },
  ports: {
    source: { emits: 'image' },
    target: { accepts: ['image'] },
  },
  generation: {
    modelType: 'image',
    resultNodeType: CANVAS_NODE_TYPES.exportImage,
  },
  getOutputs: imageOutputsFromData,
  createDefaultData: createRelightGenerationDefaultData,
};

function createMultiAngleGenerationDefaultData(): MultiAngleGenerationNodeData {
  return {
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.multiAngleGen],
    imageUrl: null,
    previewImageUrl: null,
    aspectRatio: DEFAULT_ASPECT_RATIO,
    isSizeManuallyAdjusted: false,
    prompt: '',
    modelId: MULTI_ANGLE_CONTINUOUS_MODEL_ID,
    params: {},
    mediaInputs: {},
    isGenerating: false,
    generationStartedAt: null,
    generationDurationMs: undefined,
    capabilityId: CANVAS_IMAGE_CAPABILITY_IDS.multiAngle,
    multiAngleConfig: createDefaultMultiAngleConfig() as unknown as DynamicValueMap,
    multiAngleBatch: null,
    multiAngleResultPlaceholderId: null,
  };
}

const multiAngleGenerationNodeDefinition: CanvasNodeDefinition<MultiAngleGenerationNodeData> = {
  type: CANVAS_NODE_TYPES.multiAngleGen,
  menuLabelKey: 'node.menu.multiAngleGeneration',
  menuIcon: 'imageGeneration',
  visibleInMenu: false,
  executionKind: 'standard-generation',
  capabilities: {
    toolbar: true,
    promptInput: false,
    toolbarGenerate: true,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: { fromSource: true, fromTarget: false },
    targetHandleMode: 'rows',
  },
  media: { kind: 'image', role: 'generator' },
  ports: {
    source: { emits: 'image' },
    target: { accepts: ['image'] },
  },
  generation: {
    modelType: 'image',
    resultNodeType: CANVAS_NODE_TYPES.exportImage,
  },
  getOutputs: imageOutputsFromData,
  createDefaultData: createMultiAngleGenerationDefaultData,
};

function createUpscaleGenerationDefaultData(): UpscaleGenerationNodeData {
  const compatibleModels = resolveCanvasCapabilityModelCandidates(
    registry.getModelsByType('image'),
    UPSCALE_MODEL_POLICY,
  ).candidates;
  const modelId = compatibleModels[0]?.model.meta.id ?? 'fal-ai-topaz-image-upscale';
  const model = registry.getModel(modelId);
  const params = model
    ? mapCanvasCapabilityModelParams(model, UPSCALE_MODEL_POLICY).params
    : {
        falTopazUpscaleModel: 'High Fidelity V2',
        falTopazUpscaleFactor: 2,
        falTopazFaceEnhancement: false,
      };
  return {
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.upscaleGen],
    imageUrl: null,
    previewImageUrl: null,
    aspectRatio: DEFAULT_ASPECT_RATIO,
    isSizeManuallyAdjusted: false,
    prompt: '',
    modelId,
    params,
    mediaInputs: {},
    isGenerating: false,
    generationStartedAt: null,
    generationDurationMs: undefined,
    capabilityId: CANVAS_IMAGE_CAPABILITY_IDS.upscale,
    promptTemplateVersion: null,
    fixedSemanticParams: {
      maxOutputMegapixels: 48,
      maxInputFileBytes: 20 * 1024 * 1024,
    },
  };
}

const upscaleGenerationNodeDefinition: CanvasNodeDefinition<UpscaleGenerationNodeData> = {
  type: CANVAS_NODE_TYPES.upscaleGen,
  menuLabelKey: 'node.menu.upscaleGeneration',
  menuIcon: 'imageGeneration',
  visibleInMenu: false,
  executionKind: 'standard-generation',
  capabilities: {
    toolbar: true,
    promptInput: false,
    toolbarGenerate: true,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: { fromSource: true, fromTarget: false },
    targetHandleMode: 'rows',
  },
  media: { kind: 'image', role: 'generator' },
  ports: {
    source: { emits: 'image' },
    target: { accepts: ['image'] },
  },
  generation: {
    modelType: 'image',
    resultNodeType: CANVAS_NODE_TYPES.exportImage,
  },
  getOutputs: imageOutputsFromData,
  createDefaultData: createUpscaleGenerationDefaultData,
};

function createPortraitTextureGenerationDefaultData(): PortraitTextureGenerationNodeData {
  const settings = { ...DEFAULT_PORTRAIT_TEXTURE_SETTINGS };
  const route = preparePortraitTextureRoute(
    settings,
    registry.getModelsByType('image'),
    PORTRAIT_TEXTURE_DEFAULT_MODEL_ID,
  );
  return {
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.portraitTextureGen],
    imageUrl: null,
    previewImageUrl: null,
    aspectRatio: DEFAULT_ASPECT_RATIO,
    isSizeManuallyAdjusted: false,
    prompt: route.prompt,
    modelId: route.model?.meta.id ?? PORTRAIT_TEXTURE_DEFAULT_MODEL_ID,
    params: route.params,
    mediaInputs: {},
    isGenerating: false,
    generationStartedAt: null,
    generationDurationMs: undefined,
    capabilityId: CANVAS_IMAGE_CAPABILITY_IDS.portraitTexture,
    promptTemplateVersion: PORTRAIT_TEXTURE_TEMPLATE_VERSION,
    fixedSemanticParams: { portraitTextureContractVersion: 1 },
    portraitTextureSettings: settings as unknown as DynamicValueMap,
    portraitTextureRouteReasons: route.reasons,
  };
}

const portraitTextureGenerationNodeDefinition: CanvasNodeDefinition<PortraitTextureGenerationNodeData> = {
  type: CANVAS_NODE_TYPES.portraitTextureGen,
  menuLabelKey: 'node.menu.portraitTextureGeneration',
  menuIcon: 'imageGeneration',
  visibleInMenu: false,
  executionKind: 'standard-generation',
  capabilities: {
    toolbar: true,
    promptInput: false,
    toolbarGenerate: true,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: { fromSource: true, fromTarget: false },
    targetHandleMode: 'rows',
  },
  media: { kind: 'image', role: 'generator' },
  ports: {
    source: { emits: 'image' },
    target: { accepts: ['image'] },
  },
  generation: {
    modelType: 'image',
    resultNodeType: CANVAS_NODE_TYPES.exportImage,
  },
  getOutputs: imageOutputsFromData,
  createDefaultData: createPortraitTextureGenerationDefaultData,
};

function createElementEditGenerationDefaultData(): ElementEditGenerationNodeData {
  const candidates = resolveCanvasCapabilityModelCandidates(
    registry.getModelsByType('image'),
    ELEMENT_EDIT_MODEL_POLICY,
  ).candidates.map(({ model }) => model);
  const model = selectDefaultElementEditModel(candidates);
  const modelId = model?.meta.id ?? ELEMENT_EDIT_DEFAULT_MODEL_ID;
  const params = model
    ? mapCanvasCapabilityModelParams(model, ELEMENT_EDIT_MODEL_POLICY).params
    : {};
  return {
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.elementEditGen],
    imageUrl: null,
    previewImageUrl: null,
    aspectRatio: DEFAULT_ASPECT_RATIO,
    isSizeManuallyAdjusted: false,
    prompt: '',
    modelId,
    params,
    mediaInputs: {},
    isGenerating: false,
    generationStartedAt: null,
    generationDurationMs: undefined,
    capabilityId: CANVAS_IMAGE_CAPABILITY_IDS.elementEdit,
    promptTemplateVersion: ELEMENT_EDIT_PROMPT_TEMPLATE_VERSION,
    fixedSemanticParams: { ...ELEMENT_EDIT_FIXED_SEMANTIC_PARAMS },
  };
}

const elementEditGenerationNodeDefinition: CanvasNodeDefinition<ElementEditGenerationNodeData> = {
  type: CANVAS_NODE_TYPES.elementEditGen,
  menuLabelKey: 'node.menu.elementEditGeneration',
  menuIcon: 'imageGeneration',
  visibleInMenu: false,
  executionKind: 'standard-generation',
  capabilities: {
    toolbar: true,
    promptInput: false,
    toolbarGenerate: true,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: { fromSource: true, fromTarget: false },
    targetHandleMode: 'rows',
  },
  media: { kind: 'image', role: 'generator' },
  ports: {
    source: { emits: 'image' },
    target: { accepts: ['image'] },
  },
  generation: {
    modelType: 'image',
    resultNodeType: CANVAS_NODE_TYPES.exportImage,
  },
  getOutputs: imageOutputsFromData,
  createDefaultData: createElementEditGenerationDefaultData,
};

function createLayerSeparationGenerationDefaultData(): LayerSeparationGenerationNodeData {
  const candidates = resolveCanvasCapabilityModelCandidates(
    registry.getModelsByType('image'),
    LAYER_SEPARATION_MODEL_POLICY,
  ).candidates.map(({ model }) => model);
  const model = selectDefaultLayerSeparationModel(candidates);
  return {
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.layerSeparationGen],
    imageUrl: null,
    previewImageUrl: null,
    aspectRatio: DEFAULT_ASPECT_RATIO,
    isSizeManuallyAdjusted: false,
    prompt: '',
    modelId: model?.meta.id ?? LAYER_SEPARATION_DEFAULT_MODEL_ID,
    params: model ? mapCanvasCapabilityModelParams(model, LAYER_SEPARATION_MODEL_POLICY).params : {},
    mediaInputs: {},
    isGenerating: false,
    generationStartedAt: null,
    generationDurationMs: undefined,
    capabilityId: CANVAS_IMAGE_CAPABILITY_IDS.layerSeparation,
    promptTemplateVersion: null,
    fixedSemanticParams: { layerStackContractVersion: LAYER_STACK_CONTRACT_VERSION },
  };
}

const layerSeparationGenerationNodeDefinition: CanvasNodeDefinition<LayerSeparationGenerationNodeData> = {
  type: CANVAS_NODE_TYPES.layerSeparationGen,
  menuLabelKey: 'node.menu.layerSeparationGeneration',
  menuIcon: 'imageGeneration',
  visibleInMenu: false,
  executionKind: 'standard-generation',
  capabilities: { toolbar: true, promptInput: true, toolbarGenerate: true },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: { fromSource: true, fromTarget: false },
    targetHandleMode: 'rows',
  },
  media: { kind: 'image', role: 'generator' },
  ports: { source: { emits: 'image' }, target: { accepts: ['image'] } },
  generation: { modelType: 'image', resultNodeType: CANVAS_NODE_TYPES.layerStackResult },
  getOutputs: imageOutputsFromData,
  createDefaultData: createLayerSeparationGenerationDefaultData,
};

const layerStackResultNodeDefinition: CanvasNodeDefinition<LayerStackResultNodeData> = {
  type: CANVAS_NODE_TYPES.layerStackResult,
  menuLabelKey: 'node.menu.layerStackResult',
  menuIcon: 'assetGroup',
  visibleInMenu: false,
  capabilities: { toolbar: true, promptInput: false, toolbarDownload: true },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: { fromSource: false, fromTarget: false },
    manualSource: true,
  },
  media: { kind: 'image', role: 'result' },
  ports: { source: { emits: 'image' }, target: { accepts: ['image'] } },
  getOutputs: imageOutputsFromData,
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.layerStackResult],
    imageUrl: null,
    previewImageUrl: null,
    aspectRatio: DEFAULT_ASPECT_RATIO,
    resultKind: 'layer-stack',
  }),
};

const exportImageNodeDefinition: CanvasNodeDefinition<ExportImageNodeData> = {
  type: CANVAS_NODE_TYPES.exportImage,
  menuLabelKey: 'node.menu.uploadImage',
  menuIcon: 'upload',
  visibleInMenu: false,
  capabilities: {
    toolbar: true,
    promptInput: false,
    toolbarDownload: true,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
    manualSource: true,
  },
  media: { kind: 'image', role: 'result' },
  ports: {
    source: { emits: 'image' },
    target: { accepts: ['image'] },
  },
  getOutputs: imageOutputsFromData,

  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.exportImage],
    imageUrl: null,
    previewImageUrl: null,
    aspectRatio: DEFAULT_ASPECT_RATIO,
    isSizeManuallyAdjusted: false,
    resultKind: 'generic',
  }),
};

const groupNodeDefinition: CanvasNodeDefinition<GroupNodeData> = {
  type: CANVAS_NODE_TYPES.group,
  menuLabelKey: 'node.menu.storyboard',
  menuIcon: 'storyboard',
  visibleInMenu: false,
  capabilities: {
    toolbar: false,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: false,
    targetHandle: false,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.group],
    label: '组',
  }),
};

const assetGroupNodeDefinition: CanvasNodeDefinition<AssetGroupNodeData> = {
  type: CANVAS_NODE_TYPES.assetGroup,
  menuLabelKey: 'node.menu.assetGroup',
  menuIcon: 'assetGroup',
  visibleInMenu: false,
  capabilities: { toolbar: true, promptInput: false },
  connectivity: {
    sourceHandle: true,
    targetHandle: false,
    connectMenu: { fromSource: false, fromTarget: false },
    manualSource: true,
  },
  // 实际媒体类型由组成员展开，组端口只负责启动绑定手势，不能作为普通媒体边使用。
  ports: { source: { emits: 'image' } },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.assetGroup],
    memberOrder: [],
    coverMemberId: null,
    bindings: [],
  }),
};

const textAnnotationNodeDefinition: CanvasNodeDefinition<TextAnnotationNodeData> = {
  type: CANVAS_NODE_TYPES.textAnnotation,
  menuLabelKey: 'node.menu.textAnnotation',
  menuIcon: 'textAnnotation',
  visibleInMenu: true,
  menuSection: 'textTools',
  menuOrder: 20,
  executionKind: 'text-display',
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: false,
      fromTarget: true,
    },
    manualSource: true,
  },
  ports: {
    source: { emits: 'text' },
    target: { accepts: ['text'] },
  },
  getValueOutput: (data) => ({
    socketType: 'STRING',
    value: (data as TextAnnotationNodeData).content,
  }),
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.textAnnotation],
    content: '',
    isGenerating: false,
    generationStartedAt: null,
    generationError: null,
  }),
};

const textProcessingNodeDefinition: CanvasNodeDefinition<TextProcessingNodeData> = {
  type: CANVAS_NODE_TYPES.textProcessing,
  menuLabelKey: 'node.menu.textProcessing',
  menuIcon: 'textProcessing',
  visibleInMenu: true,
  menuSection: 'textTools',
  menuOrder: 10,
  executionKind: 'text-processing',
  capabilities: {
    toolbar: true,
    promptInput: false,
    toolbarGenerate: true,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: true,
      fromTarget: false,
    },
    manualSource: true,
    targetHandleMode: 'rows',
  },
  ports: {
    source: { emits: 'text' },
    target: { accepts: ['image', 'video', 'audio'] },
  },
  getValueOutput: (data) => ({
    socketType: 'STRING',
    value: (data as TextProcessingNodeData).lastOutput ?? '',
  }),
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.textProcessing],
    prompt: '',
    systemPrompt: '',
    mediaInputs: {},
    providerId: DEFAULT_PPIO_PROVIDER_ID,
    modelId: DEFAULT_PPIO_MODEL_ID,
    lastOutput: '',
    fixedResult: true,
    lastOutputFingerprint: undefined,
    lastOutputRevision: 0,
    lastExecutionStatus: undefined,
  }),
};

const cameraStageNodeDefinition: CanvasNodeDefinition<CameraStageNodeData> = {
  type: CANVAS_NODE_TYPES.cameraStage,
  menuLabelKey: 'node.menu.cameraStage',
  menuIcon: 'cameraStage',
  visibleInMenu: true,
  menuSection: 'textTools',
  menuOrder: 30,
  capabilities: { toolbar: true, promptInput: false },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: { fromSource: false, fromTarget: true },
    manualSource: false,
    targetHandleMode: 'rows',
  },
  ports: { source: { emits: 'image' }, target: { accepts: ['image'] } },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.cameraStage],
    projectId: null,
    imageUrl: null,
    previewImageUrl: null,
    videoUrl: null,
    aspectRatio: '16:9',
    durationSec: null,
    selectedTimeSec: 0,
    mediaInputs: {},
    environmentImageUrl: null,
    imageExporting: false,
    imageRenderRequestId: null,
    imageRenderError: null,
    videoProgress: null,
    videoExporting: false,
    videoRenderPhase: null,
    videoRenderRequestId: null,
    assetCollectionEnabled: false,
    assetCollectionLibraryId: null,
    videoRenderError: null,
    outputKind: 'image',
  }),
};

const storyboardSplitDefinition: CanvasNodeDefinition<StoryboardSplitNodeData> = {
  type: CANVAS_NODE_TYPES.storyboardSplit,
  menuLabelKey: 'node.menu.storyboard',
  menuIcon: 'storyboard',
  visibleInMenu: false,
  capabilities: {
    toolbar: false,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
    targetHandleMode: 'rows',
  },
  media: { kind: 'image', role: 'result' },
  ports: {
    source: { emits: 'image' },
    target: { accepts: ['image'] },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.storyboardSplit],
    aspectRatio: DEFAULT_ASPECT_RATIO,
    frameAspectRatio: DEFAULT_ASPECT_RATIO,
    gridRows: 2,
    gridCols: 2,
    frames: [],
    exportOptions: {
      showFrameIndex: false,
      showFrameNote: false,
      notePlacement: 'overlay',
      imageFit: 'cover',
      frameIndexPrefix: 'S',
      cellGap: 8,
      outerPadding: 0,
      fontSize: 4,
      backgroundColor: CANVAS_BG_HEX,
      textColor: CANVAS_TEXT_HEX,
    },
  }),
};

/** 分镜生成始终向模型发送栅格参考图，因此默认模型也只能从支持图片编辑的模型中选取 */
const STORYBOARD_GEN_MODEL_REQUIRED_TAGS: ModelTag[] = ['image-to-image'];

const storyboardGenNodeDefinition: CanvasNodeDefinition<StoryboardGenNodeData> = {
  type: CANVAS_NODE_TYPES.storyboardGen,
  menuLabelKey: 'node.menu.storyboardGen',
  menuIcon: 'storyboard',
  visibleInMenu: true,
  menuSection: 'media',
  menuOrder: 50,
  executionKind: 'storyboard-generation',
  capabilities: {
    toolbar: true,
    promptInput: false,
    toolbarGenerate: true,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: true,
      fromTarget: false,
    },
    targetHandleMode: 'rows',
  },
  media: { kind: 'image', role: 'generator' },
  ports: {
    source: { emits: 'image' },
    target: { accepts: ['image'] },
  },
  generation: {
    modelType: 'image',
    resultNodeType: CANVAS_NODE_TYPES.exportImage,
  },
  getOutputs: imageOutputsFromData,

  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.storyboardGen],
    gridRows: 2,
    gridCols: 2,
    frames: [],
    modelId: getDefaultModelId('image', STORYBOARD_GEN_MODEL_REQUIRED_TAGS),
    params: {},
    mediaInputs: {},
    imageUrl: null,
    previewImageUrl: null,
    aspectRatio: DEFAULT_ASPECT_RATIO,
    isGenerating: false,
    generationStartedAt: null,
    generationDurationMs: undefined,
  }),
};

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

export function getNodeDefinition(type: CanvasNodeType): CanvasNodeDefinition {
  return canvasNodeDefinitions[type];
}

/**
 * 运行时注册一个画布节点定义（第三方扩展接口的落点）。
 *
 * 内置节点在本模块静态注册；第三方扩展通过 CanvasExtension 在运行时调用本函数，
 * 之后该节点与内置节点走完全一致的渲染/连接/生成链路。
 */
export function registerCanvasNode(definition: CanvasNodeDefinition): void {
  (canvasNodeDefinitions as Record<string, CanvasNodeDefinition>)[definition.type] = definition;
}

/** 按类型取节点定义（不存在返回 undefined，区别于 getNodeDefinition 的非空契约） */
export function getCanvasNodeDefinition(type: CanvasNodeType | string): CanvasNodeDefinition | undefined {
  return (canvasNodeDefinitions as Record<string, CanvasNodeDefinition>)[type];
}

/**
 * 反查某个结果节点类型对应的媒体类型（exportVideoNode → 'video'）。
 * 从 generation.resultNodeType 声明推导，新增生成节点无需在这里补映射表。
 */
export function getResultNodeMediaType(
  resultNodeType: CanvasNodeType | string
): 'image' | 'video' | 'audio' | undefined {
  for (const definition of Object.values(canvasNodeDefinitions)) {
    if (definition.generation?.resultNodeType === resultNodeType) {
      return definition.generation.modelType;
    }
  }
  return undefined;
}

export function getMenuNodeDefinitions(): CanvasNodeDefinition[] {
  return Object.values(canvasNodeDefinitions).filter((definition) => definition.visibleInMenu);
}

export function nodeHasSourceHandle(type: CanvasNodeType): boolean {
  return canvasNodeDefinitions[type].connectivity.sourceHandle;
}

export function nodeHasTargetHandle(type: CanvasNodeType): boolean {
  return canvasNodeDefinitions[type].connectivity.targetHandle;
}

export function getConnectMenuNodeTypes(
  handleType: 'source' | 'target',
  fromNodeType?: CanvasNodeType
): CanvasNodeType[] {
  const fromSource = handleType === 'source';
  const fromDefinition = fromNodeType ? canvasNodeDefinitions[fromNodeType] : undefined;

  return Object.values(canvasNodeDefinitions)
    .filter((definition) => (fromSource
      ? definition.connectivity.connectMenu.fromSource
      : definition.connectivity.connectMenu.fromTarget))
    .filter((definition) => (fromSource
      ? definition.connectivity.targetHandle
      : definition.connectivity.sourceHandle))
    .filter((definition) => {
      if (!fromDefinition) {
        return true;
      }
      // 按端口媒体类型过滤：从输出端口拖出 → 候选节点需接受该媒体；反之亦然
      return fromSource
        ? arePortsCompatible(fromDefinition.ports, definition.ports)
        : arePortsCompatible(definition.ports, fromDefinition.ports);
    })
    .map((definition) => definition.type);
}

/** 连接是否类型兼容（上游 emits ∈ 下游 accepts） */
export function isConnectionCompatible(
  sourceType: CanvasNodeType,
  targetType: CanvasNodeType,
  sourceHandle?: string | null,
  sourceData?: CanvasNodeData,
): boolean {
  if (sourceData) {
    const emits = resolveNodeSourceMediaKind(sourceType, sourceData, sourceHandle)
    const accepts = canvasNodeDefinitions[targetType]?.ports?.target?.accepts
    if (emits) {
      return Boolean(accepts?.includes(emits))
    }
    const sourceDefinition = canvasNodeDefinitions[sourceType]
    const acceptedMediaKinds = accepts?.filter((kind): kind is MediaPortKind => (
      kind === 'image' || kind === 'video' || kind === 'audio'
    )) ?? []
    return Boolean(
      sourceDefinition?.connectivity.lockSourceMediaOnFirstConnection
      && (sourceHandle ?? 'source') === 'source'
      && acceptedMediaKinds.length === 1
      && Object.values(sourceDefinition.ports?.source?.handles ?? {})
        .includes(acceptedMediaKinds[0])
    )
  }
  return arePortsCompatible(
    canvasNodeDefinitions[sourceType]?.ports,
    canvasNodeDefinitions[targetType]?.ports,
    sourceHandle,
  );
}

/**
 * 解析节点当前允许使用的输出媒体类型。静态端口声明负责 handle→类型映射，
 * 可锁定节点再由 data 收窄，避免把运行时状态写成节点类型特判。
 */
export function resolveNodeSourceMediaKind(
  sourceType: CanvasNodeType,
  sourceData: CanvasNodeData,
  sourceHandle?: string | null,
): MediaPortKind | undefined {
  const definition = canvasNodeDefinitions[sourceType]
  const lockedKind = (sourceData as { lockedMediaKind?: DynamicValue }).lockedMediaKind
  const normalizedSourceHandle = sourceHandle ?? 'source'
  if (
    definition.connectivity.lockSourceMediaOnFirstConnection
    && normalizedSourceHandle === 'source'
  ) {
    return lockedKind === 'image' || lockedKind === 'video' || lockedKind === 'audio'
      ? lockedKind
      : undefined
  }
  const declaredKind = getSourcePortMediaKind(definition?.ports, sourceHandle)
  if (declaredKind !== 'image' && declaredKind !== 'video' && declaredKind !== 'audio') {
    return undefined
  }
  if (!definition.connectivity.lockSourceMediaOnFirstConnection) {
    return declaredKind
  }
  if (
    (lockedKind === 'image' || lockedKind === 'video' || lockedKind === 'audio')
    && lockedKind !== declaredKind
  ) {
    return undefined
  }
  return declaredKind
}

/** 节点是否允许从输出端口手动拖出连线 */
export function canNodeTypeStartManualConnection(type: CanvasNodeType): boolean {
  return canvasNodeDefinitions[type]?.connectivity.manualSource === true;
}

/** 提取节点对下游的媒体输出 */
export function getNodeMediaOutputs(
  type: CanvasNodeType,
  data: CanvasNodeData,
  sourceHandle?: string,
): ReturnType<NonNullable<CanvasNodeDefinition['getOutputs']>> {
  const definition = canvasNodeDefinitions[type];
  return definition?.getOutputs?.(data, sourceHandle) ?? [];
}

/** 提取节点对下游参数端口的标量值输出（无则返回 null） */
export function getNodeValueOutput(
  type: CanvasNodeType,
  data: CanvasNodeData
): NodeValueOutput | null {
  const definition = canvasNodeDefinitions[type];
  return definition?.getValueOutput?.(data) ?? null;
}
