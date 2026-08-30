import type { ModelDefinition } from '@/core/types'
import { hasPaintedMask, parseMaskEditorDocument, type MaskEditorDocument } from '@/features/maskEditor'
import type { LocalRedrawSettings } from '@/platform/contracts/image'
import type { CanvasImageCapabilityModelPolicy } from './types'

export const ELEMENT_EDIT_PROMPT_TEMPLATE_VERSION = 'local-redraw-crop-v2'
export const ELEMENT_EDIT_DEFAULT_MODEL_ID = 'apimart-gpt-image-2'
export const ELEMENT_EDIT_MODEL_POLICY: Extract<CanvasImageCapabilityModelPolicy, { mode: 'node-schema' }> = {
  mode: 'node-schema', requiredTags: ['supports-image-editing'],
}
export const ELEMENT_EDIT_FIXED_SEMANTIC_PARAMS = {
  referenceImageCount: 1, outputCount: 1, localRedrawContractVersion: 2,
  maskEncoding: 'alpha', maskPaintMeaning: 'transparent-edit',
} as const

export const DEFAULT_LOCAL_REDRAW_SETTINGS: LocalRedrawSettings = {
  contextScale: 2, aspectRatio: 'auto', registrationQuality: 'precise', featherPixels: 12, forceRegistration: false,
}

export function normalizeLocalRedrawSettings(value: unknown): LocalRedrawSettings {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const contextScale = Number(record.contextScale)
  const featherPixels = Number(record.featherPixels)
  const aspectRatio = ['auto', '1:1', '4:3', '3:4', '16:9', '9:16'].includes(String(record.aspectRatio))
    ? String(record.aspectRatio) as LocalRedrawSettings['aspectRatio'] : DEFAULT_LOCAL_REDRAW_SETTINGS.aspectRatio
  const registrationQuality = ['fast', 'precise', 'extreme'].includes(String(record.registrationQuality))
    ? String(record.registrationQuality) as LocalRedrawSettings['registrationQuality'] : DEFAULT_LOCAL_REDRAW_SETTINGS.registrationQuality
  return {
    contextScale: Number.isFinite(contextScale) ? Math.max(1, Math.min(5, contextScale)) : DEFAULT_LOCAL_REDRAW_SETTINGS.contextScale,
    aspectRatio,
    registrationQuality,
    featherPixels: Number.isFinite(featherPixels) ? Math.max(0, Math.min(128, featherPixels)) : DEFAULT_LOCAL_REDRAW_SETTINGS.featherPixels,
    forceRegistration: record.forceRegistration === true,
  }
}

export function selectDefaultElementEditModel(models: readonly ModelDefinition[]): ModelDefinition | null {
  return models.find((model) => model.meta.id === ELEMENT_EDIT_DEFAULT_MODEL_ID) ?? models[0] ?? null
}

export interface ElementEditRuntimeInput { images: readonly string[]; maskSource: unknown; maskDocument: unknown }
export interface ElementEditRuntimeInputValidation {
  compatible: boolean; reasons: string[]; maskSource: string | null; document: MaskEditorDocument | null
}

export function validateElementEditRuntimeInput({ images, maskSource: rawMaskSource, maskDocument }: ElementEditRuntimeInput): ElementEditRuntimeInputValidation {
  const reasons: string[] = []
  if (images.length !== 1 || !images[0]?.trim()) reasons.push('局部重绘必须且只能提供 1 张源图')
  const maskSource = typeof rawMaskSource === 'string' && rawMaskSource.trim() ? rawMaskSource.trim() : null
  if (!maskSource) reasons.push('请先绘制需要重绘的区域')
  const document = parseMaskEditorDocument(maskDocument)
  if (!document) reasons.push('遮罩编辑文档缺失或版本不受支持，请重新绘制')
  else {
    if (document.sourceRef !== images[0]) reasons.push('源图已变化，请基于当前源图重新绘制遮罩')
    if (!hasPaintedMask(document)) reasons.push('遮罩没有可编辑区域，请至少绘制一个区域')
  }
  return { compatible: reasons.length === 0, reasons, maskSource, document }
}

export interface ElementEditImageInfo { width: number; height: number; hasAlpha?: boolean }
export function validateElementEditImageInfo(input: { source: ElementEditImageInfo; mask: ElementEditImageInfo; document: MaskEditorDocument }): string[] {
  const reasons: string[] = []
  const { source, mask, document } = input
  if (source.width < 1 || source.height < 1) reasons.push('源图尺寸无效')
  if (mask.width !== source.width || mask.height !== source.height) reasons.push('遮罩尺寸必须与源图完全一致')
  if (document.width !== source.width || document.height !== source.height) reasons.push('遮罩编辑文档尺寸与当前源图不一致')
  if (mask.hasAlpha !== true) reasons.push('遮罩必须包含 Alpha 通道')
  return reasons
}
export async function prepareElementEditPreflight(input: ElementEditRuntimeInput & { readImageInfo: (source: string) => Promise<ElementEditImageInfo> }): Promise<void> {
  const runtime = validateElementEditRuntimeInput(input)
  if (!runtime.compatible || !runtime.maskSource || !runtime.document) throw new Error(runtime.reasons.join('；'))
  const [source, mask] = await Promise.all([input.readImageInfo(input.images[0]), input.readImageInfo(runtime.maskSource)])
  const reasons = validateElementEditImageInfo({ source, mask, document: runtime.document })
  if (reasons.length) throw new Error(reasons.join('；'))
}
