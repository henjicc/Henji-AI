import {
  compileImageEditRenderPlanV3,
  createBuiltInImageEditRenderNodeRegistry,
  createFloat32MaskTile,
  createFloat32PremultipliedRgbaTile,
  createImageEditAdjustmentLayerV3,
  createImageEditDocumentV3,
  createImageEditGroupLayerV3,
  createImageEditHdrMetadataV3,
  createImageEditRasterLayerV3,
  executeImageEditCpuRenderPlanV3,
  resampleImageEditMaskAffineV3,
  resampleImageEditRgbaAffineV3,
  type Float32PremultipliedRgbaTile,
  type ImageEditDocumentV3,
  type ImageEditLayerV3,
  type ImageEditRenderPlanNode,
} from '@/core/imageEdit/v3'

export type ImageEditorGpuBaselineFixtureIdV3 =
  | 'kie-five-layer'
  | 'sixteen-layer'
  | 'complex-mask'
  | 'hdr-rec2020'
  | 'large-8192'

export interface ImageEditorGpuBaselineFixtureV3 {
  id: ImageEditorGpuBaselineFixtureIdV3
  document: ImageEditDocumentV3
  renderSize: { width: number; height: number }
  resourceSeeds: ReadonlyMap<string, number>
}

export interface ImageEditorGoldenComparisonV3 {
  sampleCount: number
  maxAbsoluteError: number
  linearWithinTolerance: boolean
  quantizedWithinOneLsbRatio: number
  quantizedMaxLsbError: number
}

const registry = createBuiltInImageEditRenderNodeRegistry()
const resourceRef = (seed: number): string => `sha256:${seed.toString(16).padStart(64, '0')}`

function raster(seed: number, name: string): ReturnType<typeof createImageEditRasterLayerV3> {
  const layer = createImageEditRasterLayerV3(`baseline-layer-${seed}`, name, resourceRef(seed))
  layer.opacity = 0.62 + (seed % 4) * 0.1
  layer.transform = [1, 0, 0, 1, (seed % 3) - 1, Math.floor(seed / 3) % 2]
  return layer
}

function baseDocument(id: string, width = 96, height = 64): ImageEditDocumentV3 {
  return createImageEditDocumentV3({ width, height, documentId: id })
}

function seedsFor(layers: readonly ImageEditLayerV3[]): Map<string, number> {
  const result = new Map<string, number>()
  const visit = (entries: readonly ImageEditLayerV3[]): void => {
    for (const layer of entries) {
      if (layer.type === 'raster' && layer.source.kind === 'resource') {
        const match = /([0-9a-f]+)$/.exec(layer.source.resourceId)
        result.set(layer.source.resourceId, Number.parseInt(match?.[1].slice(-8) ?? '1', 16))
      }
      if (layer.type === 'group') visit(layer.children)
    }
  }
  visit(layers)
  return result
}

function fiveLayerFixture(): ImageEditorGpuBaselineFixtureV3 {
  const document = baseDocument('gpu-baseline-kie-five-layer')
  document.layers = [
    raster(1, '底图'), raster(2, '主体'), raster(3, '服饰'), raster(4, '道具'), raster(5, '前景'),
  ]
  document.layers[0].opacity = 1
  return { id: 'kie-five-layer', document, renderSize: { width: 96, height: 64 }, resourceSeeds: seedsFor(document.layers) }
}

function sixteenLayerFixture(): ImageEditorGpuBaselineFixtureV3 {
  const document = baseDocument('gpu-baseline-sixteen-layer')
  document.layers = Array.from({ length: 16 }, (_, index) => raster(index + 11, `元素 ${index + 1}`))
  document.layers[0].opacity = 1
  return { id: 'sixteen-layer', document, renderSize: { width: 96, height: 64 }, resourceSeeds: seedsFor(document.layers) }
}

function complexMaskFixture(): ImageEditorGpuBaselineFixtureV3 {
  const document = baseDocument('gpu-baseline-complex-mask')
  const base = raster(31, '背景')
  base.opacity = 1
  const group = createImageEditGroupLayerV3('baseline-isolated-group', '隔离组')
  group.isolated = true
  group.opacity = 0.85
  const subject = raster(32, '蒙版主体')
  subject.blendMode = 'screen'
  subject.mask = { resourceId: resourceRef(91), inverted: false }
  const texture = raster(33, '叠加纹理')
  texture.blendMode = 'multiply'
  group.children = [subject, texture]
  const exposure = createImageEditAdjustmentLayerV3(
    'baseline-exposure', '曝光', 'exposure', { stops: 0.25, offset: 0.01, gamma: 1.05 },
  )
  document.layers = [base, group, exposure]
  const resources = seedsFor(document.layers)
  resources.set(resourceRef(91), 91)
  return { id: 'complex-mask', document, renderSize: { width: 96, height: 64 }, resourceSeeds: resources }
}

