import type { ImageUploadParamDef, ModelDefinition, ParamDef } from '@/core/types'
import {
  derivedMediaStateKey,
} from '@/core/params/derivedMediaState'
import {
  hasPaintedMask,
  parseMaskEditorDocument,
  type MaskEditorDocument,
} from '@/features/maskEditor'

import type { CanvasImageCapabilityModelPolicy } from './types'

export const ELEMENT_EDIT_PROMPT_TEMPLATE_VERSION = 'element-edit-mask-v1'
export const ELEMENT_EDIT_DEFAULT_MODEL_ID = 'apimart-gpt-image-2'

export const ELEMENT_EDIT_MODEL_POLICY: Extract<
  CanvasImageCapabilityModelPolicy,
  { mode: 'verified-families' }
> = {
  mode: 'verified-families',
  allowedCanonicalFamilies: ['gpt-image-2'],
  requiredTags: ['supports-image-editing'],
  providerCompatibility: 'verified-combinations-only',
  allowedProviderConfigurations: [
    { providerId: 'apimart', allowedChannels: ['official'] },
    { providerId: 'fal' },
  ],
  semanticRequirements: {
    referenceImages: { min: 1, max: 1 },
    outputCount: 1,
    quality: 'medium',
  },
}

export const ELEMENT_EDIT_FIXED_SEMANTIC_PARAMS = {
  referenceImageCount: 1,
  outputCount: 1,
  quality: 'medium',
  maskDocumentVersion: 1,
  maskEncoding: 'alpha',
  maskPaintMeaning: 'transparent-edit',
} as const

const ELEMENT_EDIT_PROVIDER_PRIORITY = ['apimart', 'fal'] as const

function isElementEditMaskParam(param: ParamDef): param is ImageUploadParamDef {
  const authoring = param.type === 'image-upload' ? param.derivedMediaAuthoring : undefined
  return Boolean(
    authoring
    && authoring.kind === 'mask'
    && authoring.source.kind === 'first-image'
    && authoring.editor.kind === 'mask'
    && authoring.output.format === 'png'
    && authoring.output.maskEncoding === 'alpha'
    && authoring.output.dimensions === 'source'
    && authoring.output.paintMeaning === 'transparent-edit'
    && authoring.onSourceChange === 'invalidate',
  )
}

export function resolveElementEditMaskParam(
  model: ModelDefinition | null | undefined,
): ImageUploadParamDef | null {
  return model?.params.find(isElementEditMaskParam) ?? null
}

export function resolveElementEditVisibleParamIds(
  models: readonly ModelDefinition[],
): string[] {
  return [...new Set(models
    .map((model) => resolveElementEditMaskParam(model)?.id)
    .filter((value): value is string => Boolean(value)))]
}

export function selectDefaultElementEditModel(
  models: readonly ModelDefinition[],
): ModelDefinition | null {
  return [...models]
    .filter((model) => resolveElementEditMaskParam(model))
    .sort((left, right) => {
      const leftIndex = ELEMENT_EDIT_PROVIDER_PRIORITY.indexOf(
        left.meta.provider as (typeof ELEMENT_EDIT_PROVIDER_PRIORITY)[number],
      )
      const rightIndex = ELEMENT_EDIT_PROVIDER_PRIORITY.indexOf(
        right.meta.provider as (typeof ELEMENT_EDIT_PROVIDER_PRIORITY)[number],
      )
      const normalizedLeft = leftIndex < 0 ? Number.POSITIVE_INFINITY : leftIndex
      const normalizedRight = rightIndex < 0 ? Number.POSITIVE_INFINITY : rightIndex
      return normalizedLeft - normalizedRight
    })[0] ?? null
}

function normalizeSingleMedia(value: DynamicValue): string | null {
  const values = Array.isArray(value) ? value : [value]
  const normalized = values.filter(
    (item): item is string => typeof item === 'string' && item.trim().length > 0,
  )
  return normalized.length === 1 ? normalized[0].trim() : null
}

