/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CANVAS_NODE_TYPES, type CanvasNode } from '@/features/canvas/domain/canvasNodes'
import { useCanvasStore } from '@/stores/canvasStore'
import { NodeToolDialogRouter } from './NodeToolDialogRouter'

vi.mock('./NodeToolDialog', () => ({
  NodeToolDialog: () => <div data-testid="standard-tool-dialog" />,
}))

vi.mock('@/features/canvas/imageEditV3/MultiLayerDocumentEditorDialog', () => ({
  MultiLayerDocumentEditorDialog: () => <div data-testid="document-editor-dialog" />,
}))

function editableNode(): CanvasNode {
  const imageUrl = 'henji-media://multi-layer/composite.png'
  return {
    id: 'editable',
    type: CANVAS_NODE_TYPES.layerStackResult,
    position: { x: 0, y: 0 },
    data: {
      resultKind: 'layer-stack',
      imageUrl,
      previewImageUrl: 'henji-media://multi-layer/preview.webp',
      aspectRatio: '1:1',
      imageEditSession: {
        kind: 'image-edit-v3',
        sourceUrl: imageUrl,
        documentRef: 'image-edit-v3:editable',
        revision: 1,
        previewRef: null,
      },
    },
  }
}

describe('NodeToolDialogRouter', () => {
  afterEach(() => cleanup())

  it('editable-v3 图层节点只进入文档编辑宿主', () => {
    const node = editableNode()
    useCanvasStore.setState({
      nodes: [node],
      activeToolDialog: { nodeId: node.id, toolType: 'edit' },
    })

    render(<NodeToolDialogRouter />)

    expect(screen.getByTestId('document-editor-dialog')).toBeTruthy()
    expect(screen.queryByTestId('standard-tool-dialog')).toBeNull()
  })

  it('普通图片和旧 V1 图层节点仍走原工具对话框', () => {
    const node: CanvasNode = {
      id: 'ordinary-image',
      type: CANVAS_NODE_TYPES.upload,
      position: { x: 0, y: 0 },
      data: { imageUrl: '/ordinary.png', aspectRatio: '1:1' },
    }
    useCanvasStore.setState({
      nodes: [node],
      activeToolDialog: { nodeId: node.id, toolType: 'edit' },
    })

    const rendered = render(<NodeToolDialogRouter />)
    expect(screen.getByTestId('standard-tool-dialog')).toBeTruthy()
    expect(screen.queryByTestId('document-editor-dialog')).toBeNull()

    const legacy: CanvasNode = {
      ...editableNode(),
      id: 'legacy-layer-stack',
      data: {
        resultKind: 'layer-stack',
        imageUrl: '/legacy.png',
        previewImageUrl: '/legacy-preview.png',
      },
    }
    useCanvasStore.setState({
      nodes: [legacy],
      activeToolDialog: { nodeId: legacy.id, toolType: 'edit' },
    })
    rendered.rerender(<NodeToolDialogRouter />)

    expect(screen.getByTestId('standard-tool-dialog')).toBeTruthy()
    expect(screen.queryByTestId('document-editor-dialog')).toBeNull()
  })
})
