import {
  CANVAS_NODE_TYPES,
  DEFAULT_ASPECT_RATIO,
  type CanvasNodeData,
  type CanvasNodeType,
  type CameraStageNodeData,
  type ExportImageNodeData,
  type GroupNodeData,
  type ImageEditNodeData,
  type StoryboardSplitNodeData,
  type StoryboardGenNodeData,
  type TextAnnotationNodeData,
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
  type MediaKind,
  type NodeGenerationSpec,
  type NodeMediaOutput,
  type NodePorts,
  type NodeValueOutput,
} from './nodePorts';
import { CANVAS_BG_HEX, CANVAS_TEXT_HEX } from '@/core/theme/colorTokens';
import type { ModelTag } from '@/core/types';

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

export type MenuIconKey = 'upload' | 'sparkles' | 'layout' | 'text' | 'video' | 'audio' | 'number' | 'toggle';

export interface CanvasNodeCapabilities {
  toolbar: boolean;
  promptInput: boolean;
  /**
   * 是否在选中节点时的顶部工具条显示"生成"按钮（默认 false）。
   * 仅逐行模式（GenerationNodeShell）节点声明为 true；节点内不再渲染生成按钮。
   */
  toolbarGenerate?: boolean;
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
}

export interface CanvasNodeDefinition<TData extends CanvasNodeData = CanvasNodeData> {
  type: CanvasNodeType;
  menuLabelKey: string;
  menuIcon: MenuIconKey;
  visibleInMenu: boolean;
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

const uploadNodeDefinition: CanvasNodeDefinition<UploadImageNodeData> = {
  type: CANVAS_NODE_TYPES.upload,
  menuLabelKey: 'node.menu.uploadImage',
  menuIcon: 'upload',
  visibleInMenu: true,
  capabilities: {
    toolbar: true,
    promptInput: false,
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
  menuIcon: 'sparkles',
  visibleInMenu: true,
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

const exportImageNodeDefinition: CanvasNodeDefinition<ExportImageNodeData> = {
  type: CANVAS_NODE_TYPES.exportImage,
  menuLabelKey: 'node.menu.uploadImage',
  menuIcon: 'upload',
  visibleInMenu: false,
  capabilities: {
    toolbar: true,
    promptInput: false,
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
  menuIcon: 'layout',
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

const textAnnotationNodeDefinition: CanvasNodeDefinition<TextAnnotationNodeData> = {
  type: CANVAS_NODE_TYPES.textAnnotation,
  menuLabelKey: 'node.menu.textAnnotation',
  menuIcon: 'text',
  visibleInMenu: true,
  capabilities: {
    toolbar: true,
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
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.textAnnotation],
    content: '',
  }),
};

const cameraStageNodeDefinition: CanvasNodeDefinition<CameraStageNodeData> = {
  type: CANVAS_NODE_TYPES.cameraStage,
  menuLabelKey: 'node.menu.cameraStage',
  menuIcon: 'video',
  visibleInMenu: true,
  capabilities: { toolbar: true, promptInput: false },
  connectivity: {
    sourceHandle: true,
    targetHandle: false,
    connectMenu: { fromSource: false, fromTarget: true },
    manualSource: false,
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.cameraStage],
    projectId: null,
    imageUrl: null,
    previewImageUrl: null,
    videoUrl: null,
    aspectRatio: '16:9',
    durationSec: null,
    selectedTimeSec: 0,
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
  menuIcon: 'layout',
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
  menuIcon: 'sparkles',
  visibleInMenu: true,
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
  [CANVAS_NODE_TYPES.upload]: uploadNodeDefinition,
  [CANVAS_NODE_TYPES.imageEdit]: imageEditNodeDefinition,
  [CANVAS_NODE_TYPES.exportImage]: exportImageNodeDefinition,
  [CANVAS_NODE_TYPES.textAnnotation]: textAnnotationNodeDefinition,
  [CANVAS_NODE_TYPES.group]: groupNodeDefinition,
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
): boolean {
  return arePortsCompatible(
    canvasNodeDefinitions[sourceType]?.ports,
    canvasNodeDefinitions[targetType]?.ports,
    sourceHandle,
  );
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
