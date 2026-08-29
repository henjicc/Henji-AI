import type { ModelTag } from '@/core/types';
import type {
  CanvasNodeType,
  NodeToolType,
} from '../domain/canvasNodes';
import type { MediaPortKind } from '../domain/nodePorts';

export const CANVAS_IMAGE_CAPABILITY_IDS = {
  panorama: 'image.panorama',
  relight: 'image.relight',
  multiAngle: 'image.multi-angle',
  nineGrid: 'image.nine-grid',
  upscale: 'image.upscale',
  portraitTexture: 'image.portrait-texture',
  elementEdit: 'image.element-edit',
  layerSeparation: 'image.layer-separation',
  gridSplit: 'image.grid-split',
} as const;

export type CanvasImageCapabilityId =
  (typeof CANVAS_IMAGE_CAPABILITY_IDS)[keyof typeof CANVAS_IMAGE_CAPABILITY_IDS];

export type CanvasImageCapabilityGroup =
  | 'generation'
  | 'enhancement'
  | 'editing'
  | 'structure'
  | 'local';

export type CanvasImageCapabilityIconKey =
  | 'panorama'
  | 'relight'
  | 'multiAngle'
  | 'nineGrid'
  | 'upscale'
  | 'portraitTexture'
  | 'elementEdit'
  | 'layerSeparation'
  | 'gridSplit';

export type CanvasImageCapabilityEditorKind =
  | 'standard'
  | 'relight'
  | 'multiAngle'
  | 'mask'
  | 'layers'
  | 'gridSplit';

export type CanvasImageCapabilityNodeKind =
  | 'standard-generation'
  | 'special-generation'
  | 'local-tool';

export type CanvasImageCapabilityResultKind =
  | 'image'
  | 'panorama'
  | 'image-group'
  | 'layer-stack';

export type CanvasImageCapabilityReleaseStage =
  | 'draft'
  | 'experimental'
  | 'available'
  | 'disabled';

export type CanvasImageCapabilityPostProcess =
  | 'none'
  | 'validate-panorama'
  | 'split-grid'
  | 'assemble-image-group'
  | 'assemble-layer-stack';

export interface CanvasImageCapabilitySourceRequirement {
  mediaTypes: readonly MediaPortKind[];
  minCount: number;
  maxCount: number;
  requireMaterializedMedia: boolean;
}

export interface CanvasImageCapabilityNodePresentation {
  kind: CanvasImageCapabilityNodeKind;
  editor: CanvasImageCapabilityEditorKind;
  /** 创建节点并完成连线后，是否立即打开已登记的专用编辑器。 */
  openEditorOnCreate?: boolean;
}

export type CanvasImageCapabilityExecution =
  | {
      kind: 'canvas-node';
      nodeType: CanvasNodeType;
      /** 能力创建节点时写入的版本化预设；只允许可序列化业务数据。 */
      initialData?: Readonly<Record<string, unknown>>;
    }
  | {
      kind: 'local-tool';
      toolType: NodeToolType;
    };

export type CanvasImageCapabilityImplementation =
  | {
      status: 'planned';
      execution: null;
    }
  | {
      status: 'implemented';
      execution: CanvasImageCapabilityExecution;
    };

export type CanvasImageCapabilityModelPolicy =
  | {
      mode: 'not-applicable';
    }
  | {
      /** 模型仍由复用节点的 schema 选择器管理，能力只声明不可放宽的标签。 */
      mode: 'node-schema';
      requiredTags: readonly ModelTag[];
    }
  | {
      mode: 'verified-families';
      allowedCanonicalFamilies: readonly string[];
      requiredTags: readonly ModelTag[];
      providerCompatibility: 'verified-combinations-only';
      allowedProviderConfigurations: readonly CanvasImageCapabilityProviderConfiguration[];
      semanticRequirements: CanvasImageCapabilityModelSemanticRequirements;
    };

