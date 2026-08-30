import { describe, expect, it } from 'vitest'
import { createImageEditDocumentV3 } from '@/core/imageEdit/v3'
import {
  mapImageEditorV3OutputPixelToSource,
  resolveImageEditorV3ExportGeometry,
  resolveImageEditorV3SourceRegion,
} from './geometry'

describe('图片编辑 V3 导出几何', () => {
  it('按先镜像、再旋转、最后裁剪的文档语义反算源像素', () => {
    const document = createImageEditDocumentV3({ width: 4, height: 3, documentId: 'geometry' })
    document.geometry.orientation = { rotate: 90, mirrored: true }
    document.geometry.crop = { x: 1, y: 1, width: 2, height: 3 }
    const geometry = resolveImageEditorV3ExportGeometry(document, { width: 2, height: 3 })

    expect(geometry).toMatchObject({ orientedWidth: 3, orientedHeight: 4, cropX: 1, cropY: 1 })
    expect(mapImageEditorV3OutputPixelToSource(0, 0, geometry)).toEqual([2, 1])
    expect(mapImageEditorV3OutputPixelToSource(1, 2, geometry)).toEqual([0, 0])
  })

  it('把输出瓦片反向规划为带 halo 且对齐的有界源区域', () => {
    const document = createImageEditDocumentV3({ width: 100, height: 80, documentId: 'region' })
    const geometry = resolveImageEditorV3ExportGeometry(document)
    expect(resolveImageEditorV3SourceRegion(
      { x: 16, y: 12, width: 20, height: 10 },
      geometry,
      { halo: 6, alignment: 4 },
    )).toEqual({ x: 8, y: 4, width: 36, height: 24 })
  })

  it('拒绝分数像素裁剪，避免导出时无声明地重采样', () => {
    const document = createImageEditDocumentV3({ width: 20, height: 20, documentId: 'fractional' })
    document.geometry.crop = { x: 0.5, y: 0, width: 10, height: 10 }
    expect(() => resolveImageEditorV3ExportGeometry(document)).toThrow('必须是整数')
  })
})
