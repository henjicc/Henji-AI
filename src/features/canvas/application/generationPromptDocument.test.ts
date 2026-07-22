import { describe, expect, it } from 'vitest'

import { toModelPromptText } from '@/core/inputs/promptDocument'
import {
  rebaseCanvasLocalPromptData,
  resolveCanvasGenerationPrompt,
} from './generationPromptDocument'

describe('resolveCanvasGenerationPrompt', () => {
  it('旧字符串升级为本地媒体 atom，重排后按稳定 ID 更新显示序号', () => {
    let sequence = 0
    const createResourceId = (nodeId: string): string => `canvas-local:${nodeId}:test-${++sequence}`
    const first = resolveCanvasGenerationPrompt({
      nodeId: 'node-a',
      legacyText: '参考图片1然后修改',
      mediaInputs: { image: ['C:\\media\\a.png', 'C:\\media\\b.png'] },
      incomingMedia: [],
      acceptedMediaKinds: ['image'],
    }, createResourceId)

    expect(first.references.map((item) => item.resourceId)).toEqual([
      'canvas-local:node-a:test-1',
      'canvas-local:node-a:test-2',
    ])
    expect(toModelPromptText(first.document, { references: first.references }))
      .toBe('参考 图片1 然后修改')

    const reordered = resolveCanvasGenerationPrompt({
      nodeId: 'node-a',
      document: first.document,
      legacyText: first.legacyText,
      bindings: first.bindings,
      mediaInputs: { image: ['C:\\media\\b.png', 'C:\\media\\a.png'] },
      incomingMedia: [],
      acceptedMediaKinds: ['image'],
    }, createResourceId)

    expect(reordered.references.map((item) => item.resourceId)).toEqual([
      'canvas-local:node-a:test-2',
      'canvas-local:node-a:test-1',
    ])
    expect(reordered.legacyText).toBe('参考@图片2然后修改')
    expect(sequence).toBe(2)
  })

  it('上游输出使用来源节点、端口和输出序号构造稳定引用', () => {
    const resolved = resolveCanvasGenerationPrompt({
      nodeId: 'target-node',
      legacyText: '@视频1作为节奏参考',
      mediaInputs: {},
      incomingMedia: [{
        kind: 'video',
        url: 'C:\\media\\clip.mp4',
        sourceNodeId: 'source-node',
        sourceHandle: 'clip',
        outputIndex: 2,
      }],
      acceptedMediaKinds: ['video'],
    })

    expect(resolved.references[0]).toMatchObject({
      resourceId: 'canvas-output:source-node:clip:2',
      sourceNodeId: 'source-node',
      label: '视频1',
    })
    expect(resolved.bindings).toEqual([])
  })
})

describe('rebaseCanvasLocalPromptData', () => {
  it('复制节点时同步改写 binding 与文档 atom 的本地资源 ID', () => {
    const patch = rebaseCanvasLocalPromptData({
      promptMediaBindings: [{
        resourceId: 'canvas-local:source-node:media-1',
        mediaType: 'image',
        dataUrl: 'C:\\media\\a.png',
      }],
      promptDocument: {
        version: 1,
        type: 'doc',
        content: [{
          type: 'paragraph',
          content: [{
            type: 'mediaReference',
            attrs: {
              resourceId: 'canvas-local:source-node:media-1',
              mediaType: 'image',
              fallbackLabel: '图片1',
            },
          }],
        }],
      },
    }, 'source-node', 'copy-node')

    expect(patch?.promptMediaBindings).toEqual([expect.objectContaining({
      resourceId: 'canvas-local:copy-node:media-1',
    })])
    expect(JSON.stringify(patch?.promptDocument)).toContain('canvas-local:copy-node:media-1')
    expect(JSON.stringify(patch?.promptDocument)).not.toContain('canvas-local:source-node:media-1')
  })
})
