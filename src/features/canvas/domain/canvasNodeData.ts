import type { PromptDocumentV1, PromptMediaBinding } from '@/core/inputs/promptDocument';
import type { ImageEditSessionReferenceV3 } from '@/core/imageEdit/v3/sessionReference';
import type { MaskEditorDocument } from '@/features/maskEditor';
import type { LocalRedrawSettings } from '@/platform/contracts/image';

import type {
  CanvasGenerationResultKind,
  CanvasGenerationOutputDescriptorV1,
  CanvasGenerationOutputStrategy,
} from './generationOutputs';
import type { LayerStackDocumentV1 } from './layerStack';
import type {
  PanoramaCameraView,
  PanoramaProjectionMode,
  PanoramaViewMode,
  PanoramaViewportAspectRatio,
} from './panoramaViewer';
import type { RowMediaKind } from './socketTypes';
import {
  CANVAS_NODE_TYPES,
  type ImageSize,
} from './canvasNodeConstants';
import type { CanvasNodeData } from './canvasNodes';

export interface NodeDisplayData {
  displayName?: string;
  [key: string]: DynamicValue;
}

/**
 * 结果节点的生成状态。
 * 占位节点在点击生成时就已建好（见 GenerationNodeShell），这组字段描述它此刻处于
 * 生成中 / 成功 / 失败的哪一态；失败原因写在这里而不是回挂到发起节点上。
 */
export interface NodeGenerationStatus {
  isGenerating?: boolean;
  generationStartedAt?: number | null;
  generationDurationMs?: number;
  /** 生成失败原因；有值时结果节点显示红色描边与错误内容 */
  generationError?: string | null;
  /**
   * 服务端异步任务 ID。异步任务一旦创建就写在这里并随项目持久化，
   * 应用重启后据此继续轮询（见 useCanvasResumePolling），出结果或明确失败前不丢任务。
   */
  serverTaskId?: string | null;
  /** 续查时需要用原模型发请求，与 serverTaskId 成对写入 */
  serverTaskModelId?: string | null;
  /** 同一次生成完成回调的幂等键；成员和结果组共享。 */
  generationOutputCommitId?: string;
  /** 成员在多结果批次中的稳定顺序与业务语义。 */
  generationOutputDescriptor?: CanvasGenerationOutputDescriptorV1;
}

export interface NodeImageData extends NodeDisplayData, NodeGenerationStatus {
  imageUrl: string | null;
  previewImageUrl?: string | null;
  aspectRatio: string;
  isSizeManuallyAdjusted?: boolean;
  [key: string]: DynamicValue;
}

export interface UploadImageNodeData extends NodeImageData {
  sourceFileName?: string | null;
}

export const CANVAS_IMAGE_RESULT_KINDS = [
  'image',
  'panorama',
  'image-group',
  'layer-stack',
] as const;

/** 可持久化的图片结果语义；图片组与图层栈在 4.x 任务前只作契约占位。 */
export type CanvasImageResultKind = (typeof CANVAS_IMAGE_RESULT_KINDS)[number];

/** 旧结果来源值仍保留，用于分镜等节点的默认标题兼容。 */
export type LegacyExportImageNodeResultKind =
  | 'generic'
  | 'storyboardGenOutput'
  | 'storyboardSplitExport'
  | 'storyboardFrameEdit';

export type ExportImageNodeResultKind =
  | 'image'
  | LegacyExportImageNodeResultKind;

export const CANVAS_IMAGE_VIEWER_MODES = ['image', 'panorama'] as const;
export type CanvasImageViewerMode = (typeof CANVAS_IMAGE_VIEWER_MODES)[number];

export interface CanvasImageViewerRequest {
  imageUrl: string;
  imageList?: string[];
  mode?: CanvasImageViewerMode;
  /** 有来源节点时用于节点删除后关闭查看器；旧调用可不传。 */
  sourceNodeId?: string;
}

export function resolveCanvasImageResultKind(value: unknown): CanvasImageResultKind {
  if (value === 'panorama' || value === 'image-group' || value === 'layer-stack') {
    return value;
  }
  return 'image';
}

export function resolveCanvasImageViewerMode(value: unknown): CanvasImageViewerMode {
  return value === 'panorama' ? 'panorama' : 'image';
}

export interface ExportImageNodeData extends NodeImageData {
  resultKind?: ExportImageNodeResultKind;
  /** 图片编辑 V3 派生结果的可恢复权威会话，不保存文档 JSON 或像素。 */
  imageEditSession?: ImageEditSessionReferenceV3;
}

