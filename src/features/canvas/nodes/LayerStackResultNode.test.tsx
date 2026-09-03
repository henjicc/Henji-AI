/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { canvasEventBus } from '@/features/canvas/application/canvasServices'
import type { LayerStackResultNodeData } from '@/features/canvas/domain/canvasNodes'
import { useCanvasStore } from '@/stores/canvasStore'
import { LayerStackResultNode } from './LayerStackResultNode'

const imageUrl = 'henji-media://multi-layer/composite.png'

function data(): LayerStackResultNodeData {
  return {
    resultKind: 'layer-stack',
    imageUrl,
    previewImageUrl: 'henji-media://multi-layer/preview.webp',
    aspectRatio: '2:1',
    imageEditSession: {
      kind: 'image-edit-v3',
      sourceUrl: imageUrl,
      documentRef: 'image-edit-v3:multi-layer-document',
      revision: 3,
      previewRef: null,
    },
  }
}

function renderNode(): ReturnType<typeof render> {
  return render(
    <ReactFlowProvider>
      <LayerStackResultNode
        id="multi-layer-node"
        type="layerStackResultNode"
        data={data()}
        selected={false}
        draggable
        selectable
        deletable
        dragging={false}
        zIndex={0}
        isConnectable
        positionAbsoluteX={0}
        positionAbsoluteY={0}
      />
    </ReactFlowProvider>,
  )
}

describe('LayerStackResultNode V3 编辑入口', () => {
  beforeEach(() => {
    useCanvasStore.setState({ selectedNodeId: null, edges: [] })
  })

  afterEach(() => cleanup())

  it('单击只选择节点，不打开编辑器', () => {
    const opened: unknown[] = []
    const unsubscribe = canvasEventBus.subscribe('tool-dialog/open', (payload) => opened.push(payload))
    renderNode()

    fireEvent.click(document.querySelector('[data-layer-stack-node-id="multi-layer-node"]') as Element)

    expect(useCanvasStore.getState().selectedNodeId).toBe('multi-layer-node')
    expect(opened).toHaveLength(0)
    unsubscribe()
  })

  it('双击和明确编辑动作都打开完整图片编辑工具', () => {
    const opened: unknown[] = []
    const unsubscribe = canvasEventBus.subscribe('tool-dialog/open', (payload) => opened.push(payload))
    renderNode()
    const node = document.querySelector('[data-layer-stack-node-id="multi-layer-node"]') as Element

    fireEvent.doubleClick(node)
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))

    expect(opened).toEqual([
      { nodeId: 'multi-layer-node', toolType: 'edit' },
      { nodeId: 'multi-layer-node', toolType: 'edit' },
    ])
    unsubscribe()
  })
})
