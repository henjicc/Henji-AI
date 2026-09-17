import { describe, expect, it } from 'vitest'

import { normalizeCanvasNodeIds } from './canvasNodeIdNormalization'

describe('画布节点稳定引用回传', () => {
  it('剥掉本工程前缀，让刚拿到的 nodeRef 可以原样回传', () => {
    expect(normalizeCanvasNodeIds({ projectId: 'p1', nodeId: 'p1:n1' })).toEqual({ projectId: 'p1', nodeId: 'n1' })
    expect(normalizeCanvasNodeIds({ projectId: 'p1', sourceNodeId: 'p1:a', targetNodeId: 'p1:b' }))
      .toEqual({ projectId: 'p1', sourceNodeId: 'a', targetNodeId: 'b' })
    expect(normalizeCanvasNodeIds({ projectId: 'p1', nodeIds: ['p1:a', 'b'] }))
      .toEqual({ projectId: 'p1', nodeIds: ['a', 'b'] })
  })

  it('别的工程前缀一律原样透传，不把跨工程引用悄悄改成本工程的对象', () => {
    const crossProject = { projectId: 'p1', nodeId: 'p2:n1' }
    expect(normalizeCanvasNodeIds(crossProject)).toBe(crossProject)
    const bare = { projectId: 'p1', nodeId: 'n1' }
    expect(normalizeCanvasNodeIds(bare)).toBe(bare)
    // 只有前缀本身、后面没有节点 id 的输入不算引用，保持原样交给领域判 NOT_FOUND。
    expect(normalizeCanvasNodeIds({ projectId: 'p1', nodeId: 'p1:' })).toEqual({ projectId: 'p1', nodeId: 'p1:' })
  })

  it('没有 projectId 或不是对象时不做任何改动', () => {
    const noProject = { nodeId: 'p1:n1' }
    expect(normalizeCanvasNodeIds(noProject)).toBe(noProject)
    expect(normalizeCanvasNodeIds(null)).toBe(null)
    expect(normalizeCanvasNodeIds(['p1:n1'])).toEqual(['p1:n1'])
  })
})
