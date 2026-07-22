import { describe, expect, it } from 'vitest'

import { CANVAS_NODE_TYPES, type CanvasEdge, type CanvasNode } from '../domain/canvasNodes'
import { collectInputMedia } from './graphMediaResolver'

describe('collectInputMedia', () => {
  it('为上游媒体补齐结构化提示词所需的稳定来源身份', () => {
    const nodes = [
      {
        id: 'upload-1',
        type: CANVAS_NODE_TYPES.upload,
        position: { x: 0, y: 0 },
        data: { imageUrl: 'C:\\media\\a.png', aspectRatio: '1:1' },
      },
      {
        id: 'generation-1',
        type: CANVAS_NODE_TYPES.imageEdit,
        position: { x: 200, y: 0 },
        data: { imageUrl: null, aspectRatio: '1:1', prompt: '' },
      },
    ] as CanvasNode[]
    const edges = [{
      id: 'edge-1',
      source: 'upload-1',
      target: 'generation-1',
      sourceHandle: 'source',
      targetHandle: 'media:image',
    }] as CanvasEdge[]

    expect(collectInputMedia('generation-1', nodes, edges)).toEqual([expect.objectContaining({
      sourceNodeId: 'upload-1',
      sourceHandle: 'source',
      outputIndex: 0,
      url: 'C:\\media\\a.png',
    })])
  })
})
