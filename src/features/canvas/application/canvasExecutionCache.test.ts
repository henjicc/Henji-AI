import { describe, expect, it } from 'vitest'

import {
  CANVAS_NODE_TYPES,
  type CanvasEdge,
  type CanvasNode,
  type CanvasNodeData,
} from '../domain/canvasNodes'
import {
  createCanvasExecutionValueSignature,
  readCanvasLatestExecution,
  resolveCanvasDependencyRunPolicy,
} from './canvasExecutionCache'
import { createCanvasNodeInputSignature } from './canvasExecutionSignature'

describe('canvasExecutionCache', () => {
  it('对象键顺序不影响输入签名，数组顺序仍有意义', () => {
    expect(createCanvasExecutionValueSignature({ b: 2, a: [1, 2] }))
      .toBe(createCanvasExecutionValueSignature({ a: [1, 2], b: 2 }))
    expect(createCanvasExecutionValueSignature({ a: [1, 2] }))
      .not.toBe(createCanvasExecutionValueSignature({ a: [2, 1] }))
  })

  it('显式策略优先，并兼容文本处理旧 fixedResult 字段', () => {
    expect(resolveCanvasDependencyRunPolicy({ fixedResult: false } as CanvasNodeData))
      .toBe('always-run')
    expect(resolveCanvasDependencyRunPolicy({
      fixedResult: false,
      dependencyRunPolicy: 'reuse-if-valid',
    } as CanvasNodeData)).toBe('reuse-if-valid')
    expect(resolveCanvasDependencyRunPolicy({} as CanvasNodeData)).toBe('reuse-if-valid')
  })

  it('只读取版本与结构完整的结果引用，并稳定按输出顺序排列', () => {
    expect(readCanvasLatestExecution({ latestExecution: { version: 99 } } as CanvasNodeData))
      .toBeNull()
    expect(readCanvasLatestExecution({
      latestExecution: {
        version: 1,
        inputSignature: 'canvas-input-v2-test',
        outputMode: 'result-nodes',
        outputRefs: [
          { resultNodeId: 'second', order: 2 },
          { resultNodeId: 'first', order: 1 },
        ],
      },
    } as CanvasNodeData)?.outputRefs.map((item) => item.resultNodeId)).toEqual(['first', 'second'])
  })

  it('输入连线顺序参与签名，但连线自身随机 ID 不参与', () => {
    const nodes = [
      { id: 'a', type: CANVAS_NODE_TYPES.upload, position: { x: 0, y: 0 }, data: { imageUrl: 'a.png' } },
      { id: 'b', type: CANVAS_NODE_TYPES.upload, position: { x: 0, y: 0 }, data: { imageUrl: 'b.png' } },
      { id: 'target', type: CANVAS_NODE_TYPES.imageEdit, position: { x: 0, y: 0 }, data: {} },
    ] as CanvasNode[]
    const first = { source: 'a', target: 'target', targetHandle: 'param:__image' }
    const second = { source: 'b', target: 'target', targetHandle: 'param:__image' }
    const edges = [
      { id: 'edge-a', ...first },
      { id: 'edge-b', ...second },
    ] as CanvasEdge[]
    const renamedEdges = [
      { id: 'new-a', ...first },
      { id: 'new-b', ...second },
    ] as CanvasEdge[]
    const reversedEdges = [edges[1], edges[0]]

    expect(createCanvasNodeInputSignature('target', nodes, edges))
      .toBe(createCanvasNodeInputSignature('target', nodes, renamedEdges))
    expect(createCanvasNodeInputSignature('target', nodes, edges))
      .not.toBe(createCanvasNodeInputSignature('target', nodes, reversedEdges))
  })
})
