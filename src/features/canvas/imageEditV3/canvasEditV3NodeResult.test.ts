import { beforeEach, describe, expect, it } from 'vitest'

import { CANVAS_NODE_TYPES, type CanvasNode } from '@/features/canvas/domain/canvasNodes'
import { useCanvasStore } from '@/stores/canvasStore'

const outputUrl = 'henji-media://image-editor-v3/managed-output'
const session = {
  kind: 'image-edit-v3' as const,
  sourceUrl: outputUrl,
  documentRef: 'image-edit-v3:canvas-result' as const,
  revision: 5,
  previewRef: `sha256:${'a'.repeat(64)}` as const,
}

function sourceNode(): CanvasNode {
  return {
    id: 'source-node',
    type: CANVAS_NODE_TYPES.upload,
    position: { x: 0, y: 0 },
    data: { imageUrl: '/source.png', aspectRatio: '1:1' },
  }
}

describe('画布图片编辑 V3 派生结果', () => {
  beforeEach(() => {
    useCanvasStore.getState().setCanvasData([sourceNode()], [])
  })

  it('创建结果节点时在同一次节点写入中保存严格会话引用', () => {
    const beforeHistory = useCanvasStore.getState().history.past.length
    const id = useCanvasStore.getState().addDerivedExportNode(
      'source-node',
      outputUrl,
      '3:2',
      outputUrl,
      {
        resultKind: 'generic',
        imageEditSession: session,
      },
    )

    const state = useCanvasStore.getState()
    const result = state.nodes.find((node) => node.id === id)
    expect(result?.data).toMatchObject({
      imageUrl: outputUrl,
      previewImageUrl: outputUrl,
      imageEditSession: session,
    })
    expect(state.history.past).toHaveLength(beforeHistory + 1)
  })

  it('会话来源与结果媒体不一致时拒绝创建节点', () => {
    expect(() => useCanvasStore.getState().addDerivedExportNode(
      'source-node',
      'henji-media://image-editor-v3/other',
      '3:2',
      undefined,
      { imageEditSession: session },
    )).toThrow('来源与节点图片不一致')
    expect(useCanvasStore.getState().nodes).toHaveLength(1)
  })
})
