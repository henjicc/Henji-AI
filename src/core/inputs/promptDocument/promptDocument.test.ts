import { describe, expect, it, vi } from 'vitest'
import {
  createLegacyPromptMediaLabels,
  createPromptDocumentDoubleWrite,
  parseLegacyPromptString,
  readPromptDocument,
  toLegacyPromptString,
  toMarkdown,
  toModelPromptText,
  validatePromptDocumentV1,
  type LegacyPromptParseOptions,
  type PromptDocumentV1,
} from './index'

const PARSE_OPTIONS: LegacyPromptParseOptions = {
  references: [
    { resourceId: 'asset:a', mediaType: 'image', label: '图1' },
    {
      resourceId: 'canvas-output:node-1:video:0',
      mediaType: 'video',
      label: '视频1',
      sourceNodeId: 'node-1',
    },
  ],
  variables: [{ key: 'style', label: '风格' }],
}

const STRUCTURED_DOCUMENT: PromptDocumentV1 = {
  version: 1,
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: '主体参考 ' },
        {
          type: 'mediaReference',
          attrs: {
            resourceId: 'asset:a',
            mediaType: 'image',
            fallbackLabel: '旧图',
          },
        },
        { type: 'text', text: '，风格 ' },
        {
          type: 'templateVariable',
          attrs: { key: 'style', fallbackLabel: '风格' },
        },
      ],
    },
    {
      type: 'paragraph',
      content: [{ type: 'text', text: '第二段' }, { type: 'hardBreak' }, { type: 'text', text: '换行' }],
    },
  ],
}

describe('PromptDocumentV1 validation', () => {
  it('接受冻结的 V1 schema', () => {
    expect(validatePromptDocumentV1(STRUCTURED_DOCUMENT)).toEqual({
      valid: true,
      document: STRUCTURED_DOCUMENT,
    })
  })

  it('拒绝未知版本、未知节点和混入缩略图的 attrs', () => {
    expect(validatePromptDocumentV1({ ...STRUCTURED_DOCUMENT, version: 2 })).toMatchObject({
      valid: false,
      reason: 'unknown_version',
      documentVersion: 2,
    })
    expect(validatePromptDocumentV1({
      version: 1,
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'heading', text: 'x' }] }],
    }).valid).toBe(false)
    expect(validatePromptDocumentV1({
      version: 1,
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{
          type: 'mediaReference',
          attrs: {
            resourceId: 'asset:a',
            mediaType: 'image',
            fallbackLabel: '图1',
            thumbnailSrc: 'secret-url',
          },
        }],
      }],
    }).valid).toBe(false)
  })
})

describe('legacy prompt parser', () => {
  it('把旧图片简称解析到当前统一标签', () => {
    const options: LegacyPromptParseOptions = {
      references: [{
        resourceId: 'asset:a',
        mediaType: 'image',
        label: '图片1',
        legacyLabels: createLegacyPromptMediaLabels('image', 1),
      }],
    }
    const document = parseLegacyPromptString('参考 @图1，也参考 图片1，还参考 图片 1', options)

    expect(document.content[0].content?.filter((node) => node.type === 'mediaReference'))
      .toHaveLength(3)
    expect(toLegacyPromptString(document, { references: options.references }))
      .toBe('参考 @图片1，也参考 @图片1，还参考 @图片1')
  })

  it('仅把 resolver 表唯一命中的引用和变量升级为 atom', () => {
    const document = parseLegacyPromptString(
      '参考 @图1 和 视频1，使用 {{style}}；未知 @图9 {{unknown}}',
      PARSE_OPTIONS,
    )
    const content = document.content[0].content ?? []

    expect(content.filter((node) => node.type === 'mediaReference')).toHaveLength(2)
    expect(content.filter((node) => node.type === 'templateVariable')).toHaveLength(1)
    expect(toLegacyPromptString(document)).toContain('未知 @图9 {{unknown}}')
  })

  it('重复标签和数字后缀不做有歧义的局部升级', () => {
    const duplicated: LegacyPromptParseOptions = {
      references: [
        { resourceId: 'asset:a', mediaType: 'image', label: '图1' },
        { resourceId: 'asset:b', mediaType: 'image', label: '图1' },
      ],
    }
    const duplicateDocument = parseLegacyPromptString('@图1', duplicated)
    const suffixDocument = parseLegacyPromptString('图10', PARSE_OPTIONS)

    expect(duplicateDocument.content[0].content).toEqual([{ type: 'text', text: '@图1' }])
    expect(suffixDocument.content[0].content).toEqual([{ type: 'text', text: '图10' }])
  })

  it('中文与换行往返不丢失', () => {
    const legacy = '第一行 @图1\n第二行 {{style}}'
    expect(toLegacyPromptString(parseLegacyPromptString(legacy, PARSE_OPTIONS))).toBe(legacy)
  })
})

