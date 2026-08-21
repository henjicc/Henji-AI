import { describe, expect, it } from 'vitest'
import { CANVAS_NODE_TYPES, type CanvasNode, type CanvasNodeType } from '../domain/canvasNodes'
import { findGeneratedCoverSources } from './canvasProjectCover'

function imageNode(
  id: string,
  imageUrl: string,
  type: CanvasNodeType = CANVAS_NODE_TYPES.exportImage,
): CanvasNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: {
      displayName: id,
      imageUrl,
      aspectRatio: '1:1',
    },
  }
}

describe('findGeneratedCoverSources', () => {
  it('按节点创建顺序取最早四张生成图片，并忽略上传源节点', () => {
    const nodes = [
      imageNode('upload', 'upload.png', CANVAS_NODE_TYPES.upload),
      imageNode('result-1', 'one.png'),
      imageNode('result-2', 'two.png'),
      imageNode('result-3', 'three.png'),
      imageNode('result-4', 'four.png'),
      imageNode('result-5', 'five.png'),
    ]

    expect(findGeneratedCoverSources(nodes).map((item) => item.source)).toEqual([
      'one.png',
      'two.png',
      'three.png',
      'four.png',
    ])
  })
})
