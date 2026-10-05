import { describe, expect, it } from 'vitest'
import { CanvasDocumentGraphError, parseCanvasDocumentGraph, parseCanvasHistory } from './canvasDocumentGraph'
import { mapCanvasNodeMediaReferences, type CanvasMediaSchemaResolver } from './nodeMediaReferences'
import { derivedMediaStateKey } from '../params/derivedMediaStateKey'

const schema: CanvasMediaSchemaResolver = (id) => id === 'known'
  ? [{ id: 'image', type: 'image-upload' }, { id: 'prompt', type: 'textarea' }] : undefined
const node = (data: Record<string, unknown> = {}) => ({ id: 'n', type: 'uploadNode', position: { x: 0, y: 0 }, data })
function content(data: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return { nodes: [node(data)], edges: [], ...extra }
}

describe('画布文档节点图的失败关闭校验', () => {
  it('合法空画布与很大的撤销记录都完整读取', () => {
    expect(parseCanvasDocumentGraph({ nodes: [], edges: [] }, schema).nodes).toEqual([])
    const snapshot = { nodes: [node({ prompt: '文'.repeat(1_600_000) })], edges: [] }
    const history = parseCanvasHistory({ past: [snapshot], future: [snapshot] }, [], schema)
    expect(history.past).toEqual([snapshot])
    expect(history.future).toEqual([snapshot])
  })

  it('错误不泄露原文', () => {
    try { parseCanvasDocumentGraph({ nodes: [{ id: 'n', private: 'private-user-prompt' }], edges: [] }, schema); expect.fail('必须拒绝') }
    catch (error) {
      expect(error).toBeInstanceOf(CanvasDocumentGraphError)
      expect(error).toMatchObject({ field: 'nodes', reason: 'structure' })
      expect(String(error)).not.toContain('private-user-prompt')
    }
  })

  it.each([
    { nodes: {} }, { nodes: [null] }, { nodes: [{ id: 'n' }] },
    { nodes: [node(), node()] },
    { nodes: [node({ modelId: 'known', params: null })] },
    { nodes: [node({ modelId: 'known', params: [] })] },
    { edges: {} }, { edges: [{ id: 'e', source: 'n', target: 'missing' }] },
    { imagePool: [null] }, { imagePool: [''] },
  ])('错误结构不会成为可写画布：%j', (patch) => {
    expect(() => parseCanvasDocumentGraph({ ...content(), ...patch }, schema)).toThrow(CanvasDocumentGraphError)
  })

  it.each([{}, { past: {}, future: [] }, { past: [{}], future: [] }])('撤销记录结构错误被拒绝：%j', (history) => {
    expect(() => parseCanvasHistory(history, [], schema)).toThrow(CanvasDocumentGraphError)
  })

  it.each(['-1', '1', '0bad', '01', '9007199254740993'])('实际媒体字段中的坏索引 %s 必须拒绝', (suffix) => {
    expect(() => parseCanvasDocumentGraph(content({ imageUrl: `__img_ref__:${suffix}` }, { imagePool: ['/image.png'] }), schema))
      .toThrow(CanvasDocumentGraphError)
  })

  it('只有媒体字段解码；普通提示词及schema文本字段恰好是保留标记也不误判', () => {
    const data = { prompt: '__img_ref__:999', imageUrl: '__img_ref__:0',
      modelId: 'known', params: { prompt: '__img_ref__:999', image: '__img_ref__:0',
        [derivedMediaStateKey('image')]: { sourceRef: '__img_ref__:0' } } }
    const parsed = parseCanvasDocumentGraph(content(data, { imagePool: ['/image.png'] }), schema)
    expect(parsed.nodes[0].data.prompt).toBe('__img_ref__:999')
    const mapped = mapCanvasNodeMediaReferences(data, () => '/image.png', schema)
    expect(mapped).toMatchObject({ prompt: '__img_ref__:999', imageUrl: '/image.png',
      params: { prompt: '__img_ref__:999', image: '/image.png',
        [derivedMediaStateKey('image')]: { sourceRef: '/image.png' } } })
  })

  it('模型下线不等于画布损坏，未知参数保持不透明', () => {
    const data = { modelId: 'unknown', params: { image: '__img_ref__:0', prompt: '__img_ref__:999' } }
    expect(parseCanvasDocumentGraph(content(data), schema).nodes[0].data).toEqual(data)
  })
})