export interface GroupNodeData extends NodeDisplayData {
  label: string;
  [key: string]: DynamicValue;
}

export interface AssetGroupBinding {
  id: string;
  targetNodeId: string;
  targetPortByKind: Partial<Record<RowMediaKind, string>>;
  excludedMemberIds: string[];
}

export interface AssetGroupNodeData extends NodeDisplayData {
  memberOrder: string[];
  coverMemberId: string | null;
  bindings: AssetGroupBinding[];
  /** 生成结果组才有；普通手工素材组保持缺省。 */
  resultKind?: Extract<CanvasGenerationResultKind, 'image-group' | 'media-group' | 'layer-stack'>;
  generationOutputCommitId?: string;
  generationOutputStrategy?: CanvasGenerationOutputStrategy;
  generationOutputDescriptors?: CanvasGenerationOutputDescriptorV1[];
}

export interface TextProcessingNodeData extends NodeDisplayData {
  prompt: string;
  promptDocument?: PromptDocumentV1;
  promptMediaBindings?: PromptMediaBinding[];
  systemPrompt: string;
  systemPromptDocument?: PromptDocumentV1;
  systemPromptTemplateId?: string;
  mediaInputs?: Partial<Record<RowMediaKind, string[]>>;
  providerId: string;
  modelId: string;
  lastOutput?: string;
  /** 下游运行时是否允许复用输入未变化的最近一次成功结果。 */
  fixedResult?: boolean;
  /** 最近一次成功结果对应的规范化输入指纹。 */
  lastOutputFingerprint?: string;
  /** 每次成功运行递增，用于通知文本展示节点同内容也需要重新同步。 */
  lastOutputRevision?: number;
  /** 最近一次实际执行的状态；失败后不得继续静默复用旧结果。 */
  lastExecutionStatus?: 'success' | 'failed';
  [key: string]: DynamicValue;
}

/** 尚未识别媒体类型的统一上传占位节点；识别成功后会原位替换为具体媒体源节点。 */
export interface UniversalUploadNodeData extends NodeDisplayData {
  /** 首次连线锁定的媒体类型；断开连线后仍保持，撤销该次连线则恢复未锁定。 */
  lockedMediaKind?: RowMediaKind | null;
  uploadError?: 'unsupported' | 'typeMismatch' | 'failed' | null;
}

export type ConcreteUploadNodeType =
  | typeof CANVAS_NODE_TYPES.upload
  | typeof CANVAS_NODE_TYPES.videoUpload
  | typeof CANVAS_NODE_TYPES.audioUpload;

export interface UploadPlaceholderResolution {
  type: ConcreteUploadNodeType;
  data: Partial<CanvasNodeData>;
}

export interface TextAnnotationNodeData extends NodeDisplayData, NodeGenerationStatus {
  content: string;
  /** 最近一次已同步的上游节点与输出修订，避免重渲染覆盖用户手工编辑。 */
  syncedInputRevision?: string;
  [key: string]: DynamicValue;
}

export interface ImageEditNodeData extends NodeImageData {
  prompt: string;
  promptDocument?: PromptDocumentV1;
  promptMediaBindings?: PromptMediaBinding[];
  mediaInputs?: Partial<Record<RowMediaKind, string[]>>;
  /** 核心 ModelRegistry 中的模型 ID */
  modelId?: string;
  /** schema 驱动的模型参数（与默认值合并后使用） */
  params?: DynamicValueMap;
  /** @deprecated 旧版字段，由 nodeMigrations 迁移到 modelId/params */
  model?: string;
  /** @deprecated 旧版字段 */
  size?: ImageSize;
  /** @deprecated 旧版字段 */
  requestAspectRatio?: string;
  /** @deprecated 旧版字段 */
  extraParams?: DynamicValueMap;
  isGenerating?: boolean;
  generationStartedAt?: number | null;
  generationDurationMs?: number;
}

export interface PanoramaGenerationNodeData extends ImageEditNodeData {
  /** 稳定产品能力编号；损坏或旧值在项目载入时恢复。 */
  capabilityId: 'image.panorama';
  /** 当前根据有无参考图选中的隐藏模板版本。 */
  promptTemplateVersion:
    | 'panorama-equirectangular-text-v1'
    | 'panorama-equirectangular-reference-v1';
  /** 节点创建时固化的能力语义，便于项目重开后解释历史配置。 */
  fixedSemanticParams: DynamicValueMap;
  /** 默认可编辑提示词只自动写入一次；用户清空后不会再次回填。 */
  defaultPromptVersion?: 'panorama-user-default-v1';
}

