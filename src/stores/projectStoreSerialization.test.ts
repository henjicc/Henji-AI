import { describe, expect, it } from 'vitest'
import type { CanvasNode } from '@/features/canvas/domain/canvasNodes'
import { fromProjectRecord, toProjectRecord, type Project } from './projectStoreSerialization'

function node(imageUrl: string, x = 0): CanvasNode {
  return { id: 'image', type: 'uploadNode', position: { x, y: 0 },
    data: { mediaType: 'image', imageUrl } }
}

function project(nodes: CanvasNode[]): Project {
  return { id: 'serialization', name: '保存测试', createdAt: 1, updatedAt: 2, nodeCount: nodes.length,
    coverPath: null, nodes, edges: [], viewport: { x: 0, y: 0, zoom: 1 }, history: { past: [], future: [] } }
}

describe('工程保存的结构共享与历史边界', () => {
  it('保留已有的历史数量与顺序、同 ID 的不同版本及全部存活媒体，不改变内存历史', () => {
    const current = node('/current.png', 100)
    const input = project([current])
    input.history = {
      past: Array.from({ length: 50 }, (_, i) => ({ nodes: [node(`/past-${i}.png`, i)], edges: [] })),
      future: Array.from({ length: 20 }, (_, i) => ({ nodes: [node(`/future-${i}.png`, i + 200)], edges: [] })),
    }
    input.history.past[49].nodes = input.nodes
    const before = JSON.stringify(input)
    const restored = fromProjectRecord(toProjectRecord(input))
    expect(restored.nodes).toEqual(input.nodes)
    expect(restored.history.past).toEqual(input.history.past.slice(-12))
    expect(restored.history.future).toEqual(input.history.future.slice(-12))
    expect(JSON.stringify(input)).toBe(before)
  })

  it('只在历史中出现的缺失模型仍保留未知参数的原媒体池索引', () => {
    const input = project([node('/new.png')])
    input.imagePool = ['/unused.png', '/opaque.png']
    const missing = { ...node('/known.png'), data: { modelId: 'missing-model-for-serialization',
      params: { unknownMedia: '__img_ref__:1', literalText: '__img_ref__:999' }, imageUrl: '/known.png' } } as CanvasNode
    input.history.future = [{ nodes: [missing], edges: [] }]
    const restored = fromProjectRecord(toProjectRecord(input))
    expect(restored.history.future[0].nodes).toEqual([missing])
    expect(restored.imagePool?.slice(0, 2)).toEqual(input.imagePool)
    expect(restored.nodes).toEqual(input.nodes)
  })

  it('编码缓存不跨保存或项目复用，后续数据变化与独立媒体池均可恢复', () => {
    const shared = node('/first.png')
    const input = project([shared])
    input.history.past = [{ nodes: input.nodes, edges: [] }]
    const first = toProjectRecord(input)
    shared.data.imageUrl = '/second.png'
    const second = toProjectRecord(input)
    const other = project([node('/other.png'), shared])
    other.nodes[0].id = 'other'
    const third = toProjectRecord(other)
    expect(fromProjectRecord(first).nodes[0].data.imageUrl).toBe('/first.png')
    expect(fromProjectRecord(second).nodes[0].data.imageUrl).toBe('/second.png')
    expect(fromProjectRecord(second).history.past[0].nodes[0].data.imageUrl).toBe('/second.png')
    expect(fromProjectRecord(third).nodes.map(item => item.data.imageUrl)).toEqual(['/other.png', '/second.png'])
  })
})

// 显式专项基准：完整编码、JSON 写入和公共记录校验，不设受机器噪声影响的单测耗时阈值。
if (process.env.CANVAS_SERIALIZATION_BENCH === '1') {
  it('千节点、50 次局部编辑的保存基准', () => {
    let nodes = Array.from({ length: 1000 }, (_, i) => ({ ...node(`/media/${i % 30}.png`, i * 350), id: `node-${i}` }))
    const input = project(nodes)
    for (let i = 0; i < 50; i++) {
      input.history.past.push({ nodes, edges: [] })
      nodes = nodes.map((item, index) => index === i ? { ...item, position: { x: item.position.x + 10, y: 0 } } : item)
    }
    input.nodes = nodes
    const samples = []
    for (let i = 0; i < 9; i++) {
      const start = performance.now()
      const record = toProjectRecord(input)
      const elapsed = performance.now() - start
      if (i >= 2) samples.push(elapsed)
      expect(JSON.parse(record.historyJson).past).toHaveLength(12)
    }
    process.stdout.write(`[canvas-serialization-bench] ${JSON.stringify({ nodes: 1000, history: 50, samples,
      medianMs: [...samples].sort((a, b) => a - b)[3] })}\n`)
  })
}