/** 已核验的平台组合。渠道值通过 schema 的 `role: channel` 查找，不泄漏参数 ID 到 UI。 */
export interface CanvasImageCapabilityProviderConfiguration {
  providerId: string;
  allowedChannels?: readonly string[];
}

export interface CanvasImageCapabilityReferenceImageRequirement {
  min: number;
  max: number;
}

/** 产品能力使用的跨供应商语义；执行前会映射成候选模型自己的参数 ID 与合法值。 */
export interface CanvasImageCapabilityModelSemanticRequirements {
  aspectRatio?: string;
  resolution?: string;
  referenceImages?: CanvasImageCapabilityReferenceImageRequirement;
  outputCount?: number;
  quality?: string;
}

export type CanvasImageCapabilitySemanticValue = string | number | boolean;

export interface CanvasImageCapabilityPromptPolicy {
  hiddenTemplateVersion: string | null;
  hiddenTemplateVersions?: Readonly<Partial<Record<'text' | 'reference', string>>>;
  fixedSemanticParams: Readonly<Record<string, CanvasImageCapabilitySemanticValue>>;
  visibleParameterKeys: readonly string[];
}

export type CanvasImageCapabilityOutputCount =
  | {
      mode: 'single';
    }
  | {
      mode: 'fixed';
      count: number;
    }
  | {
      mode: 'parameter';
      parameterKey: string;
      defaultCount: number;
      minCount: number;
      maxCount: number;
    };

export interface CanvasImageCapabilityOutputPolicy {
  resultKind: CanvasImageCapabilityResultKind;
  count: CanvasImageCapabilityOutputCount;
  postProcess: CanvasImageCapabilityPostProcess;
  failureMode: 'single-result' | 'atomic-results';
}

/** 从声明式数量策略和本次参数中解析应有输出数，不依赖能力或模型编号。 */
export function resolveCanvasImageCapabilityExpectedOutputCount(
  policy: CanvasImageCapabilityOutputPolicy,
  params: DynamicValueMap,
): number {
  if (policy.count.mode === 'single') return 1;
  if (policy.count.mode === 'fixed') return policy.count.count;
  const raw = params[policy.count.parameterKey];
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  const value = Number.isFinite(parsed) ? Math.round(parsed) : policy.count.defaultCount;
  return Math.min(policy.count.maxCount, Math.max(policy.count.minCount, value));
}

export interface CanvasImageCapabilityAvailability {
  releaseStage: CanvasImageCapabilityReleaseStage;
  defaultEnabled: boolean;
  unavailableReasonKey: string | null;
}

/**
 * 画布图片能力的纯数据契约。这里只保存稳定键和可序列化业务语义；
 * React 组件、图标实例、供应商请求构建器与执行函数均由调用层按键解析。
 */
export interface CanvasImageCapabilityDefinition {
  id: CanvasImageCapabilityId;
  titleKey: string;
  descriptionKey: string;
  group: CanvasImageCapabilityGroup;
  groupLabelKey: string;
  icon: CanvasImageCapabilityIconKey;
  order: number;
  source: CanvasImageCapabilitySourceRequirement;
  node: CanvasImageCapabilityNodePresentation;
  implementation: CanvasImageCapabilityImplementation;
  availability: CanvasImageCapabilityAvailability;
  modelPolicy: CanvasImageCapabilityModelPolicy;
  promptPolicy: CanvasImageCapabilityPromptPolicy;
  outputPolicy: CanvasImageCapabilityOutputPolicy;
}

export type CanvasImageCapabilityFeatureFlags = Readonly<
  Partial<Record<CanvasImageCapabilityId, boolean>>
>;

export interface CanvasImageCapabilityFilter {
  sourceMediaType?: MediaPortKind;
  releaseStages?: readonly CanvasImageCapabilityReleaseStage[];
  implementationStatus?: CanvasImageCapabilityImplementation['status'];
  featureFlags?: CanvasImageCapabilityFeatureFlags;
  enabledOnly?: boolean;
  executableOnly?: boolean;
}