export interface PanoramaViewerNodeData extends NodeImageData {
  resultKind: 'panorama';
  mediaInputs?: Partial<Record<RowMediaKind, string[]>>;
  /** 严格 2:1 或 Nano Banana 21:9 实验宽幅球面投影。 */
  panoramaProjectionMode: PanoramaProjectionMode;
  /** 当前球面相机的节点预览图；与源全景图的等距柱状缩略图分开持久化。 */
  panoramaPreviewImageUrl?: string | null;
  /** 节点内显示方式；不改变源图严格 2:1 的等距柱状投影语义。 */
  viewMode: PanoramaViewMode;
  /** 只决定观察窗口与视角截图构图，不能用于全景源图下载或 GPano 判定。 */
  viewportAspectRatio: PanoramaViewportAspectRatio;
  /** 拖拽过程中保持本地状态，只在交互结束时低频写回。 */
  cameraView: PanoramaCameraView;
}

export interface UpscaleGenerationNodeData extends ImageEditNodeData {
  capabilityId: 'image.upscale';
  promptTemplateVersion: null;
  fixedSemanticParams: DynamicValueMap;
}

export interface PortraitTextureGenerationNodeData extends ImageEditNodeData {
  capabilityId: 'image.portrait-texture';
  promptTemplateVersion: 'portrait-texture-gpt-image-2-v1';
  fixedSemanticParams: DynamicValueMap;
  portraitTextureSettings: DynamicValueMap;
  portraitTextureRouteReasons?: string[];
}

export interface ElementEditGenerationNodeData extends ImageEditNodeData {
  capabilityId: 'image.element-edit';
  promptTemplateVersion: 'local-redraw-crop-v2';
  fixedSemanticParams: DynamicValueMap;
  localRedrawMaskSource?: string | null;
  localRedrawMaskDocument?: MaskEditorDocument | null;
  localRedrawSettings: LocalRedrawSettings;
}

export interface LayerSeparationGenerationNodeData extends ImageEditNodeData {
  capabilityId: 'image.layer-separation';
  promptTemplateVersion: null;
  fixedSemanticParams: DynamicValueMap;
}

export interface LayerStackResultNodeData extends NodeImageData {
  resultKind: 'layer-stack';
  /** V3 完成态的唯一可编辑文档引用；sourceUrl 必须与 imageUrl 一致。 */
  imageEditSession?: ImageEditSessionReferenceV3;
  /** @deprecated 仅供旧 V1 节点读取与迁移，新完成态不得将其当作权威文档。 */
  layerStackDocument?: LayerStackDocumentV1;
}

export interface MultiAngleGenerationNodeData extends ImageEditNodeData {
  capabilityId: 'image.multi-angle';
  multiAngleConfig: DynamicValueMap;
  multiAngleBatch?: DynamicValueMap | null;
  multiAngleResultPlaceholderId?: string | null;
  sourceImageUrl?: string | null;
}

export interface StoryboardFrameItem {
  id: string;
  imageUrl: string | null;
  previewImageUrl?: string | null;
  aspectRatio?: string;
  note: string;
  noteDocument?: PromptDocumentV1;
  order: number;
}

export interface StoryboardExportOptions {
  showFrameIndex: boolean;
  showFrameNote: boolean;
  notePlacement: 'overlay' | 'bottom';
  imageFit: 'cover' | 'contain';
  frameIndexPrefix: string;
  cellGap: number;
  outerPadding: number;
  fontSize: number;
  backgroundColor: string;
  textColor: string;
}

export interface StoryboardSplitNodeData {
  displayName?: string;
  aspectRatio: string;
  frameAspectRatio?: string;
  gridRows: number;
  gridCols: number;
  frames: StoryboardFrameItem[];
  exportOptions?: StoryboardExportOptions;
  [key: string]: DynamicValue;
}

export interface StoryboardGenFrameItem {
  id: string;
  description: string;
  descriptionDocument?: PromptDocumentV1;
  referenceIndex: number | null;
}

