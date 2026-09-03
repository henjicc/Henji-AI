import { describe, expect, it } from 'vitest'

import {
  createFloat32PremultipliedRgbaTile,
  createImageEditAnnotationLayerV3,
  createImageEditDocumentV3,
  createImageEditEffectLayerV3,
  createImageEditGroupLayerV3,
} from '@/core/imageEdit/v3'
import type {
  ImageEditorV3ExportAnnotationRasterizeRequest,
  ImageEditorV3ExportSourceTileRequest,
} from '@/features/imageEdit/v3/export'
import { renderImageEditorV3ExportTiles } from '@/features/imageEdit/v3/export'
import { WHITE_HEX } from '@/core/theme/colorTokens'

import {
  createImageEditExportTargetViewV3,
  ImageEditExportTargetErrorV3,
} from './exportTargetView'

const RED = `sha256:${'1'.repeat(64)}` as const
const GREEN = `sha256:${'2'.repeat(64)}` as const
const MASK = `sha256:${'3'.repeat(64)}` as const

type Pixel = readonly [number, number, number, number]

function sourceReader(images: ReadonlyMap<string, readonly Pixel[]>) {
  return async (request: ImageEditorV3ExportSourceTileRequest) => {
    const pixels = images.get(request.resourceRef)
    if (!pixels) throw new Error(`missing source ${request.resourceRef}`)
    const bytes = new Uint8Array(pixels.flat())
    return {
      resourceRef: request.resourceRef,
      mip: request.mip,
      tileX: request.tileX,
      tileY: request.tileY,
      halo: request.halo,
      width: pixels.length,
      height: 1,
      channels: 4 as const,
      bitDepth: 8 as const,
      sampleFormat: 'uint' as const,
      numericRange: 'unorm8' as const,
      byteOrder: 'little-endian' as const,
      rowStride: pixels.length * 4,
      colorSpace: 'srgb' as const,
      transferFunction: 'srgb' as const,
      alphaMode: 'straight' as const,
      orientationApplied: true as const,
      originX: 0,
      originY: 0,
      pixels: bytes.buffer,
    }
  }
}

async function render(
  document: ReturnType<typeof createImageEditDocumentV3>,
  images: ReadonlyMap<string, readonly Pixel[]>,
  rasterizeAnnotations?: (
    request: ImageEditorV3ExportAnnotationRasterizeRequest,
  ) => Promise<ReturnType<typeof createFloat32PremultipliedRgbaTile>>,
): Promise<Uint8Array> {
  const output = new Uint8Array(document.geometry.width * 4)
  for await (const tile of renderImageEditorV3ExportTiles({
    document,
    resourceDescriptors: [],
    description: {
      width: document.geometry.width,
      height: 1,
      bitDepth: 8,
      sampleFormat: 'uint',
      colorSpace: 'srgb',
      transferFunction: 'srgb',
      alphaMode: 'straight',
    },
    tileSize: 16,
  }, {
    readSourceTile: sourceReader(images),
    rasterizeAnnotations,
  })) {
    output.set(new Uint8Array(tile.pixels), tile.x * 4)
  }
  return output
}

