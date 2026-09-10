import { describe, expect, it } from 'vitest'
import { CanvasProjectRecordError, parseCanvasProjectRecord, type CanvasProjectJsonRecord } from './projectRecordCodec'
import { mapCanvasNodeMediaReferences, type CanvasMediaSchemaResolver } from './nodeMediaReferences'
import { derivedMediaStateKey } from '../params/derivedMediaStateKey'

const schema: CanvasMediaSchemaResolver = (id) => id === 'known'
  ? [{ id: 'image', type: 'image-upload' }, { id: 'prompt', type: 'textarea' }] : undefined
const node = (data: Record<string, unknown> = {}) => ({ id: 'n', type: 'uploadNode', position: { x: 0, y: 0 }, data })
function record(data: Record<string, unknown> = {}): CanvasProjectJsonRecord {
  return { nodesJson: JSON.stringify([node(data)]), edgesJson: '[]',
    viewportJson: '{"x":0,"y":0,"zoom":1}', historyJson: '{"past":[],"future":[],"imagePool":[]}' }
}

describe('工程当前格式的失败关闭校验', () => {
  it('合法空工程与超出原150万字符的大历史都完整读取', () => {
    expect(parseCanvasProjectRecord({ ...record(), nodesJson: '[]' }, schema).nodes).toEqual([])
    const snapshot = { nodes: [node({ prompt: '文'.repeat(1_600_000) })], edges: [] }
    const result = parseCanvasProjectRecord({ ...record(), historyJson: JSON.stringify({
      past: [snapshot], future: [snapshot], imagePool: [],
    }) }, schema)
    expect(result.history.past).toEqual([snapshot])
    expect(result.history.future).toEqual([snapshot])
  })

  it.each(['nodesJson', 'edgesJson', 'viewportJson', 'historyJson'] as const)('%s 语法错误拒绝且错误不泄露原文', (field) => {
    const input = { ...record(), [field]: '{private-user-prompt' }
    try { parseCanvasProjectRecord(input, schema); expect.fail('必须拒绝') }
    catch (error) {
      expect(error).toBeInstanceOf(CanvasProjectRecordError)
      expect(error).toMatchObject({ field, reason: 'syntax' })
      expect(String(error)).not.toContain('private-user-prompt')
      expect(error).not.toHaveProperty('cause')
    }
    expect(input[field]).toBe('{private-user-prompt')
  })

  it.each([
    { nodesJson: '{}' }, { nodesJson: '[null]' }, { nodesJson: '[{"id":"n"}]' },
    { nodesJson: JSON.stringify([node(), node()]) },
    { nodesJson: JSON.stringify([node({ modelId: 'known', params: null })]) },
    { nodesJson: JSON.stringify([node({ modelId: 'known', params: [] })]) },
    { edgesJson: '{}' }, { edgesJson: '[{"id":"e","source":"n","target":"missing"}]' },
    { viewportJson: '{}' }, { viewportJson: '{"x":0,"y":0,"zoom":0}' },
    { viewportJson: '{"x":1e400,"y":0,"zoom":1}' },
    { historyJson: '{}' }, { historyJson: '{"past":{},"future":[],"imagePool":[]}' },
    { historyJson: '{"past":[{}],"future":[],"imagePool":[]}' },
    { historyJson: '{"past":[],"future":[],"imagePool":[null]}' },
    { historyJson: '{"past":[],"future":[],"imagePool":[""]}' },
  ])('错误结构不会成为可写工程：%j', (patch) => {
    expect(() => parseCanvasProjectRecord({ ...record(), ...patch }, schema)).toThrow(CanvasProjectRecordError)
  })

  it.each(['-1', '1', '0bad', '01', '9007199254740993'])('实际媒体字段中的坏索引 %s 必须拒绝', (suffix) => {
    const value = { ...record({ imageUrl: `__img_ref__:${suffix}` }),
      historyJson: '{"past":[],"future":[],"imagePool":["/image.png"]}' }
    expect(() => parseCanvasProjectRecord(value, schema)).toThrow(CanvasProjectRecordError)
  })

  it('只有媒体字段解码；普通提示词及schema文本字段恰好是保留标记也不误判', () => {
    const data = { prompt: '__img_ref__:999', imageUrl: '__img_ref__:0',
      modelId: 'known', params: { prompt: '__img_ref__:999', image: '__img_ref__:0',
        [derivedMediaStateKey('image')]: { sourceRef: '__img_ref__:0' } } }
    const parsed = parseCanvasProjectRecord({ ...record(data),
      historyJson: '{"past":[],"future":[],"imagePool":["/image.png"]}' }, schema)
    expect(parsed.nodes[0].data.prompt).toBe('__img_ref__:999')
    const mapped = mapCanvasNodeMediaReferences(data, () => '/image.png', schema)
    expect(mapped).toMatchObject({ prompt: '__img_ref__:999', imageUrl: '/image.png',
      params: { prompt: '__img_ref__:999', image: '/image.png',
        [derivedMediaStateKey('image')]: { sourceRef: '/image.png' } } })
  })

  it('模型下线不等于工程损坏，未知参数保持不透明', () => {
    const data = { modelId: 'unknown', params: { image: '__img_ref__:0', prompt: '__img_ref__:999' } }
    expect(parseCanvasProjectRecord(record(data), schema).nodes[0].data).toEqual(data)
  })
})