describe('prompt serializers', () => {
  const context = { references: [{ resourceId: 'asset:a', label: '图2' }] }

  it('输出旧字符串、模型文本与可逆 Markdown', () => {
    expect(toLegacyPromptString(STRUCTURED_DOCUMENT, context))
      .toBe('主体参考 @图2，风格 {{style}}\n第二段\n换行')
    expect(toModelPromptText(STRUCTURED_DOCUMENT, context))
      .toBe('主体参考 图2，风格 {{style}}\n第二段\n换行')
    expect(toMarkdown(STRUCTURED_DOCUMENT, context))
      .toBe('主体参考 @[图2](henji-media:asset%3Aa)，风格 {{style}}\n第二段\n换行')
  })

  it('编辑兼容字符串保持紧凑，模型文本在引用两侧智能补空格', () => {
    const compactDocument: PromptDocumentV1 = {
      version: 1,
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: '参考' },
          {
            type: 'mediaReference',
            attrs: { resourceId: 'asset:a', mediaType: 'image', fallbackLabel: '图片1' },
          },
          { type: 'text', text: '然后修改' },
        ],
      }],
    }

    expect(toLegacyPromptString(compactDocument, {
      references: [{ resourceId: 'asset:a', label: '图片1' }],
    })).toBe('参考@图片1然后修改')
    expect(toModelPromptText(compactDocument, {
      references: [{ resourceId: 'asset:a', label: '图片1' }],
    })).toBe('参考 图片1 然后修改')
  })

  it('失效引用使用 fallbackLabel，模型文本移除引用前缀', () => {
    const legacy = toLegacyPromptString(STRUCTURED_DOCUMENT)
    expect(legacy).toContain('@旧图')

    const currentReferenceDocument = parseLegacyPromptString('@图1', PARSE_OPTIONS)
    expect(toLegacyPromptString(currentReferenceDocument)).toBe('@图1')
    expect(toModelPromptText(currentReferenceDocument)).toBe('图1')
  })
})

describe('prompt document adapter', () => {
  it('结构化值有效时优先使用，不读取 legacyText', () => {
    const result = readPromptDocument({
      document: STRUCTURED_DOCUMENT,
      legacyText: '不应使用',
    }, PARSE_OPTIONS)

    expect(result.source).toBe('document')
    expect(result.document).toEqual(STRUCTURED_DOCUMENT)
  })

  it('损坏或未知版本整份回退，并上报不含正文的诊断', () => {
    const reportFallback = vi.fn()
    const result = readPromptDocument({
      document: { version: 99, body: '敏感正文' },
      legacyText: '保留 @图1',
    }, {
      ...PARSE_OPTIONS,
      carrierType: 'canvas-node',
      carrierId: 'node-1',
      reportFallback,
    })

    expect(result.source).toBe('legacy')
    expect(toLegacyPromptString(result.document)).toBe('保留 @图1')
    expect(reportFallback).toHaveBeenCalledWith({
      event: 'prompt_document.parse.fallback',
      carrierType: 'canvas-node',
      carrierId: 'node-1',
      reason: 'unknown_version',
      documentVersion: 99,
    })
    expect(JSON.stringify(reportFallback.mock.calls)).not.toContain('敏感正文')
  })

  it('旧载体缺少结构化字段时正常升级，不记录异常回退', () => {
    const reportFallback = vi.fn()
    const result = readPromptDocument(
      { legacyText: '旧提示词' },
      { reportFallback },
    )

    expect(result.source).toBe('legacy')
    expect(reportFallback).not.toHaveBeenCalled()
  })

  it('双写在同一纯函数结果中产出规范文档与兼容字符串', () => {
    expect(createPromptDocumentDoubleWrite(STRUCTURED_DOCUMENT, {
      references: [{ resourceId: 'asset:a', label: '图3' }],
    })).toEqual({
      document: STRUCTURED_DOCUMENT,
      legacyText: '主体参考 @图3，风格 {{style}}\n第二段\n换行',
    })
  })
})
