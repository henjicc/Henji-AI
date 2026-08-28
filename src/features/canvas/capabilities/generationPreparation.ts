import type { ModelDefinition } from '@/core/types';
import { mapCanvasCapabilityModelParams } from './modelCompatibility';
import { buildCanvasCapabilityPrompt } from './promptTemplates';
import type { CanvasImageCapabilityDefinition } from './types';

export interface CanvasCapabilityGenerationPreparation {
  compatible: boolean;
  reasons: string[];
  params: DynamicValueMap;
  userPrompt: string;
  prompt: string;
  templateVersion: string | null;
  resultNodeData: DynamicValueMap;
}

export interface PrepareCanvasCapabilityGenerationInput {
  capability: CanvasImageCapabilityDefinition;
  model: ModelDefinition;
  currentParams: DynamicValueMap;
  userPrompt: string;
  referenceImageCount: number;
}

/**
 * 提交前的能力收口：先按模型 schema 映射固定语义，再拼接版本化提示词。
 * 连线注入值也必须在调用此函数前并入 currentParams，确保不能覆盖固定的 2:1 等约束。
 */
export function prepareCanvasCapabilityGeneration({
  capability,
  model,
  currentParams,
  userPrompt,
  referenceImageCount,
}: PrepareCanvasCapabilityGenerationInput): CanvasCapabilityGenerationPreparation {
  const mapping = mapCanvasCapabilityModelParams(
    model,
    capability.modelPolicy,
    currentParams,
  );
  const reasons = mapping.reasons.map((reason) => reason.message);
  const referenceRequirement = capability.modelPolicy.mode === 'verified-families'
    ? capability.modelPolicy.semanticRequirements.referenceImages
    : undefined;
  if (
    referenceRequirement
    && (
      referenceImageCount < referenceRequirement.min
      || referenceImageCount > referenceRequirement.max
    )
  ) {
    reasons.push(
      `当前能力只支持 ${referenceRequirement.min}～${referenceRequirement.max} 张参考图`,
    );
  }

  const builtPrompt = buildCanvasCapabilityPrompt(
    capability.promptPolicy,
    userPrompt,
    referenceImageCount,
  );
  const params = { ...mapping.params };
  delete params.output_format;
  delete params.outputFormat;

  return {
    compatible: mapping.compatible && reasons.length === 0,
    reasons,
    params,
    userPrompt,
    prompt: builtPrompt.prompt,
    templateVersion: builtPrompt.templateVersion,
    resultNodeData: {
      resultKind: capability.outputPolicy.resultKind,
      sourceCapabilityId: capability.id,
      sourceCapabilityTemplateVersion: builtPrompt.templateVersion,
      generationUserPrompt: userPrompt,
      generationPrompt: builtPrompt.prompt,
      generationFixedSemanticParams: { ...capability.promptPolicy.fixedSemanticParams },
      generationCanonicalModelId: model.meta.canonicalModelId,
      generationModelId: model.meta.id,
      generationMappedParams: params,
    },
  };
}

export function validateCanvasCapabilityResultPatch(
  capability: CanvasImageCapabilityDefinition,
  resultPatch: DynamicValueMap,
): void {
  if (capability.outputPolicy.postProcess !== 'validate-panorama') return;
  if (resultPatch.aspectRatio !== '2:1') {
    throw new Error(`生成结果不是完整全景所需的 2:1（实际为 ${String(resultPatch.aspectRatio ?? '未知')}）`);
  }
}
