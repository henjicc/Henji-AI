import { describe, expect, it } from 'vitest'

import {
  buildDocumentEnvelope,
  DocumentFormatError,
  parseDocumentText,
  serializeDocumentEnvelope,
} from './envelope'
import {
  createDocumentKindRegistry,
  defineSkeletonDocumentKind,
  DOCUMENT_KINDS,
  documentKindRegistry,
} from './kinds'
import {
  documentNameFromFileName,
  entryNameKey,
  keepBothEntryName,
  MAX_ENTRY_NAME_LENGTH,
  normalizeEntryName,
  untitledEntryName,
} from './naming'
import {
  buildProjectManifest,
  inferProjectLocale,
  parseProjectManifestText,
  serializeProjectManifest,
} from './projectManifest'
import { createDocumentRequestSchema, nameCheckRequestSchema, saveDocumentRequestSchema } from './requests'

describe('名称规则（Windows 文件名规则）', () => {
  it('去掉首尾空白与末尾的点，比较不分大小写', () => {
    expect(normalizeEntryName('  我的项目 . . ')).toEqual({ ok: true, name: '我的项目' })
    expect(entryNameKey('Demo.')).toBe(entryNameKey('demo'))
    expect(entryNameKey('café')).toBe(entryNameKey('CAFÉ'))
  })

  it('拒绝空名、非法字符、保留名与超长名称', () => {
    expect(normalizeEntryName(' .. ')).toMatchObject({ ok: false, reason: 'empty' })
    for (const name of ['a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b', 'a\u0001b']) {
      expect(normalizeEntryName(name)).toMatchObject({ ok: false, reason: 'illegal_characters' })
    }
    for (const name of ['CON', 'con', 'Nul.txt', 'COM1', 'lpt9', 'COM¹', 'aux.henji-canvas']) {
      expect(normalizeEntryName(name)).toMatchObject({ ok: false, reason: 'reserved' })
    }
    expect(normalizeEntryName('CONSOLE')).toEqual({ ok: true, name: 'CONSOLE' })
    expect(normalizeEntryName('x'.repeat(MAX_ENTRY_NAME_LENGTH + 1))).toMatchObject({ ok: false, reason: 'too_long' })
  })

  it('自动名顺延；“两个都保留”加序号且不超长', () => {
    const taken = new Set(['未命名项目 1', '未命名项目 2'].map(entryNameKey))
    expect(untitledEntryName('未命名项目', (name) => taken.has(entryNameKey(name)))).toBe('未命名项目 3')
    const files = new Set(['镜头', '镜头 (2)'].map(entryNameKey))
    expect(keepBothEntryName('镜头', (name) => files.has(entryNameKey(name)))).toBe('镜头 (3)')
    expect(keepBothEntryName('新名字', () => false)).toBe('新名字')
    const long = 'x'.repeat(MAX_ENTRY_NAME_LENGTH)
    const numbered = keepBothEntryName(long, (name) => name === long)
    expect(numbered.endsWith(' (2)')).toBe(true)
    expect(numbered.length).toBe(MAX_ENTRY_NAME_LENGTH)
  })

  it('按扩展名取文档名（扩展名不分大小写）', () => {
    expect(documentNameFromFileName('分镜.HENJI-CANVAS', '.henji-canvas')).toBe('分镜')
    expect(documentNameFromFileName('分镜.henji-stage', '.henji-canvas')).toBeNull()
    expect(documentNameFromFileName('.henji-canvas', '.henji-canvas')).toBeNull()
  })
})

describe('文档外壳', () => {
  const base = {
    kind: 'canvas', kindVersion: 1, id: 'doc-1', name: '分镜', createdAt: '2026-10-05T10:00:00.000Z',
    updatedAt: '2026-10-05T10:00:00.000Z', revision: 0, content: { nodes: [] },
  }

  it('固定字段顺序，草稿标记只在为真时写出，往返一致', () => {
    const draft = buildDocumentEnvelope({ ...base, draft: true })
    expect(Object.keys(draft)).toEqual(['format', 'kind', 'kindVersion', 'id', 'name', 'createdAt', 'updatedAt', 'revision', 'draft', 'content'])
    expect(parseDocumentText(serializeDocumentEnvelope(draft))).toEqual(draft)
    const saved = buildDocumentEnvelope({ ...base, draft: false })
    expect('draft' in saved).toBe(false)
    expect(parseDocumentText(`\ufeff${serializeDocumentEnvelope(saved)}`)).toEqual(saved)
  })

  it('损坏、缺字段、未知字段与旧格式都拒绝', () => {
    expect(() => parseDocumentText('{')).toThrow(DocumentFormatError)
    expect(() => parseDocumentText(JSON.stringify({ ...base, format: 'henji-document', extra: 1 }))).toThrow(DocumentFormatError)
    expect(() => parseDocumentText(JSON.stringify({ ...base, format: 'henji-document', content: undefined }))).toThrow(DocumentFormatError)
    expect(() => parseDocumentText(JSON.stringify({ format: 'henji-video-project', version: 2, id: 'x' }))).toThrow(DocumentFormatError)
    expect(() => parseDocumentText(JSON.stringify({ ...base, format: 'henji-document', id: '../x' }))).toThrow(DocumentFormatError)
  })
})

