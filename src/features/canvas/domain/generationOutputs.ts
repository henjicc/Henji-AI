import type { CanvasImageResultKind } from './canvasNodes';
import type { RowMediaKind } from './socketTypes';

export const CANVAS_GENERATION_RESULT_KINDS = [
  'image',
  'video',
  'audio',
  'panorama',
  'image-group',
  'media-group',
  'layer-stack',
] as const;

export type CanvasGenerationResultKind =
  | CanvasImageResultKind
  | 'video'
  | 'audio'
  | 'media-group';

export const CANVAS_GENERATION_OUTPUT_STRATEGIES = [
  'single',
  'independent',
  'assetGroup',
  'layer-stack',
] as const;

export type CanvasGenerationOutputStrategy =
  (typeof CANVAS_GENERATION_OUTPUT_STRATEGIES)[number];

export interface CanvasGenerationOutputSemanticV1 {
  /** 稳定语义键，例如 camera-view、grid-cell、layer。 */
  kind: string;
  /** 成员结果自身的图片语义；组语义由落图策略另行保存。 */
  resultKind: CanvasGenerationResultKind;
  label?: string;
}

export interface CanvasGenerationOutputProfileV1 {
  /** 能力定义的稳定控制档，例如 continuous-v1 / discrete-v1。 */
  id: string;
  /** 只描述模型可承诺的控制等级，不把学习控制伪装成物理相机。 */
  precision?: string;
}

export interface CanvasGenerationOutputAngleV1 {
  /** 原生数值、离散预设或提示词近似，由 profile 决定解释方式。 */
  control: DynamicValueMap;
}

export interface CanvasGenerationOutputLayerV1 {
  index: number;
  name?: string;
  opacity?: number;
  blendMode?: string;
}

/**
 * 可持久化的单项输出描述。媒体地址仍写在结果节点标准字段中，避免项目打包时
 * 出现第二份未被媒体引用收集器重写的路径；这里仅保存媒体类型与稳定语义。
 */
export interface CanvasGenerationOutputDescriptorV1 {
  version: 1;
  outputId: string;
  order: number;
  sourceOutputIndex: number;
  mediaType: RowMediaKind;
  semantic: CanvasGenerationOutputSemanticV1;
  profile?: CanvasGenerationOutputProfileV1;
  angle?: CanvasGenerationOutputAngleV1;
  layer?: CanvasGenerationOutputLayerV1;
  metadata?: DynamicValueMap;
}

/** 运行时输入；source 只参与落盘，不会复制进持久化描述符。 */
export interface CanvasGenerationOutputItem {
  source: string;
  descriptor: CanvasGenerationOutputDescriptorV1;
}

export interface CanvasGenerationOutputBatchContractV1 {
  version: 1;
  strategy: CanvasGenerationOutputStrategy;
  resultKind: CanvasGenerationResultKind;
  expectedOutputCount?: number;
  outputs: CanvasGenerationOutputItem[];
}

/**
 * 图层栈的多项输出描述符描述各个可编辑图层；画布向下游发布的则是合成后的单一媒体节点。
 * completionId 已区分不同生成批次，因此这里使用固定语义身份，避免恢复与正常完成产生两套引用。
 */
export function createLayerStackCompositeOutputDescriptor(): CanvasGenerationOutputDescriptorV1 {
  return {
    version: 1,
    outputId: 'layer-stack-composite',
    order: 0,
    sourceOutputIndex: 0,
    mediaType: 'image',
    semantic: {
      kind: 'layer-stack-composite',
      resultKind: 'layer-stack',
    },
  };
}

export function createDefaultGenerationOutputItems(input: {
  sources: readonly string[];
  mediaType: RowMediaKind;
  resultKind?: CanvasGenerationResultKind;
  semanticKind?: string;
}): CanvasGenerationOutputItem[] {
  const resultKind = input.resultKind ?? input.mediaType;
  const semanticKind = input.semanticKind ?? 'generated-media';
  return input.sources.map((source, index) => ({
    source,
    descriptor: {
      version: 1,
      outputId: `output-${index + 1}`,
      order: index,
      sourceOutputIndex: index,
      mediaType: input.mediaType,
      semantic: { kind: semanticKind, resultKind },
    },
  }));
}
