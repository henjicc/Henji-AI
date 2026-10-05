// @vitest-environment jsdom
import { canvasTestRegistry, seedCanvasTestProject } from '@/tests/canvasProjectFixture'
import { describe, expect, it } from 'vitest'

import { canvasDocumentKind } from '@/core/documents/kinds/canvas'
import { CANVAS_NODE_TYPES, type CanvasNode } from '../domain/canvasNodes'
import { useProjectStore } from '@/stores/projectStore'
import { canvasFromDocumentContent, canvasHistoryForSessionState, canvasHistoryFromSessionState, canvasToDocumentContent } from './canvasDocumentContent'
import { findCanvasProjectInstance, getCanvasProjectInstance } from './canvasProjectInstances'

function renderingCameraStageNode(): CanvasNode {
  return {
    id: 'camera-stage-node', type: CANVAS_NODE_TYPES.cameraStage, position: { x: 0, y: 0 },
    data: {
      displayName: '3D 镜头参考', projectId: 'camera-project', imageUrl: null, videoUrl: 'henji-media://completed.mp4',
      aspectRatio: '16:9', durationSec: 5.2, selectedTimeSec: 0, outputKind: 'video', videoExporting: true,
      videoProgress: 0.42, videoRenderPhase: 'rendering', videoRenderRequestId: 'stale-request', videoRenderError: 'stale-error',
    },
  }
}

describe('画布文档内容换算', () => {
  it('写入文档与撤销记录时清掉瞬时渲染状态，不改内存里的节点', () => {
    const node = renderingCameraStageNode()
    const content = canvasToDocumentContent({ nodes: [node], edges: [] })
    const history = canvasHistoryForSessionState({ past: [{ nodes: [node], edges: [] }], future: [] })
    for (const data of [content.nodes[0].data, history.past[0].nodes[0].data]) {
      expect(data).toMatchObject({ videoExporting: false, videoProgress: null, videoRenderPhase: null,
        videoRenderRequestId: null, videoRenderError: null, videoUrl: 'henji-media://completed.mp4' })
    }
    expect(node.data.videoExporting).toBe(true)
  })

  it('结构化提示词、媒体输入与 binding 以绝对路径原样往返（换成相对写法由主进程整份完成）', () => {
    const mediaPath = '/media/prompt-reference.png'
    const node = { id: 'generation-node', type: CANVAS_NODE_TYPES.imageEdit, position: { x: 0, y: 0 }, data: {
      imageUrl: null, aspectRatio: '1:1', prompt: '参考@图片1', mediaInputs: { image: [mediaPath] },
      promptMediaBindings: [{ resourceId: 'canvas-local:generation-node:media-1', mediaType: 'image', dataUrl: mediaPath, filePath: mediaPath }],
    } } as CanvasNode
    const content = canvasToDocumentContent({ nodes: [node], edges: [] })
    expect(JSON.stringify(content)).not.toContain('__img_ref__')
    const restored = canvasFromDocumentContent(JSON.parse(JSON.stringify(content)))
    expect(restored.nodes[0].data.mediaInputs).toEqual({ image: [mediaPath] })
    expect(restored.nodes[0].data.promptMediaBindings).toEqual([expect.objectContaining({ dataUrl: mediaPath, filePath: mediaPath })])
  })

  it('完整保留 3D 输出结果的不可变请求回执', () => {
    const receipt = { version: 1, requestId: 'request-1', canvasProjectId: 'canvas-1', nodeId: 'camera-stage-node',
      cameraStageDocumentId: 'camera-project-1', resolutionPreset: '1080p', outputKind: 'image', selectedTimeSec: 1.25 }
    const node = { id: 'camera-result', type: CANVAS_NODE_TYPES.exportImage, position: { x: 0, y: 0 },
      data: { imageUrl: 'D:/work/result.png', aspectRatio: '16:9', cameraStageRenderReceipt: receipt } } as CanvasNode
    expect(canvasFromDocumentContent(canvasToDocumentContent({ nodes: [node], edges: [] })).nodes[0].data.cameraStageRenderReceipt).toEqual(receipt)
  })

  it('缺失模型的不透明参数保留原媒体池，池索引不重新编号', () => {
    const node = { id: 'n', type: 'generator', position: { x: 0, y: 0 },
      data: { modelId: 'retired-model', params: { image: '__img_ref__:1' } } } as unknown as CanvasNode
    const content = canvasToDocumentContent({ nodes: [node], edges: [], imagePool: ['/a.png', '/b.png'] })
    expect(content.imagePool).toEqual(['/a.png', '/b.png'])
    const restored = canvasFromDocumentContent(content)
    expect(restored.nodes[0].data).toEqual({ modelId: 'retired-model', params: { image: '__img_ref__:1' } })
    expect(restored.imagePool).toEqual(['/a.png', '/b.png'])
    expect(canvasToDocumentContent({ nodes: [], edges: [], imagePool: ['/a.png'] })).not.toHaveProperty('imagePool')
  })

  it('类型登记：空画布、摘要与未知字段保留', () => {
    const empty = canvasDocumentKind.createEmptyContent()
    expect(canvasDocumentKind.isEmptyContent(empty)).toBe(true)
    const parsed = canvasDocumentKind.contentSchema.parse({ nodes: [{ id: 'a', type: 't', position: { x: 0, y: 0 }, data: {}, width: 300 }], edges: [], future: 1 })
    expect(canvasDocumentKind.isEmptyContent(parsed)).toBe(false)
    expect(canvasDocumentKind.summarize(parsed)).toEqual({ nodes: 1 })
    expect(parsed.nodes[0]).toHaveProperty('width', 300)
    expect(parsed).toHaveProperty('future', 1)
  })

  it('读不懂的撤销记录直接丢弃，不影响打开', () => {
    expect(canvasHistoryFromSessionState({ past: [{ nodes: [{ id: 'x' }], edges: [] }], future: [] })).toBeNull()
    expect(canvasHistoryFromSessionState('broken')).toBeNull()
  })
})

describe('损坏画布不得替换当前画布或留下会话', () => {
  it('打开节点图不合法的画布失败：保留当前画布，原文件不动，不留没附着的会话', async () => {
    seedCanvasTestProject({ id: 'valid', name: '有效', nodes: [], edges: [] })
    expect(await useProjectStore.getState().openCanvasDocument({ id: 'valid' })).toBe(true)
    const { commands, registry } = canvasTestRegistry()
    commands.seed({ kind: 'canvas', id: 'broken', name: '损坏', content: { nodes: [{ id: 'n', type: 't', position: { x: 0, y: 0 }, data: {} }], edges: [{ id: 'e', source: 'n', target: 'missing' }] } })
    const before = structuredClone(commands.stored('broken')!.content)
    await expect(useProjectStore.getState().openCanvasDocument({ id: 'broken' })).rejects.toThrow()
    expect(useProjectStore.getState()).toMatchObject({ currentProjectId: 'valid', openError: 'project.openFailed' })
    expect(commands.stored('broken')!.content).toEqual(before)
    expect(registry.get('broken')).toBeUndefined()
    await expect(getCanvasProjectInstance('broken')).rejects.toThrow()
    expect(findCanvasProjectInstance('broken')).toBeUndefined()
  })
})
