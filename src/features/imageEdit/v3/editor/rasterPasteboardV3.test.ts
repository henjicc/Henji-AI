import { describe, expect, it } from 'vitest'

import {
  createImageEditAdjustmentLayerV3,
  createImageEditAnnotationLayerV3,
  createImageEditDocumentV3,
  createImageEditEffectLayerV3,
  createImageEditGroupLayerV3,
  createImageEditRasterLayerV3,
} from '@/core/imageEdit/v3/documentFactory'
import { createImageEditHdrMetadataV3 } from '@/core/imageEdit/v3/colorTypes'
import type { ImageEditorV3ResourceDescriptor } from '@/platform/contracts/imageEditorV3'
import {
  imageEditorRasterPasteboardTransformV3,
  imageEditorRasterProxyTransformV3,
  resolveImageEditorRasterPasteboardLayerV3,
  resolveImageEditorRasterPasteboardResourceLayersV3,
  resolveImageEditorRasterPasteboardStackV3,
} from './rasterPasteboardV3'

const RESOURCE_A = `sha256:${'a'.repeat(64)}`
const RESOURCE_B = `sha256:${'b'.repeat(64)}`

describe('ImageEditorRasterPasteboardV3', () => {
  it('只让可精确复现的单一原始栅格图层进入文档外编辑区', () => {
    const document = createImageEditDocumentV3({
      width: 1_600,
      height: 1_000,
      sourceResourceId: 'sha256:source',
    })

    expect(resolveImageEditorRasterPasteboardLayerV3(document)?.id).toBe(document.layers[0].id)

    document.layers.push(createImageEditAnnotationLayerV3('annotation', '标注'))
    expect(resolveImageEditorRasterPasteboardLayerV3(document)).toBeNull()

    document.layers[1].visible = false
    document.layers[0].mask = { resourceId: 'sha256:mask', inverted: false }
    expect(resolveImageEditorRasterPasteboardLayerV3(document)).toBeNull()

    document.layers[0].mask = null
    document.color.workingSpace = 'display-p3'
    expect(resolveImageEditorRasterPasteboardLayerV3(document)).toBeNull()
  })

  it('将文档像素位移换算成适应窗口后的工作区位移', () => {
    expect(imageEditorRasterPasteboardTransformV3(
      [1, 0, 0, 1, 100, -240],
      800,
      1_600,
    )).toBe('matrix(1, 0, 0, 1, 50, -120)')
    expect(imageEditorRasterProxyTransformV3(
      [0.5, 0, 0, 0.25, 120, 80],
      500,
      1_000,
      400,
      300,
      800,
      600,
    )).toBe('matrix(0.5, 0, 0, 0.25, 60, 40)')
  })

  it('只让资源完整且能精确直显的根级普通栅格栈进入多图层快路径', () => {
    const document = createImageEditDocumentV3({
      width: 1_000,
      height: 800,
      sourceResourceId: RESOURCE_A,
    })
    document.layers.push(createImageEditRasterLayerV3('foreground', '前景', RESOURCE_B))
    const descriptors: ImageEditorV3ResourceDescriptor[] = [RESOURCE_A, RESOURCE_B].map((resourceRef) => ({
      resourceRef: resourceRef as `sha256:${string}`,
      byteLength: 4_096,
      mediaType: 'image/png',
    }))

    expect(resolveImageEditorRasterPasteboardLayerV3(document)).toBeNull()
    expect(resolveImageEditorRasterPasteboardStackV3(document, descriptors)?.map(({ id }) => id))
      .toEqual(document.layers.map(({ id }) => id))

    descriptors[0].mediaType = null
    expect(resolveImageEditorRasterPasteboardStackV3(document, descriptors)?.map(({ id }) => id))
      .toEqual(document.layers.map(({ id }) => id))

    document.layers[0].visible = false
    expect(resolveImageEditorRasterPasteboardLayerV3(document)).toBeNull()
    expect(resolveImageEditorRasterPasteboardStackV3(document, descriptors)?.map(({ id }) => id))
      .toEqual(['foreground'])
    expect(resolveImageEditorRasterPasteboardResourceLayersV3(document, descriptors).map(({ id }) => id))
      .toEqual(document.layers.map(({ id }) => id))

    document.layers[0].visible = true
    document.layers[1].mask = { resourceId: RESOURCE_A, inverted: false }
    expect(resolveImageEditorRasterPasteboardStackV3(document, descriptors)).toBeNull()

    document.layers[1].mask = null
    document.layers[1].blendMode = 'multiply'
    expect(resolveImageEditorRasterPasteboardStackV3(document, descriptors)).toBeNull()

    document.layers[1].blendMode = 'normal'
    document.layers[1].opacity = 0.5
    expect(resolveImageEditorRasterPasteboardStackV3(document, descriptors)).toBeNull()
  })

  it('复杂像素语义、颜色几何和不可信资源描述统一降级，隐藏复杂层不影响直显', () => {
    const createFixture = () => {
      const document = createImageEditDocumentV3({
        width: 1_000,
        height: 800,
        sourceResourceId: RESOURCE_A,
      })
      document.layers.push(createImageEditRasterLayerV3('foreground', '前景', RESOURCE_B))
      const descriptors: ImageEditorV3ResourceDescriptor[] = [RESOURCE_A, RESOURCE_B].map((resourceRef) => ({
        resourceRef: resourceRef as `sha256:${string}`,
        byteLength: 4_096,
        mediaType: 'image/png',
      }))
      return { document, descriptors }
    }
    const cases: Array<{
      name: string
      mutate: (fixture: ReturnType<typeof createFixture>) => void
    }> = [
      {
        name: '稀疏瓦片',
        mutate: ({ document }) => {
          if (document.layers[1].type === 'raster') document.layers[1].tiles['0/0/0'] = RESOURCE_A
        },
      },
      {
        name: '可见组',
        mutate: ({ document }) => { document.layers.push(createImageEditGroupLayerV3('group', '组')) },
      },
      {
        name: '可见效果',
        mutate: ({ document }) => {
          document.layers.push(createImageEditEffectLayerV3('effect', '效果', 'blur', {}))
        },
      },
      {
        name: '可见调整',
        mutate: ({ document }) => {
          document.layers.push(createImageEditAdjustmentLayerV3('adjust', '调整', 'levels', {}))
        },
      },
      {
        name: '非 sRGB',
        mutate: ({ document }) => { document.color.workingSpace = 'display-p3' },
      },
      {
        name: '高位深',
        mutate: ({ document }) => { document.color.bitDepth = 16 },
      },
      {
        name: 'HDR',
        mutate: ({ document }) => { document.color.hdrMetadata = createImageEditHdrMetadataV3('pq') },
      },
      {
        name: '自定义 ICC',
        mutate: ({ document }) => { document.color.iccProfileResourceId = RESOURCE_A },
      },
      {
        name: '裁剪',
        mutate: ({ document }) => {
          document.geometry.crop = { x: 0, y: 0, width: 500, height: 400 }
        },
      },
      {
        name: '方向旋转',
        mutate: ({ document }) => { document.geometry.orientation.rotate = 90 },
      },
      {
        name: '描述缺失',
        mutate: ({ descriptors }) => { descriptors.pop() },
      },
      {
        name: '媒体类型不支持',
        mutate: ({ descriptors }) => { descriptors[1].mediaType = 'application/octet-stream' },
      },
    ]

    for (const testCase of cases) {
      const fixture = createFixture()
      testCase.mutate(fixture)
      expect(
        resolveImageEditorRasterPasteboardStackV3(fixture.document, fixture.descriptors),
        testCase.name,
      ).toBeNull()
    }

    const hiddenComplex = createFixture()
    const hiddenEffect = createImageEditEffectLayerV3('hidden-effect', '隐藏效果', 'blur', {})
    hiddenEffect.visible = false
    hiddenComplex.document.layers.push(hiddenEffect)
    expect(resolveImageEditorRasterPasteboardStackV3(
      hiddenComplex.document,
      hiddenComplex.descriptors,
    )).not.toBeNull()
  })
})
