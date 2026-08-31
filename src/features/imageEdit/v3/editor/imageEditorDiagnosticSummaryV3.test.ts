import { describe, expect, it } from 'vitest'

import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory'
import { createImageEditLayerCommonV3 } from '@/core/imageEdit/v3/layerTypes'
import { createImageEditorDiagnosticSummaryV3 } from './imageEditorDiagnosticSummaryV3'

describe('createImageEditorDiagnosticSummaryV3', () => {
  it('只输出结构统计，不包含图层名称、资源引用或标注文字', () => {
    const document = createImageEditDocumentV3({ width: 800, height: 600, documentId: 'doc-1' })
    document.layers.push({
      ...createImageEditLayerCommonV3('annotations', '用户的私密图层名'),
      type: 'annotation',
      annotations: [{
        id: 'text-1',
        type: 'text',
        x: 1,
        y: 2,
        text: '绝不能进入诊断包',
        color: 'red',
        fontSize: 12,
      }],
    })
    const summary = createImageEditorDiagnosticSummaryV3(document, 'full', [{
      resourceRef: 'sha256:private-resource',
      byteLength: 1234,
      mediaType: 'image/jpeg',
    }])
    expect(summary).toMatchObject({
      source: { mediaTypes: ['image/jpeg'], width: 800, height: 600, byteLength: 1234 },
      layers: { annotation: 1, annotationObjects: 1 },
    })
    const serialized = JSON.stringify(summary)
    expect(serialized).not.toContain('用户的私密图层名')
    expect(serialized).not.toContain('绝不能进入诊断包')
    expect(serialized).not.toContain('private-resource')
  })
})
