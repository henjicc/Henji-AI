// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'

import { CANVAS_NODE_TYPES, type CanvasNode, type CanvasNodeType } from '@/features/canvas/domain/canvasNodes'
import { canvasNodeDefinitions } from '@/features/canvas/domain/nodeRegistry'
import { useCanvasStore } from './canvasStore'

function createNode<T extends CanvasNodeType>(id: string, type: T): CanvasNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: canvasNodeDefinitions[type].createDefaultData(),
  } as CanvasNode
}

describe('canvasStore 全景图片连线', () => {
  beforeEach(() => {
    useCanvasStore.getState().setCanvasData([
      createNode('generator', CANVAS_NODE_TYPES.panoramaGen),
      createNode('panorama', CANVAS_NODE_TYPES.panoramaViewer),
      createNode('camera-stage', CANVAS_NODE_TYPES.cameraStage),
    ], [], { past: [], future: [] })
  })

  it('程序化创建的全景查看与 3D 环境连线都落到标准图片输入行', () => {
    useCanvasStore.getState().addEdge('generator', 'panorama')
    useCanvasStore.getState().addEdge('panorama', 'camera-stage')

    expect(useCanvasStore.getState().edges).toEqual([
      expect.objectContaining({ source: 'generator', target: 'panorama', targetHandle: 'param:__image' }),
      expect.objectContaining({ source: 'panorama', target: 'camera-stage', targetHandle: 'param:__image' }),
    ])
  })
})