export interface StoryboardGenNodeData {
  displayName?: string;
  /** 能力入口创建的固定预设；普通分镜节点保持缺省。 */
  storyboardPreset?: 'nine-grid-v1';
  capabilityId?: 'image.nine-grid';
  promptTemplateVersion?: 'nine-grid-storyboard-v1';
  gridRows: number;
  gridCols: number;
  frames: StoryboardGenFrameItem[];
  /** 核心 ModelRegistry 中的模型 ID */
  modelId?: string;
  /** schema 驱动的模型参数（与默认值合并后使用） */
  params?: DynamicValueMap;
  /** 图片行未连线时的本地内联上传值 */
  mediaInputs?: Partial<Record<RowMediaKind, string[]>>;
  promptMediaBindings?: PromptMediaBinding[];
  /** @deprecated 旧版字段，由 nodeMigrations 迁移到 modelId/params */
  model?: string;
  /** @deprecated 旧版字段 */
  size?: ImageSize;
  /** @deprecated 旧版字段 */
  requestAspectRatio?: string;
  /** @deprecated 旧版字段 */
  extraParams?: DynamicValueMap;
  imageUrl: string | null;
  previewImageUrl?: string | null;
  aspectRatio: string;
  isGenerating?: boolean;
  generationStartedAt?: number | null;
  generationDurationMs?: number;
  [key: string]: DynamicValue;
}

export interface MediaGenNodeData extends NodeDisplayData {
  prompt: string;
  promptDocument?: PromptDocumentV1;
  promptMediaBindings?: PromptMediaBinding[];
  mediaInputs?: Partial<Record<RowMediaKind, string[]>>;
  videoTrimStart?: number;
  videoTrimEnd?: number;
  modelId?: string;
  params?: DynamicValueMap;
  isGenerating?: boolean;
  generationStartedAt?: number | null;
  generationDurationMs?: number;
  [key: string]: DynamicValue;
}

export type VideoGenNodeData = MediaGenNodeData;
export type AudioGenNodeData = MediaGenNodeData;

export interface VideoMediaNodeData extends NodeDisplayData, NodeGenerationStatus {
  videoUrl: string | null;
  /** 视频首帧 poster（本地路径），节点展示与缩略图共用 */
  previewImageUrl?: string | null;
  aspectRatio: string;
  durationSec?: number | null;
  /** 新导入视频由主进程一次探测得出；旧工程缺省时播放器按需补探测。 */
  hasAudio?: boolean;
  sourceFileName?: string | null;
  isSizeManuallyAdjusted?: boolean;
  [key: string]: DynamicValue;
}

export interface CameraStageNodeData extends NodeDisplayData {
  projectId: string | null;
  imageUrl: string | null;
  previewImageUrl?: string | null;
  videoUrl: string | null;
  aspectRatio: string;
  durationSec: number | null;
  selectedTimeSec: number;
  mediaInputs?: Partial<Record<RowMediaKind, string[]>>;
  /** 由画布图片输入派生，并同步到 3D 工程的球面环境贴图。 */
  environmentImageUrl?: string | null;
  imageExporting?: boolean;
  imageRenderRequestId?: string | null;
  imageRenderError?: string | null;
  videoProgress?: number | null;
  videoExporting?: boolean;
  videoRenderPhase?: 'preparing' | 'rendering' | 'encoding' | null;
  videoRenderRequestId?: string | null;
  videoRenderError?: string | null;
  assetCollectionEnabled?: boolean;
  assetCollectionLibraryId?: string | null;
  /** 场景时间轴决定的唯一可用输出类型；旧节点缺省按静态图片处理。 */
  outputKind?: 'image' | 'video';
}

export interface AudioMediaNodeData extends NodeDisplayData, NodeGenerationStatus {
  audioUrl: string | null;
  durationSec?: number | null;
  sourceFileName?: string | null;
  [key: string]: DynamicValue;
}

/**
 * 数值/源节点数据：单一标量值，通过 getValueOutput 喂给下游参数端口。
 * value 的具体类型（number/string/boolean）由节点类型对应的插槽类型决定。
 */
export interface ValueSourceNodeData extends NodeDisplayData {
  value: number | string | boolean;
}

/** 模型选择器节点数据：按媒体类型选定一个模型，输出 MODEL 值供下游节点的模型端口覆盖 */
export interface ModelSelectorNodeData extends NodeDisplayData {
  modelId: string;
  /** 展开态：节点本体直出搜索+筛选+模型列表；未设置（旧节点）按折叠态处理 */
  isExpanded?: boolean;
}
