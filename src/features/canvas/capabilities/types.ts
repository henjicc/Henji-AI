import type { ModelTag } from '@/core/types';
import {
  CANVAS_IMAGE_CAPABILITY_IDS,
  type CanvasImageCapabilityId,
} from '@/core/canvas/imageCapabilityIds';
import type {
  CanvasNodeType,
  NodeToolType,
} from '../domain/canvasNodes';
import type { MediaPortKind } from '../domain/nodePorts';

export { CANVAS_IMAGE_CAPABILITY_IDS };
export type { CanvasImageCapabilityId };

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
  | 'assemble-layer-stack'
  | 'local-redraw-composite';

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
      /** 新建节点时使用当前语言的能力标题；未声明时保留节点定义自己的稳定默认名。 */
      useLocalizedDisplayName?: boolean;
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
      /** 新建、迁移或模型切换时采用；不得覆盖用户已经保存的合法选择。 */
      semanticDefaults?: CanvasImageCapabilityModelSemanticDefaults;
    };

/** 已核验的平台组合。渠道值通过 schema 的 `role: channel` 查找，不泄漏参数 ID 到 UI。 */
export interface CanvasImageCapabilityProviderConfiguration {
  providerId: string;
  allowedChannels?: readonly string[];
  /** 当前能力在该供应商上经过核验的可编辑语义值。 */
  allowedSemanticValues?: Readonly<Partial<Record<'resolution' | 'quality', readonly string[]>>>;
}

export interface CanvasImageCapabilityReferenceImageRequirement {
  min: number;
  max: number;
}

/** 产品能力使用的跨供应商语义；执行前会映射成候选模型自己的参数 ID 与合法值。 */
export interface CanvasImageCapabilityModelSemanticRequirements {
  /** 按优先级列出可接受比例；模型会采用它支持的第一个精确值。 */
  aspectRatio?: string | readonly string[];
  resolution?: string;
  referenceImages?: CanvasImageCapabilityReferenceImageRequirement;
  outputCount?: number;
  quality?: string;
  /** 供应商无关的 schema `transferKey` → 固定值映射。 */
  parameterValues?: Readonly<Record<string, CanvasImageCapabilitySemanticValue>>;
}

/** 与固定约束分离的初始偏好；目标模型缺少精确值时选择最接近的合法档位。 */
export interface CanvasImageCapabilityModelSemanticDefaults {
  resolution?: string;
  quality?: string;
}

export type CanvasImageCapabilitySemanticValue = string | number | boolean;

export interface CanvasImageCapabilityPromptPolicy {
  hiddenTemplateVersion: string | null;
  hiddenTemplateVersions?: Readonly<Partial<Record<'text' | 'reference', string>>>;
  fixedSemanticParams: Readonly<Record<string, CanvasImageCapabilitySemanticValue>>;
  visibleParameterKeys: readonly string[];
  /** 特殊能力仅改变输入/输出流水线时，完整开放候选模型自己的 schema 参数。 */
  showAllModelParameters?: boolean;
  /** 通过通用 schema 语义发现参数，不泄漏供应商参数 ID。 */
  visibleParameterSemantics?: readonly ('channel' | 'resolution' | 'quality')[];
  /** 跨供应商参数通过 schema transferKey 暴露，禁止在 UI 列举供应商参数 ID。 */
  visibleParameterTransferKeys?: readonly string[];
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
    }
  | {
      /** 结构化响应决定实际数量；提交前按 min/max 校验完整结果。 */
      mode: 'dynamic';
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
): number | undefined {
  if (policy.count.mode === 'single') return 1;
  if (policy.count.mode === 'fixed') return policy.count.count;
  if (policy.count.mode === 'dynamic') return undefined;
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
