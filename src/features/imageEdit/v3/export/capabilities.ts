import {
  IMAGE_EDIT_HDR_REFERENCE_WHITE_NITS_V3,
  compileImageEditRenderPlanV3,
  createBuiltInImageEditRenderNodeRegistry,
  parseImageEditDocumentV3,
  stringifyImageEditDocumentV3,
  type ImageEditDocumentV3,
  type ImageEditLayerV3,
  type ImageEditRenderPlan,
} from '@/core/imageEdit/v3'
import type { ImageEditorV3RasterExportDescription } from '@/platform/contracts/imageEditorV3'
import { ImageEditorV3ExportCapabilityError } from './contracts'
import { resolveImageEditorV3ExportGeometry } from './geometry'

const SUPPORTED_NODE_IDS = new Set([
  'source.raster',
  'vector.annotation',
  'effect.blur-v1',
  'effect.gaussian-blur',
  'effect.diffusion',
  'effect.vgpu-glow',
  'adjustment.exposure',
  'adjustment.curves',
  'adjustment.temperature-tint',
  'adjustment.hsl',
  'composite.layer',
  'group.isolated',
])

const registry = createBuiltInImageEditRenderNodeRegistry()

function visitLayers(layers: readonly ImageEditLayerV3[]): void {
  for (const layer of layers) {
    if (!layer.visible) continue
    if (layer.type === 'annotation' && layer.annotations.some((item) => item.type === 'mosaic')) {
      throw new ImageEditorV3ExportCapabilityError(
        'MOSAIC_ANNOTATION_UNSUPPORTED',
        `标注图层“${layer.name}”包含旧马赛克标注；请先迁移为效果图层`,
      )
    }
    if ((layer.type === 'effect' || layer.type === 'adjustment') && !layer.renderable) {
      throw new ImageEditorV3ExportCapabilityError(
        'RENDER_NODE_UNSUPPORTED',
        `图层“${layer.name}”仅能原样保存，当前版本不能渲染导出`,
      )
    }
    if (layer.type === 'group') visitLayers(layer.children)
  }
}

function expectedPrecision(document: ImageEditDocumentV3): {
  bitDepth: 8 | 16 | 32
  sampleFormat: 'uint' | 'float'
} {
  if (document.color.bitDepth === 8) return { bitDepth: 8, sampleFormat: 'uint' }
  if (document.color.bitDepth === 16) return { bitDepth: 16, sampleFormat: 'uint' }
  return { bitDepth: 32, sampleFormat: 'float' }
}

function isHdrDocument(document: ImageEditDocumentV3): boolean {
  return document.color.transferFunction === 'pq'
    || document.color.transferFunction === 'hlg'
    || document.color.hdrMetadata !== null
}

function hasUnsupportedHdrMetadata(document: ImageEditDocumentV3): boolean {
  return document.color.hdrMetadata?.masteringDisplay !== undefined
    || document.color.hdrMetadata?.contentLight !== undefined
}

function descriptionHasUnsupportedHdrMetadata(
  description: ImageEditorV3RasterExportDescription,
): boolean {
  return description.hdrMetadata != null
    && Object.values(description.hdrMetadata).some((value) => value !== undefined)
}

function cicpMatchesDocument(
  document: ImageEditDocumentV3,
  description: ImageEditorV3RasterExportDescription,
): boolean {
  const expected = document.color.hdrMetadata?.cicp
  const actual = description.cicp
  return expected !== undefined
    && actual !== undefined
    && actual !== null
    && expected.colorPrimaries === 9
    && expected.transferCharacteristics === (document.color.transferFunction === 'pq' ? 16 : 18)
    && expected.matrixCoefficients === 9
    && expected.fullRange === false
    && actual.colorPrimaries === expected.colorPrimaries
    && actual.transferCharacteristics === expected.transferCharacteristics
    && actual.matrixCoefficients === expected.matrixCoefficients
    && actual.fullRange === expected.fullRange
}

/**
 * 源解码精度与输出编码精度是两条独立契约：HDR 一律先解为 scene-linear Float32，
 * SDR 才按文档权威位深读取，避免 AVIF 的 10/12-bit 容器选择反向污染内部渲染。
 */
export function resolveImageEditorV3ExportSourceBitDepth(
  document: ImageEditDocumentV3,
): 8 | 16 | 32 {
  if (isHdrDocument(document)) return 32
  if (document.color.bitDepth === 8) return 8
  if (document.color.bitDepth === 16) return 16
  return 32
}

export function resolveImageEditorV3ExportReferenceWhiteNits(
  document: ImageEditDocumentV3,
): number {
  return document.color.hdrMetadata?.referenceWhiteNits
    ?? IMAGE_EDIT_HDR_REFERENCE_WHITE_NITS_V3
}

