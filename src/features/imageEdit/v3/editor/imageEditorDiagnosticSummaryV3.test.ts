import {createImageEditTextLayerV3} from '@/core/imageEdit/v3/documentFactory'
import { describe, expect, it } from 'vitest'

import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory'

import { createImageEditorDiagnosticSummaryV3 } from './imageEditorDiagnosticSummaryV3'

describe('createImageEditorDiagnosticSummaryV3', () => {
  it('只输出结构统计，不包含图层名称、资源引用或标注文字', () => {
    const document = createImageEditDocumentV3({ width: 800, height: 600, documentId: 'doc-1' })
    const layer=createImageEditTextLayerV3('annotations','用户的私密图层名'); layer.content.paragraphs[0].runs[0].text='绝不能进入诊断包'; document.layers.push(layer)
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
