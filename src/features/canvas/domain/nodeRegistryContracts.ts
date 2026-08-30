import type { CanvasNodeData, CanvasNodeType } from './canvasNodes';
import type {
  MediaKind,
  NodeGenerationSpec,
  NodeMediaOutput,
  NodePorts,
  NodeValueOutput,
} from './nodePorts';

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
  /** 动态类型占位等无法声明固定 media.kind、但仍必须提供媒体后才能越过的执行边界。 */
  executionBoundary?: 'media';
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
