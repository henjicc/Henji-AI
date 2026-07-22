import { describe, expect, it } from 'vitest'

import { createPrototypeDocument, createReplacementDocument } from './prototypeTypes'

function firstReferenceAttributes(document: ReturnType<typeof createPrototypeDocument>) {
  return document.content?.[0]?.content?.find((node) => node.type === 'mediaReference')?.attrs
}

describe('PromptEditor 原型文档', () => {
  it('只持久化稳定媒体身份，不写入缩略图地址', () => {
    const document = createPrototypeDocument()
    const attrs = firstReferenceAttributes(document)

    expect(attrs).toMatchObject({
      id: 'asset-demo-image',
      label: '图1',
      mediaType: 'image',
    })
    expect(attrs).not.toHaveProperty('thumbnailSrc')
    expect(JSON.stringify(document)).not.toContain('data:image')
  })

  it('程序化替换仍保留来源节点身份', () => {
    expect(firstReferenceAttributes(createReplacementDocument())).toMatchObject({
      id: 'asset-demo-video',
      sourceNodeId: 'prototype-source-node',
    })
  })
})
