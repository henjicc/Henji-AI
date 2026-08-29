import { analyzeRatioResolutionParams } from '@/core/params/ratioResolution';
import type { ModelDefinition, ParamDef } from '@/core/types';
import { getI18nText } from '@/core/types';
import type {
  CanvasImageCapabilityModelPolicy,
  CanvasImageCapabilityModelSemanticRequirements,
  CanvasImageCapabilityProviderConfiguration,
} from './types';

export type CanvasModelCompatibilityReasonCode =
  | 'canonical-family'
  | 'required-tag'
  | 'provider-configuration'
  | 'channel'
  | 'aspect-ratio'
  | 'resolution'
  | 'reference-images'
  | 'output-count'
  | 'quality';

export interface CanvasModelCompatibilityReason {
  code: CanvasModelCompatibilityReasonCode;
  message: string;
}

export interface CanvasModelSemanticMappingResult {
  compatible: boolean;
  params: DynamicValueMap;
  reasons: CanvasModelCompatibilityReason[];
}

export interface CanvasModelCandidateResult extends CanvasModelSemanticMappingResult {
  model: ModelDefinition;
}

export interface CanvasModelCandidateSet {
  candidates: CanvasModelCandidateResult[];
  rejected: CanvasModelCandidateResult[];
}

type ChoiceParam = Extract<ParamDef, { type: 'dropdown' | 'radio' | 'aspect-ratio' }>;
type NumberParam = Extract<ParamDef, { type: 'number' }>;

function choiceOptions(param: ParamDef | undefined): Array<string | number> {
  if (!param) return [];
  if (param.type === 'dropdown' || param.type === 'radio' || param.type === 'aspect-ratio') {
    return param.options.map((option) => option.value);
  }
  return [];
}

function findExactChoice(param: ParamDef | undefined, semanticValue: string): string | number | null {
  const normalized = semanticValue.trim().toLowerCase();
  return choiceOptions(param).find((value) => String(value).trim().toLowerCase() === normalized) ?? null;
}

function findProviderConfiguration(
  model: ModelDefinition,
  policy: Extract<CanvasImageCapabilityModelPolicy, { mode: 'verified-families' }>,
): CanvasImageCapabilityProviderConfiguration | undefined {
  return policy.allowedProviderConfigurations.find((entry) => entry.providerId === model.meta.provider);
}

function findChannelParam(model: ModelDefinition): ChoiceParam | undefined {
  return model.params.find((param): param is ChoiceParam => (
    param.role === 'channel'
    && (param.type === 'dropdown' || param.type === 'radio')
  ));
}

function paramSearchText(param: ParamDef): string {
  return [param.id, param.apiField, getI18nText(param.name, 'zh'), getI18nText(param.name, 'en')]
    .filter(Boolean)
    .join(' ');
}

function findQualityParam(model: ModelDefinition): ChoiceParam | undefined {
  return model.params.find((param): param is ChoiceParam => (
    (param.type === 'dropdown' || param.type === 'radio')
    && /(quality|画质|质量)/i.test(paramSearchText(param))
  ));
}

function findOutputCountParam(model: ModelDefinition): NumberParam | undefined {
  return model.params.find((param): param is NumberParam => (
    param.type === 'number'
    && /(count|quantity|num.*image|number.*image|输出数量|生成数量|图片数量)/i.test(paramSearchText(param))
  ));
}

function getModelDefaults(model: ModelDefinition): DynamicValueMap {
  return Object.fromEntries(model.params.map((param) => [param.id, param.default])) as DynamicValueMap;
}

function resolveImageLimits(model: ModelDefinition, params: DynamicValueMap): { min: number; max: number } {
  const config = typeof model.inputLimits === 'function' ? model.inputLimits(params) : model.inputLimits;
  const limit = config?.images;
  if (limit?.exact !== undefined) return { min: limit.exact, max: limit.exact };
  return { min: limit?.min ?? 0, max: limit?.max ?? 6 };
}

function mapChannel(
  model: ModelDefinition,
  configuration: CanvasImageCapabilityProviderConfiguration,
  params: DynamicValueMap,
  reasons: CanvasModelCompatibilityReason[],
): void {
  if (!configuration.allowedChannels || configuration.allowedChannels.length === 0) return;
  const channelParam = findChannelParam(model);
  if (!channelParam) {
    reasons.push({ code: 'channel', message: '模型没有可验证的渠道参数' });
    return;
  }
  const supported = new Set(choiceOptions(channelParam).map(String));
  const allowed = configuration.allowedChannels.filter((channel) => supported.has(channel));
  if (allowed.length === 0) {
    reasons.push({ code: 'channel', message: '模型不包含能力允许的渠道' });
    return;
  }
  const current = String(params[channelParam.id] ?? '');
  params[channelParam.id] = allowed.includes(current) ? current : allowed[0];
}

