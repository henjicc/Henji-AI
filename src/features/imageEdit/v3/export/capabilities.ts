import {
  IMAGE_EDIT_IDENTITY_TRANSFORM_V3,
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
  'adjustment.exposure',
  'adjustment.curves',
  'adjustment.temperature-tint',
  'adjustment.hsl',
  'composite.layer',
  'group.isolated',
])

const registry = createBuiltInImageEditRenderNodeRegistry()

function transformIsIdentity(transform: readonly number[]): boolean {
  return transform.length === IMAGE_EDIT_IDENTITY_TRANSFORM_V3.length
    && transform.every((value, index) => value === IMAGE_EDIT_IDENTITY_TRANSFORM_V3[index])
}

function visitLayers(layers: readonly ImageEditLayerV3[]): void {
  for (const layer of layers) {
    if (!layer.visible) continue
    if (!transformIsIdentity(layer.transform)) {
      throw new ImageEditorV3ExportCapabilityError(
        'LAYER_TRANSFORM_UNSUPPORTED',
        `图层“${layer.name}”使用了仿射变换；当前分块导出只支持文档裁剪、镜像和 90° 方向变换`,
      )
    }
    if (layer.type === 'raster' && Object.keys(layer.tiles).length > 0) {
      throw new ImageEditorV3ExportCapabilityError(
        'SPARSE_RASTER_UNSUPPORTED',
        `栅格图层“${layer.name}”包含画笔瓦片；画笔瓦片读取桥接完成前不能导出，避免静默漏掉笔画`,
      )
    }
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

function validateColorContract(
  document: ImageEditDocumentV3,
  description: ImageEditorV3RasterExportDescription,
): void {
  if (
    document.color.transferFunction === 'pq'
    || document.color.transferFunction === 'hlg'
    || document.color.hdrMetadata !== null
  ) {
    throw new ImageEditorV3ExportCapabilityError(
      'HDR_RENDER_UNSUPPORTED',
      '当前分块导出不能可靠保留 PQ/HLG 与 HDR 元数据，已阻止降级为 SDR',
    )
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
    const detail = unsupported.definitionId === 'effect.vgpu-glow'
      ? '辉光 Pro 需要尚未接入流式导出的全局 VGPU 分析结果'
      : `渲染节点 ${unsupported.definitionId} 没有视觉等价的分块导出实现`
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
