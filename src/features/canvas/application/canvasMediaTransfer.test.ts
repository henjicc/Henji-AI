import { describe, expect, it } from 'vitest'
import type { CanvasNode } from '../domain/canvasNodes'
import { getSelectedCanvasMediaTransfers } from './canvasMediaTransfer'

const image = (id: string, selected = true): CanvasNode => ({ id, type: 'uploadNode', selected,
  position: { x: 0, y: 0 }, data: { imageUrl: `${id}.png`, aspectRatio: '1:1', displayName: id } })

describe('选中画布素材', () => {
  it('只保留选中的、模型允许的、已就绪媒体', () => {
    const nodes = [image('selected'), image('unselected', false),
      { ...image('pending'), data: { ...image('pending').data, isGenerating: true } },
      { ...image('failed'), data: { ...image('failed').data, generationError: 'failed' } },
      { ...image('empty'), data: { imageUrl: '', aspectRatio: '1:1' } },
      { id: 'video', type: 'videoUploadNode', selected: true, position: { x: 0, y: 0 }, data: { videoUrl: 'video.mp4' } },
    ] as CanvasNode[]
    expect(getSelectedCanvasMediaTransfers(nodes, ['image']).map(item => item.nodeId)).toEqual(['selected'])
    expect(getSelectedCanvasMediaTransfers(nodes, [])).toEqual([])
    expect(getSelectedCanvasMediaTransfers(nodes, ['video']).map(item => item.data.imageUrl)).toEqual(['video.mp4'])
    expect(getSelectedCanvasMediaTransfers(nodes.map(node => ({ ...node, selected: false })), ['image'])).toEqual([])
  })

  it('沿发布引用收集全部结果，结果替换改变候选身份，已删除结果不再出现', () => {
    const recipe = { id: 'recipe', type: 'imageNode', selected: true, position: { x: 0, y: 0 }, data: {
      latestExecution: { version: 1, inputSignature: 'canvas-input-v2-test', outputMode: 'result-nodes',
        outputRefs: [{ resultNodeId: 'a', order: 0 }, { resultNodeId: 'b', order: 1 }] },
    } } as CanvasNode
    const nodes = [recipe, image('a', false), image('b', false)]
    const before = getSelectedCanvasMediaTransfers(nodes, ['image'])
    expect(before.map(item => item.data.imageUrl)).toEqual(['a.png', 'b.png'])
    const changed = { ...nodes[1], data: { ...nodes[1].data, imageUrl: 'new.png' } } as CanvasNode
    const after = getSelectedCanvasMediaTransfers([recipe, changed], ['image'])
    expect(after).toHaveLength(1)
    expect(after[0].id).not.toBe(before[0].id)
  })
})