function validateHdrColorContract(
  document: ImageEditDocumentV3,
  description: ImageEditorV3RasterExportDescription,
): void {
  const metadata = document.color.hdrMetadata
  const transferFunction = document.color.transferFunction
  const hasHdrPrecision = document.color.bitDepth === 16
    || document.color.bitDepth === 'float16'
    || document.color.bitDepth === 'float32'
  if (
    (transferFunction !== 'pq' && transferFunction !== 'hlg')
    || metadata === null
    || metadata.standard !== transferFunction
    || document.color.workingSpace !== 'rec2020'
    || !hasHdrPrecision
  ) {
    throw new ImageEditorV3ExportCapabilityError(
      'HDR_RENDER_UNSUPPORTED',
      'HDR 分块导出只接受 Rec.2020 PQ/HLG 的 16-bit 或浮点权威文档',
    )
  }
  const commonMismatch = description.colorSpace !== 'rec2020'
    || description.alphaMode !== 'straight'
    || document.color.iccProfileResourceId !== null
    || description.iccProfileResourceRef != null
  const linearBigTiff = !commonMismatch
    && description.bitDepth === 32
    && description.sampleFormat === 'float'
    && description.transferFunction === 'linear'
    && description.cicp == null
    && description.hdrMetadata == null
  if (linearBigTiff) return

  if (hasUnsupportedHdrMetadata(document) || descriptionHasUnsupportedHdrMetadata(description)) {
    throw new ImageEditorV3ExportCapabilityError(
      'HDR_RENDER_UNSUPPORTED',
      '当前 HDR AVIF 编码器尚不能可靠写入 mastering-display 或 content-light 元数据；请改用 BigTIFF 交换文件',
    )
  }
  if (commonMismatch
    || description.bitDepth !== 16
    || description.sampleFormat !== 'uint'
    || description.transferFunction !== transferFunction
    || !cicpMatchesDocument(document, description)) {
    throw new ImageEditorV3ExportCapabilityError(
      'COLOR_CONTRACT_MISMATCH',
      'HDR AVIF 必须输出匹配 CICP 的 16-bit 编码瓦片；HDR BigTIFF 必须输出 scene-linear Rec.2020 Float32 瓦片',
    )
  }
}

function validateColorContract(
  document: ImageEditDocumentV3,
  description: ImageEditorV3RasterExportDescription,
): void {
  if (isHdrDocument(document)) {
    validateHdrColorContract(document, description)
    return
  }
  const precision = expectedPrecision(document)
  const expectedIcc = document.color.iccProfileResourceId ?? undefined
  const actualIcc = description.iccProfileResourceRef ?? undefined
  if (
    description.bitDepth !== precision.bitDepth
    || description.sampleFormat !== precision.sampleFormat
    || description.colorSpace !== document.color.workingSpace
    || description.transferFunction !== document.color.transferFunction
    || actualIcc !== expectedIcc
    || description.hdrMetadata != null
    || description.cicp != null
  ) {
    throw new ImageEditorV3ExportCapabilityError(
      'COLOR_CONTRACT_MISMATCH',
      '导出像素说明必须与不可变文档快照的位深、色域、传递函数和元数据完全一致',
    )
  }
}

export interface PreparedImageEditorV3ExportRender {
  document: ImageEditDocumentV3
  plan: ImageEditRenderPlan
}

/** codec 克隆、能力检查和 RenderPlan 编译必须在任何瓦片 IPC 之前完成。 */
export function prepareImageEditorV3ExportRender(
  input: ImageEditDocumentV3,
  description: ImageEditorV3RasterExportDescription,
): PreparedImageEditorV3ExportRender {
  const document = parseImageEditDocumentV3(stringifyImageEditDocumentV3(input))
  resolveImageEditorV3ExportGeometry(document, description)
  validateColorContract(document, description)
  visitLayers(document.layers)
  const plan = compileImageEditRenderPlanV3(document, registry, 'export')
  const unsupported = plan.nodes.find((node) => !SUPPORTED_NODE_IDS.has(node.definitionId))
  if (unsupported) {
    const detail = `渲染节点 ${unsupported.definitionId} 没有视觉等价的分块导出实现`
    throw new ImageEditorV3ExportCapabilityError(
      'RENDER_NODE_UNSUPPORTED',
      `${detail}，已阻止静默替换效果`,
    )
  }
  if (plan.diagnostics.length > 0) {
    throw new ImageEditorV3ExportCapabilityError(
      'RENDER_NODE_UNSUPPORTED',
      `渲染计划包含不可导出的图层：${plan.diagnostics.map((item) => item.message).join('；')}`,
    )
  }
  return { document, plan }
}