describe('项目说明', () => {
  it('按语言写入子文件夹名，往返一致；推断旧文件夹语言', () => {
    const manifest = buildProjectManifest({ id: 'p1', createdAt: '2026-10-05T10:00:00.000Z', locale: 'en', draft: true })
    expect(manifest.folders).toEqual({ generated: 'Generated', materials: 'Media' })
    expect(parseProjectManifestText(serializeProjectManifest(manifest))).toEqual(manifest)
    const saved = buildProjectManifest({ ...manifest, draft: false, mainVideoEditId: 'v1' })
    expect(saved).not.toHaveProperty('draft')
    expect(saved.mainVideoEditId).toBe('v1')
    expect(inferProjectLocale(['生成结果', 'a.henji-video'], 'en')).toBe('zh')
    expect(inferProjectLocale(['media'], 'zh')).toBe('en')
    expect(inferProjectLocale([], 'zh')).toBe('zh')
    expect(() => parseProjectManifestText(JSON.stringify({ ...manifest, folders: { generated: '../x', materials: 'm' } }))).toThrow('项目说明无效')
  })
})

describe('文档类型登记', () => {
  it('五种类型的扩展名、独立存放文件夹与存储方式', () => {
    const rows = DOCUMENT_KINDS.map((kind) => [kind.id, kind.extension, kind.standaloneFolderNames, kind.storage, kind.version])
    expect(rows).toEqual([
      ['video_edit', '.henji-video', null, 'json', 1],
      ['canvas', '.henji-canvas', { zh: '画布', en: 'Canvases' }, 'json', 1],
      ['audio_edit', '.henji-audio', { zh: '口播', en: 'Voiceovers' }, 'json', 1],
      ['camera_stage', '.henji-stage', { zh: '镜头参考', en: 'Camera Stages' }, 'json', 1],
      ['image_document', '.henjiimg', { zh: '图片文档', en: 'Image Documents' }, 'package', 1],
    ])
    expect(documentKindRegistry.forFileName('a.HenjiImg')?.id).toBe('image_document')
    expect(documentKindRegistry.forFileName('a.json')).toBeUndefined()
    expect(() => documentKindRegistry.require('nope')).toThrow('未登记')
  })

  it('骨架类型：空对象为空内容，摘要为空', () => {
    const kind = defineSkeletonDocumentKind({ id: 'canvas', extension: '.henji-test', standaloneFolderNames: null, untitledNames: { zh: '测试', en: 'Test' }, storage: 'json' })
    const empty = kind.createEmptyContent()
    expect(kind.isEmptyContent(empty)).toBe(true)
    expect(kind.isEmptyContent({ nodes: [] })).toBe(false)
    expect(kind.summarize(empty)).toEqual({})
    expect(kind.contentSchema.safeParse([]).success).toBe(false)
  })

  it('画布（3.4）：节点 / 连线为内容，没有节点就是空画布，摘要是节点数', () => {
    const kind = documentKindRegistry.require('canvas')
    expect(kind.createEmptyContent()).toEqual({ nodes: [], edges: [] })
    expect(kind.isEmptyContent(kind.createEmptyContent())).toBe(true)
    expect(kind.contentSchema.safeParse({ nodes: [{ id: 'n' }], edges: [] }).success).toBe(false)
  })

  it('重复的 ID、扩展名、独立文件夹与非法名称在登记时拒绝', () => {
    const canvas = documentKindRegistry.require('canvas')
    expect(() => createDocumentKindRegistry([canvas, canvas])).toThrow('重复登记')
    expect(() => createDocumentKindRegistry([canvas, { ...documentKindRegistry.require('audio_edit'), extension: '.henji-canvas' }])).toThrow('扩展名重复')
    expect(() => createDocumentKindRegistry([canvas, { ...documentKindRegistry.require('audio_edit'), standaloneFolderNames: { zh: '画布', en: 'Voice' } }])).toThrow('文件夹重名')
    expect(() => createDocumentKindRegistry([defineSkeletonDocumentKind({ id: 'canvas', extension: '.Bad', standaloneFolderNames: null, untitledNames: { zh: 'a', en: 'b' }, storage: 'json' })])).toThrow('扩展名无效')
    expect(() => createDocumentKindRegistry([defineSkeletonDocumentKind({ id: 'canvas', extension: '.ok', standaloneFolderNames: { zh: 'a:b', en: 'b' }, untitledNames: { zh: 'a', en: 'b' }, storage: 'json' })])).toThrow('不能用作文件名')
  })
})

describe('请求校验', () => {
  it('接受合法请求，拒绝未知字段、错类型与空内容', () => {
    expect(createDocumentRequestSchema.parse({ kind: 'canvas', container: { kind: 'user' } })).toEqual({ kind: 'canvas', container: { kind: 'user' } })
    expect(() => createDocumentRequestSchema.parse({ kind: 'canvas', container: { kind: 'project' } })).toThrow()
    expect(() => createDocumentRequestSchema.parse({ kind: 'unknown', container: { kind: 'user' } })).toThrow()
    expect(() => saveDocumentRequestSchema.parse({ target: { id: 'a' }, expectedRevision: 0 })).toThrow()
    expect(() => saveDocumentRequestSchema.parse({ target: { id: 'a' }, expectedRevision: -1, content: {} })).toThrow()
    expect(nameCheckRequestSchema.parse({ subject: { type: 'project' }, name: 'x', location: { container: { kind: 'user' } } }).name).toBe('x')
    expect(() => nameCheckRequestSchema.parse({ subject: { type: 'project' }, name: 'x', location: { folder: 'a\0b' } })).toThrow()
  })
})
