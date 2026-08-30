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

  it('生成配方通过最近成功结果节点引用向下游发布媒体', () => {
    const nodes = [
      {
        id: 'generation-1',
        type: CANVAS_NODE_TYPES.imageEdit,
        position: { x: 0, y: 0 },
        data: {
          prompt: '猫',
          latestExecution: {
            version: 1,
            inputSignature: 'canvas-input-v2-test',
            outputMode: 'result-nodes',
            outputRefs: [{ resultNodeId: 'result-1', order: 0 }],
          },
        },
      },
      {
        id: 'result-1',
        type: CANVAS_NODE_TYPES.exportImage,
        position: { x: 100, y: 0 },
        data: { imageUrl: 'generated.png', aspectRatio: '1:1', isGenerating: false },
      },
      {
        id: 'generation-2',
        type: CANVAS_NODE_TYPES.imageEdit,
        position: { x: 200, y: 0 },
        data: { prompt: '动画化' },
      },
    ] as CanvasNode[]
    const edges = [{
      id: 'edge-generation-chain',
      source: 'generation-1',
      target: 'generation-2',
      sourceHandle: 'source',
      targetHandle: 'param:__image',
    }] as CanvasEdge[]

    expect(collectInputMedia('generation-2', nodes, edges)).toEqual([
      expect.objectContaining({
        sourceNodeId: 'generation-1',
        sourceHandle: 'source',
        outputIndex: 0,
        url: 'generated.png',
      }),
    ])
  })

  it('不会把生成中或失败的结果引用当成可消费输出', () => {
    const producer = {
      id: 'generation-1',
      type: CANVAS_NODE_TYPES.imageEdit,
      position: { x: 0, y: 0 },
      data: {
        prompt: '猫',
        latestExecution: {
          version: 1,
          inputSignature: 'canvas-input-v2-test',
          outputMode: 'result-nodes',
          outputRefs: [{ resultNodeId: 'result-1', order: 0 }],
        },
      },
    } as CanvasNode
    const target = {
      id: 'target',
      type: CANVAS_NODE_TYPES.imageEdit,
      position: { x: 200, y: 0 },
      data: { prompt: '' },
    } as CanvasNode
    const edges = [{
      id: 'edge-1',
      source: producer.id,
      target: target.id,
      sourceHandle: 'source',
      targetHandle: 'param:__image',
    }] as CanvasEdge[]
    const resultData = { imageUrl: 'stale.png', aspectRatio: '1:1' }

    expect(collectInputMedia(target.id, [
      producer,
      target,
      { id: 'result-1', type: CANVAS_NODE_TYPES.exportImage, position: { x: 0, y: 0 }, data: {
        ...resultData,
        isGenerating: true,
      } } as CanvasNode,
    ], edges)).toEqual([])
    expect(collectInputMedia(target.id, [
      producer,
      target,
      { id: 'result-1', type: CANVAS_NODE_TYPES.exportImage, position: { x: 0, y: 0 }, data: {
        ...resultData,
        generationError: '失败',
      } } as CanvasNode,
    ], edges)).toEqual([])
  })

  it('发布引用失效时不回退配方节点上的旧媒体', () => {
    const producer = {
      id: 'generation-1',
      type: CANVAS_NODE_TYPES.imageEdit,
      position: { x: 0, y: 0 },
      data: {
        imageUrl: 'legacy-stale.png',
        latestExecution: {
          version: 1,
          inputSignature: 'canvas-input-v2-test',
          outputMode: 'result-nodes',
          outputRefs: [{
            resultNodeId: 'result-1',
            completionId: 'commit-current',
            outputId: 'output-1',
            order: 0,
          }],
        },
      },
    } as CanvasNode
    const result = {
      id: 'result-1',
      type: CANVAS_NODE_TYPES.exportImage,
      position: { x: 100, y: 0 },
      data: {
        imageUrl: 'other-output.png',
        generationSourceNodeId: producer.id,
        generationOutputCommitId: 'commit-replaced',
        generationOutputDescriptor: { outputId: 'output-1', order: 0 },
      },
    } as CanvasNode
    const target = {
      id: 'target',
      type: CANVAS_NODE_TYPES.imageEdit,
      position: { x: 200, y: 0 },
      data: { prompt: '' },
    } as CanvasNode
    const edges = [{
      id: 'edge-1',
      source: producer.id,
      target: target.id,
      sourceHandle: 'source',
      targetHandle: 'param:__image',
    }] as CanvasEdge[]

    expect(collectInputMedia(target.id, [producer, result, target], edges)).toEqual([])
  })
})