describe('图片编辑 V3 独立导出派生视图', () => {
  it('保留原画布定位、祖先变换与蒙版，并排除无关兄弟', async () => {
    const document = createImageEditDocumentV3({
      width: 4,
      height: 1,
      documentId: 'target-raster',
      sourceResourceId: GREEN,
    })
    document.layers[0].id = 'unrelated'
    const target = createImageEditDocumentV3({
      width: 4,
      height: 1,
      documentId: 'target-source',
      sourceResourceId: RED,
    }).layers[0]
    target.id = 'target'
    target.opacity = 0.5
    target.blendMode = 'multiply'
    const group = createImageEditGroupLayerV3('ancestor', '祖先组')
    group.children = [target]
    group.isolated = true
    group.transform = [1, 0, 0, 1, 1, 0]
    group.mask = { resourceId: MASK, inverted: false }
    document.layers.push(group)
    const before = JSON.stringify(document)

    const view = createImageEditExportTargetViewV3(document, {
      kind: 'raster-layer',
      layerId: 'target',
    })
    const pixels = await render(view.document, new Map([
      [GREEN, [[0, 255, 0, 255], [0, 255, 0, 255], [0, 255, 0, 255], [0, 255, 0, 255]]],
      [RED, [[255, 0, 0, 255], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]],
      [MASK, [[255, 255, 255, 255], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]],
    ]))

    expect(Array.from({ length: 4 }, (_, x) => pixels.slice(x * 4, x * 4 + 4)))
      .toEqual([
        new Uint8Array([0, 0, 0, 0]),
        new Uint8Array([255, 0, 0, 128]),
        new Uint8Array([0, 0, 0, 0]),
        new Uint8Array([0, 0, 0, 0]),
      ])
    expect(view.layerPath).toEqual(['ancestor', 'target'])
    expect((view.document.layers[0] as typeof group).isolated).toBe(true)
    expect((view.document.layers[0] as typeof group).children[0]).toMatchObject({
      opacity: 0.5,
      blendMode: 'multiply',
    })
    expect(view.document.layers).toHaveLength(1)
    expect(JSON.stringify(document)).toBe(before)
    expect(document.revision).toBe(0)
  })

  it('组导出保留组内顺序和效果上下文，单效果层则明确拒绝', () => {
    const document = createImageEditDocumentV3({
      width: 2,
      height: 1,
      documentId: 'target-group',
      sourceResourceId: RED,
    })
    const group = createImageEditGroupLayerV3('group', '素材组')
    group.children = [
      document.layers[0],
      createImageEditEffectLayerV3('blur', '模糊', 'image.gaussian-blur-v2', { radius: 1 }),
    ]
    document.layers = [group]
    const view = createImageEditExportTargetViewV3(document, { kind: 'layer-group', layerId: 'group' })
    expect(view.document.layers[0]).toMatchObject({
      type: 'group',
      children: [{ type: 'raster' }, { type: 'effect' }],
    })

    expect(() => createImageEditExportTargetViewV3(document, {
      kind: 'raster-layer',
      layerId: 'blur',
    })).toThrowError(ImageEditExportTargetErrorV3)
    try {
      createImageEditExportTargetViewV3(document, { kind: 'raster-layer', layerId: 'blur' })
    } catch (error) {
      expect(error).toMatchObject({ code: 'UNSUPPORTED_EXPORT_TARGET' })
    }
  })

  it('标注导出仅渲染稳定 ID 指定的单元素', async () => {
    const document = createImageEditDocumentV3({ width: 4, height: 1, documentId: 'target-mark' })
    const layer = createImageEditAnnotationLayerV3('marks', '标注')
    layer.annotations = [
      { id: 'first', type: 'rect', x: 0, y: 0, width: 1, height: 1, stroke: WHITE_HEX, lineWidth: 1 },
      { id: 'second', type: 'text', x: 2, y: 0, text: '主标注', color: WHITE_HEX, fontSize: 12 },
    ]
    document.layers = [layer]
    const view = createImageEditExportTargetViewV3(document, {
      kind: 'annotation-element',
      layerId: 'marks',
      annotationId: 'second',
    })
    const pixels = await render(view.document, new Map(), async ({ node, region, document: current }) => {
      const items = Array.isArray(node.parameters.annotations) ? node.parameters.annotations : []
      const data = new Float32Array(region.width * region.height * 4)
      if (items.some((item) => typeof item === 'object' && item !== null && 'id' in item && item.id === 'second')) {
        data.set([1, 1, 1, 1], 2 * 4)
      }
      return createFloat32PremultipliedRgbaTile(
        region.width,
        region.height,
        'linear-light',
        data,
        current.color.workingSpace,
        current.color.transferFunction,
        203,
      )
    })
    expect(view.displayName).toBe('主标注')
    expect((view.document.layers[0] as typeof layer).annotations.map((item) => item.id)).toEqual(['second'])
    expect(Array.from({ length: 4 }, (_, x) => pixels[x * 4 + 3])).toEqual([0, 0, 255, 0])
  })

  it('对隐藏、空内容与缺失目标返回可诊断结果', () => {
    const document = createImageEditDocumentV3({ width: 2, height: 1, documentId: 'target-states' })
    const empty = createImageEditDocumentV3({ width: 2, height: 1, documentId: 'empty' }).layers
    const group = createImageEditGroupLayerV3('hidden-parent', '隐藏组')
    group.visible = false
    group.children = empty
    const raster = createImageEditDocumentV3({ width: 2, height: 1, sourceResourceId: RED }).layers[0]
    raster.id = 'hidden-target'
    group.children = [raster]
    document.layers = [group]
    expect(createImageEditExportTargetViewV3(document, {
      kind: 'raster-layer', layerId: 'hidden-target',
    }).contentState).toBe('hidden')

    const emptyGroup = createImageEditGroupLayerV3('empty-group', '空组')
    document.layers = [emptyGroup]
    expect(createImageEditExportTargetViewV3(document, {
      kind: 'layer-group', layerId: 'empty-group',
    }).contentState).toBe('empty')
    expect(() => createImageEditExportTargetViewV3(document, {
      kind: 'raster-layer', layerId: 'missing',
    })).toThrow(/missing/)
  })

  it('保留栅格稀疏瓦片引用并将其识别为可渲染内容', () => {
    const document = createImageEditDocumentV3({ width: 512, height: 512, documentId: 'sparse-target' })
    const sparse = createImageEditDocumentV3({ width: 512, height: 512, documentId: 'sparse-layer' }).layers
    const layer = {
      ...createImageEditDocumentV3({
        width: 512,
        height: 512,
        documentId: 'sparse-source',
        sourceResourceId: RED,
      }).layers[0],
      id: 'sparse',
      source: { kind: 'empty' as const },
      tiles: { '0/0/0': GREEN },
    }
    sparse.push(layer)
    document.layers = sparse

    const view = createImageEditExportTargetViewV3(document, {
      kind: 'raster-layer',
      layerId: 'sparse',
    })
    expect(view.contentState).toBe('rendered')
    expect(view.document.layers[0]).toMatchObject({
      source: { kind: 'empty' },
      tiles: { '0/0/0': GREEN },
    })
  })
})