function mapChoiceRequirement(
  param: ParamDef | undefined,
  semanticValue: string | undefined,
  code: 'aspect-ratio' | 'resolution',
  label: string,
  params: DynamicValueMap,
  reasons: CanvasModelCompatibilityReason[],
): void {
  if (!semanticValue) return;
  const value = findExactChoice(param, semanticValue);
  if (!param || value === null) {
    reasons.push({ code, message: `模型不支持要求的${label} ${semanticValue}` });
    return;
  }
  params[param.id] = value;
}

function mapSemanticRequirements(
  model: ModelDefinition,
  requirements: CanvasImageCapabilityModelSemanticRequirements,
  params: DynamicValueMap,
  reasons: CanvasModelCompatibilityReason[],
): void {
  const ratioResolution = analyzeRatioResolutionParams(model.params, []);
  mapChoiceRequirement(
    model.params.find((param) => param.id === ratioResolution?.aspectParam?.id),
    requirements.aspectRatio,
    'aspect-ratio',
    '比例',
    params,
    reasons,
  );
  mapChoiceRequirement(
    model.params.find((param) => param.id === ratioResolution?.resolutionParam?.id),
    requirements.resolution,
    'resolution',
    '分辨率',
    params,
    reasons,
  );

  if (requirements.quality) {
    const qualityParam = findQualityParam(model);
    if (qualityParam) {
      const quality = findExactChoice(qualityParam, requirements.quality);
      if (quality === null) {
        reasons.push({ code: 'quality', message: `模型的画质参数不支持 ${requirements.quality}` });
      } else {
        params[qualityParam.id] = quality;
      }
    }
  }

  if (requirements.outputCount !== undefined) {
    const countParam = findOutputCountParam(model);
    if (countParam) {
      const count = requirements.outputCount;
      if ((countParam.min !== undefined && count < countParam.min)
        || (countParam.max !== undefined && count > countParam.max)) {
        reasons.push({ code: 'output-count', message: `模型不能生成 ${count} 张结果` });
      } else {
        params[countParam.id] = count;
      }
    } else if (requirements.outputCount !== 1) {
      reasons.push({ code: 'output-count', message: '模型没有可映射的输出数量参数' });
    }
  }

  if (requirements.referenceImages) {
    const imageLimits = resolveImageLimits(model, params);
    if (imageLimits.min > requirements.referenceImages.min
      || imageLimits.max < requirements.referenceImages.max) {
      reasons.push({
        code: 'reference-images',
        message: `模型不支持 ${requirements.referenceImages.min}～${requirements.referenceImages.max} 张参考图`,
      });
    }
  }
}

/**
 * 把产品能力的跨供应商语义映射为模型 schema 的真实参数。
 * `smart/auto` 不会作为固定能力语义下发；找不到精确合法值时直接返回不可用原因。
 */
export function mapCanvasCapabilityModelParams(
  model: ModelDefinition,
  policy: CanvasImageCapabilityModelPolicy,
  currentParams: DynamicValueMap = {},
): CanvasModelSemanticMappingResult {
  if (policy.mode === 'not-applicable') {
    return { compatible: true, params: { ...currentParams }, reasons: [] };
  }

  if (policy.mode === 'node-schema') {
    const reasons = policy.requiredTags
      .filter((tag) => !model.meta.tags?.includes(tag))
      .map((tag): CanvasModelCompatibilityReason => ({
        code: 'required-tag',
        message: `模型缺少能力标签 ${tag}`,
      }));
    return {
      compatible: reasons.length === 0,
      params: { ...getModelDefaults(model), ...currentParams },
      reasons,
    };
  }

  const reasons: CanvasModelCompatibilityReason[] = [];
  const params = { ...getModelDefaults(model), ...currentParams };
  if (!policy.allowedCanonicalFamilies.includes(model.meta.canonicalModelId)) {
    reasons.push({ code: 'canonical-family', message: '模型不属于能力允许的规范模型家族' });
  }
  for (const tag of policy.requiredTags) {
    if (!model.meta.tags?.includes(tag)) {
      reasons.push({ code: 'required-tag', message: `模型缺少能力标签 ${tag}` });
    }
  }
  const configuration = findProviderConfiguration(model, policy);
  if (!configuration) {
    reasons.push({ code: 'provider-configuration', message: '供应商组合尚未通过能力核验' });
  } else {
    mapChannel(model, configuration, params, reasons);
  }
  mapSemanticRequirements(model, policy.semanticRequirements, params, reasons);

  return { compatible: reasons.length === 0, params, reasons };
}

export function resolveCanvasCapabilityModelCandidates(
  models: readonly ModelDefinition[],
  policy: CanvasImageCapabilityModelPolicy | undefined,
): CanvasModelCandidateSet {
  if (!policy || policy.mode === 'not-applicable') {
    return {
      candidates: models.map((model) => ({ model, compatible: true, params: {}, reasons: [] })),
      rejected: [],
    };
  }
  const results = models.map((model) => ({ model, ...mapCanvasCapabilityModelParams(model, policy) }));
  return {
    candidates: results.filter((result) => result.compatible),
    rejected: results.filter((result) => !result.compatible),
  };
}
