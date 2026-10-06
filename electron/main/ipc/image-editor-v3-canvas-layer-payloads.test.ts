import { describe, expect, it } from 'vitest'

import { parseImageEditorV3CanvasLayersCommitPayload } from './image-editor-v3-payloads'

const base = { requestId: 'canvas-layers:commit:1', canvasId: 'canvas-1', container: { kind: 'user' }, documentIds: ['layer-a'] }

describe('画布内嵌图片文档写回请求', () => {
  it('仍在用清单可选：省略时不带，给出时逐个校验文档 ID', () => {
    expect(parseImageEditorV3CanvasLayersCommitPayload(base)).not.toHaveProperty('retainedDocumentIds')
    expect(parseImageEditorV3CanvasLayersCommitPayload({ ...base, retainedDocumentIds: ['layer-a', 'layer-b'] }))
      .toMatchObject({ documentIds: ['layer-a'], retainedDocumentIds: ['layer-a', 'layer-b'] })
    expect(() => parseImageEditorV3CanvasLayersCommitPayload({ ...base, retainedDocumentIds: ['../坏的'] })).toThrow()
    expect(() => parseImageEditorV3CanvasLayersCommitPayload({ ...base, retainedDocumentIds: 'layer-a' })).toThrow()
    expect(() => parseImageEditorV3CanvasLayersCommitPayload({ ...base, extra: true })).toThrow()
  })
})