export interface ElementEditRuntimeInput {
  model: ModelDefinition | null | undefined
  images: readonly string[]
  params: DynamicValueMap
}

export interface ElementEditRuntimeInputValidation {
  compatible: boolean
  reasons: string[]
  maskParamId: string | null
  maskSource: string | null
  document: MaskEditorDocument | null
}

/**
 * 付费请求前验证元素编辑的可复现真相源。遮罩 PNG 只是文档的受管派生物；
 * 缺文档、空选区、来源错位或不支持遮罩的模型均不得提交。
 */
export function validateElementEditRuntimeInput({
  model,
  images,
  params,
}: ElementEditRuntimeInput): ElementEditRuntimeInputValidation {
  const reasons: string[] = []
  if (images.length !== 1 || !images[0]?.trim()) {
    reasons.push('元素编辑必须且只能提供 1 张源图')
  }

  const maskParam = resolveElementEditMaskParam(model)
  if (!maskParam) reasons.push('当前模型没有可执行的局部重绘遮罩契约')

  const maskSource = maskParam ? normalizeSingleMedia(params[maskParam.id]) : null
  if (!maskSource) reasons.push('请先绘制需要编辑的区域')

  const document = maskParam
    ? parseMaskEditorDocument(params[derivedMediaStateKey(maskParam.id)])
    : null
  if (!document) {
    reasons.push('遮罩编辑文档缺失或版本不受支持，请重新绘制')
  } else {
    if (document.sourceRef !== images[0]) {
      reasons.push('源图已变化，请基于当前源图重新绘制遮罩')
    }
    if (!hasPaintedMask(document)) {
      reasons.push('遮罩没有可编辑区域，请至少绘制一个区域')
    }
  }

  return {
    compatible: reasons.length === 0,
    reasons,
    maskParamId: maskParam?.id ?? null,
    maskSource,
    document,
  }
}

export interface ElementEditImageInfo {
  width: number
  height: number
  hasAlpha?: boolean
}

/** 验证最终受管 PNG 与源图、编辑文档三者尺寸一致，且遮罩真实包含 Alpha。 */
export function validateElementEditImageInfo(input: {
  source: ElementEditImageInfo
  mask: ElementEditImageInfo
  document: MaskEditorDocument
}): string[] {
  const reasons: string[] = []
  const { source, mask, document } = input
  if (source.width < 1 || source.height < 1) reasons.push('源图尺寸无效')
  if (mask.width !== source.width || mask.height !== source.height) {
    reasons.push('遮罩尺寸必须与源图完全一致')
  }
  if (document.width !== source.width || document.height !== source.height) {
    reasons.push('遮罩编辑文档尺寸与当前源图不一致')
  }
  if (mask.hasAlpha !== true) reasons.push('遮罩必须包含 Alpha 通道')
  return reasons
}

export interface ElementEditPreflightInput extends ElementEditRuntimeInput {
  readImageInfo: (source: string) => Promise<ElementEditImageInfo>
}

/**
 * 真实请求前读取源图与受管遮罩的文件信息。此检查不触发模型调用，且必须在
 * GenerationService 接管前完成，避免尺寸错位或无 Alpha 的文件产生付费失败。
 */
export async function prepareElementEditPreflight({
  model,
  images,
  params,
  readImageInfo,
}: ElementEditPreflightInput): Promise<DynamicValueMap> {
  const runtime = validateElementEditRuntimeInput({ model, images, params })
  if (!runtime.compatible || !runtime.maskSource || !runtime.document) {
    throw new Error(runtime.reasons.join('；'))
  }

  const [source, mask] = await Promise.all([
    readImageInfo(images[0]),
    readImageInfo(runtime.maskSource),
  ])
  const imageReasons = validateElementEditImageInfo({
    source,
    mask,
    document: runtime.document,
  })
  if (imageReasons.length > 0) throw new Error(imageReasons.join('；'))
  return {}
}
