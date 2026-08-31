import { describe, expect, it } from 'vitest'

import { createEmptyImageEditDocument } from '../document'
import {
  coerceImageEditSessionData,
  isImageEditSessionReferenceV3,
  parseImageEditSessionReferenceV3,
} from './sessionReference'

describe('图片编辑 V3 会话引用', () => {
  it('保留受管文档引用并为缺失源地址补上当前图片', () => {
    const session = parseImageEditSessionReferenceV3({
      kind: 'image-edit-v3',
      sourceUrl: '',
      documentRef: 'image-edit-v3:viewer-document',
      revision: 7,
      previewRef: `sha256:${'a'.repeat(64)}`,
    }, 'current.png')

    expect(session).toEqual({
      kind: 'image-edit-v3',
      sourceUrl: 'current.png',
      documentRef: 'image-edit-v3:viewer-document',
      revision: 7,
      previewRef: `sha256:${'a'.repeat(64)}`,
    })
    expect(isImageEditSessionReferenceV3(session)).toBe(true)
  })

  it('拒绝伪造路径、负 revision 与非法预览引用', () => {
    for (const value of [
      {
        kind: 'image-edit-v3', sourceUrl: 'source.png', documentRef: 'file:///tmp/edit.json',
        revision: 1, previewRef: null,
      },
      {
        kind: 'image-edit-v3', sourceUrl: 'source.png', documentRef: 'image-edit-v3:viewer',
        revision: -1, previewRef: null,
      },
      {
        kind: 'image-edit-v3', sourceUrl: 'source.png', documentRef: 'image-edit-v3:viewer',
        revision: 1, previewRef: 'preview.png',
      },
    ]) {
      expect(() => parseImageEditSessionReferenceV3(value, 'fallback.png')).toThrow(
        '图片编辑 V3 会话引用无效',
      )
    }
  })

  it('旧会话继续走 V2 兼容解码，V3 引用不会被降成空白 V2 文档', () => {
    const legacy = {
      sourceUrl: 'legacy.png',
      document: createEmptyImageEditDocument(),
    }
    expect(coerceImageEditSessionData(legacy, 'fallback.png')).toEqual(legacy)

    const v3 = {
      kind: 'image-edit-v3' as const,
      sourceUrl: 'source.png',
      documentRef: 'image-edit-v3:viewer' as const,
      revision: 2,
      previewRef: null,
    }
    expect(coerceImageEditSessionData(v3, 'fallback.png')).toEqual(v3)
  })
})
