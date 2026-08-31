import { describe, expect, it } from 'vitest'

import { CANVAS_NODE_TYPES, type CanvasNode } from '@/features/canvas/domain/canvasNodes'
import {
  IMAGE_EDIT_PROJECT_PACKAGE_BUNDLE_PATH_V3,
  IMAGE_EDIT_PROJECT_PACKAGE_EXTENSION_VERSION_V3,
} from '@/core/imageEdit/v3/projectPackageContracts'
import {
  createProjectImageEditorV3Extension,
  mapProjectImageEditorV3SessionSource,
  rewriteProjectImageEditorV3References,
} from './imageEditorV3ProjectAdapter'

const PREVIEW_REF = `sha256:${'a'.repeat(64)}` as const

function node(documentRef = 'image-edit-v3:source-document'): CanvasNode {
  return {
    id: 'edited-image',
    type: CANVAS_NODE_TYPES.exportImage,
    position: { x: 0, y: 0 },
    data: {
      imageUrl: '/source/result.png',
      previewImageUrl: '/source/result.png',
      aspectRatio: '1:1',
      imageEditSession: {
        kind: 'image-edit-v3',
        sourceUrl: '/source/result.png',
        documentRef,
        revision: 7,
        previewRef: PREVIEW_REF,
      },
    },
  } as CanvasNode
}

describe('项目包图片编辑 V3 适配器', () => {
  it('按文档引用去重收集扩展，并同步改写会话来源', () => {
    const first = node()
    const duplicate = { ...node(), id: 'duplicate' }
    expect(createProjectImageEditorV3Extension([first, duplicate])).toEqual({
      version: IMAGE_EDIT_PROJECT_PACKAGE_EXTENSION_VERSION_V3,
      bundlePath: IMAGE_EDIT_PROJECT_PACKAGE_BUNDLE_PATH_V3,
      documents: [{
        documentRef: 'image-edit-v3:source-document',
        revision: 7,
        previewRef: PREVIEW_REF,
      }],
    })

    expect(mapProjectImageEditorV3SessionSource(
      first.data as DynamicValueMap,
      (value) => value === '/source/result.png' ? 'media/1-result.png' : value,
    )).toMatchObject({
      imageEditSession: { sourceUrl: 'media/1-result.png' },
    })
  })

  it('导入时重映射稳定引用并拒绝缺失或版本不一致的映射', () => {
    const imported = rewriteProjectImageEditorV3References([node()], [{
      source: {
        documentRef: 'image-edit-v3:source-document',
        revision: 7,
        previewRef: PREVIEW_REF,
      },
      imported: {
        documentRef: 'image-edit-v3:imported-document',
        revision: 7,
        previewRef: PREVIEW_REF,
      },
    }])
    expect(imported[0].data.imageEditSession).toMatchObject({
      documentRef: 'image-edit-v3:imported-document',
      revision: 7,
      previewRef: PREVIEW_REF,
    })

    expect(() => rewriteProjectImageEditorV3References([node()], [])).toThrow('缺少图片编辑文档映射')
    expect(() => rewriteProjectImageEditorV3References([node()], [{
      source: {
        documentRef: 'image-edit-v3:source-document',
        revision: 6,
        previewRef: PREVIEW_REF,
      },
      imported: {
        documentRef: 'image-edit-v3:imported-document',
        revision: 6,
        previewRef: PREVIEW_REF,
      },
    }])).toThrow('版本不匹配')
  })

  it('拒绝同一文档在项目中出现两个权威 revision', () => {
    const conflicting = node()
    ;(conflicting.data.imageEditSession as { revision: number }).revision = 8
    expect(() => createProjectImageEditorV3Extension([node(), conflicting]))
      .toThrow('冲突版本')
  })
})