function hdrFixture(): ImageEditorGpuBaselineFixtureV3 {
  const document = baseDocument('gpu-baseline-hdr-rec2020')
  document.color = {
    workingSpace: 'rec2020', bitDepth: 'float16', transferFunction: 'pq',
    hdrMetadata: createImageEditHdrMetadataV3('pq'), iccProfileResourceId: null,
  }
  const background = raster(41, 'HDR 背景')
  background.opacity = 1
  const highlight = raster(42, 'HDR 高光')
  highlight.blendMode = 'screen'
  document.layers = [background, highlight]
  return { id: 'hdr-rec2020', document, renderSize: { width: 96, height: 64 }, resourceSeeds: seedsFor(document.layers) }
}

function largeFixture(): ImageEditorGpuBaselineFixtureV3 {
  const document = baseDocument('gpu-baseline-large-8192', 8_192, 8_192)
  document.layers = Array.from({ length: 16 }, (_, index) => raster(index + 51, `大图元素 ${index + 1}`))
  document.layers[0].opacity = 1
  return { id: 'large-8192', document, renderSize: { width: 256, height: 256 }, resourceSeeds: seedsFor(document.layers) }
}

export function createImageEditorGpuBaselineFixturesV3(): readonly ImageEditorGpuBaselineFixtureV3[] {
  return [fiveLayerFixture(), sixteenLayerFixture(), complexMaskFixture(), hdrFixture(), largeFixture()]
}

function patternTile(
  width: number,
  height: number,
  seed: number,
  document: ImageEditDocumentV3,
): Float32PremultipliedRgbaTile {
  const data = new Float32Array(width * height * 4)
  const hdrScale = document.color.hdrMetadata ? 2.5 : 1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      const alpha = 0.45 + ((x * 7 + y * 11 + seed) % 55) / 100
      data[offset] = (((x + seed * 3) % 37) / 36) * alpha * hdrScale
      data[offset + 1] = (((y + seed * 5) % 41) / 40) * alpha * hdrScale
      data[offset + 2] = (((x + y + seed * 7) % 43) / 42) * alpha * hdrScale
      data[offset + 3] = alpha
    }
  }
  return createFloat32PremultipliedRgbaTile(
    width, height, 'linear-light', data, document.color.workingSpace,
    document.color.transferFunction, document.color.hdrMetadata?.referenceWhiteNits,
  )
}

function resourceId(node: ImageEditRenderPlanNode): string {
  const source = node.parameters.source
  if (!source || typeof source !== 'object' || !('resourceId' in source)
    || typeof source.resourceId !== 'string') throw new Error(`基准栅格缺少资源：${node.layerId}`)
  return source.resourceId
}

export async function renderImageEditorCpuGoldenV3(
  fixture: ImageEditorGpuBaselineFixtureV3,
): Promise<Float32PremultipliedRgbaTile> {
  const { width, height } = fixture.renderSize
  const rect = { x: 0, y: 0, width, height }
  const plan = compileImageEditRenderPlanV3(fixture.document, registry, 'stable')
  const output = await executeImageEditCpuRenderPlanV3(plan, {
    loadRaster: async (node) => patternTile(
      width, height, fixture.resourceSeeds.get(resourceId(node)) ?? 1, fixture.document,
    ),
    rasterizeAnnotations: async () => patternTile(width, height, 97, fixture.document),
    loadMask: async () => {
      const data = Float32Array.from({ length: width * height }, (_, index) => (
        ((index % width) + Math.floor(index / width)) % 17 < 11 ? 1 : 0.2
      ))
      return createFloat32MaskTile(width, height, data)
    },
    transformContent: async (tile, transform) => resampleImageEditRgbaAffineV3(tile, rect, rect, transform),
    transformMask: async (tile, transform) => resampleImageEditMaskAffineV3(tile, rect, rect, transform),
  })
  if (!output) throw new Error(`基准场景没有输出：${fixture.id}`)
  return output
}

export function compareImageEditorGoldenV3(
  reference: Float32Array,
  candidate: Float32Array,
  linearTolerance = 1e-4,
): ImageEditorGoldenComparisonV3 {
  if (reference.length !== candidate.length) throw new Error('Golden 像素长度不一致')
  let maxAbsoluteError = 0
  let withinOneLsb = 0
  let quantizedMaxLsbError = 0
  for (let index = 0; index < reference.length; index += 1) {
    maxAbsoluteError = Math.max(maxAbsoluteError, Math.abs(reference[index] - candidate[index]))
    const lsb = Math.abs(Math.round(reference[index] * 255) - Math.round(candidate[index] * 255))
    quantizedMaxLsbError = Math.max(quantizedMaxLsbError, lsb)
    if (lsb <= 1) withinOneLsb += 1
  }
  return {
    sampleCount: reference.length,
    maxAbsoluteError,
    linearWithinTolerance: maxAbsoluteError <= linearTolerance,
    quantizedWithinOneLsbRatio: reference.length ? withinOneLsb / reference.length : 1,
    quantizedMaxLsbError,
  }
}

export function fingerprintImageEditorGoldenV3(data: Float32Array): string {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let hash = 0x811c9dc5
  for (let offset = 0; offset < view.byteLength; offset += 1) {
    hash ^= view.getUint8(offset)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
