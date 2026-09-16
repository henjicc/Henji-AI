/** @vitest-environment jsdom */
import '@/tests/canvasProjectFixture'

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CANVAS_NODE_TYPES, type CanvasNode } from '@/features/canvas/domain/canvasNodes'
import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore } from '@/stores/projectStore'
import { NodeToolDialogRouter } from './NodeToolDialogRouter'
import { attachCanvasProject, registerCanvasProjectInstance, requireCanvasProjectInstance } from '@/features/canvas/application/canvasProjectInstances'

const routerMocks = vi.hoisted(() => ({
  saveAfterEditing: vi.fn(),
  documentDialogProps: null as Record<string, unknown> | null,
}))

vi.mock('@/features/canvas/application/multiLayerDocumentNodeGenerationAdapter', () => ({
  saveMultiLayerDocumentAfterEditing: routerMocks.saveAfterEditing,
}))

vi.mock('./NodeToolDialog', () => ({
  NodeToolDialog: () => <div data-testid="standard-tool-dialog" />,
}))

vi.mock('@/features/canvas/imageEditV3/MultiLayerDocumentEditorDialog', () => ({
  MultiLayerDocumentEditorDialog: (props: Record<string, unknown>) => {
    routerMocks.documentDialogProps = props
    return <div data-testid="document-editor-dialog" />
  },
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

function attachProject(id: string) {
  const instance = registerCanvasProjectInstance({ id, name: id, createdAt: 1, updatedAt: 1,
    nodeCount: 0, coverPath: null, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 },
    history: { past: [], future: [] } })
  attachCanvasProject(instance)
  useProjectStore.setState({ currentProjectId: id, currentProject: instance.snapshot() })
}

describe('NodeToolDialogRouter', () => {
  afterEach(() => {
    cleanup()
    routerMocks.saveAfterEditing.mockReset()
    routerMocks.documentDialogProps = null
    useProjectStore.setState({ currentProjectId: null, currentProject: null })
  })

  it('editable-v3 图层节点只进入文档编辑宿主', () => {
    const node = editableNode()
    attachProject('project-a')
    useCanvasStore.setState({
      nodes: [node],
      activeToolDialog: { nodeId: node.id, toolType: 'edit' },
    })

    render(<NodeToolDialogRouter />)

    expect(screen.getByTestId('document-editor-dialog')).toBeTruthy()
    expect(screen.queryByTestId('standard-tool-dialog')).toBeNull()
  })

  it('同工程关闭把 flush 精确会话和权威节点交给唯一应用服务', async () => {
    const node = editableNode()
    attachProject('project-a')
    useCanvasStore.setState({
      nodes: [node],
      activeToolDialog: { nodeId: node.id, toolType: 'edit' },
    })
    render(<NodeToolDialogRouter />)
    const onCloseReady = routerMocks.documentDialogProps?.onCloseReady as (
      result: { nodeId: string; session: Record<string, unknown> }
    ) => Promise<void>
    const flushedSession = {
      ...node.data.imageEditSession,
      revision: 2,
      sourceUrl: 'henji-media://multi-layer/updated.png',
    }

    useCanvasStore.setState({
      nodes: [{ ...node, position: { x: 120, y: 80 } }],
    })
    routerMocks.saveAfterEditing.mockResolvedValueOnce({ imageEditSession: flushedSession })
    await act(() => onCloseReady({ nodeId: node.id, session: flushedSession }))

    expect(routerMocks.saveAfterEditing).toHaveBeenCalledWith({
      projectId: 'project-a',
      nodeId: node.id,
      documentRef: node.data.imageEditSession?.documentRef,
      data: node.data,
      session: flushedSession,
    }, expect.objectContaining({ store: requireCanvasProjectInstance('project-a').store }))
  })

  it('切换工程后关闭回调仍保存原工程，当前工程与页面保持不变', async () => {
    const node = editableNode()
    attachProject('project-a')
    useCanvasStore.setState({ nodes: [node], activeToolDialog: { nodeId: node.id, toolType: 'edit' } })
    render(<NodeToolDialogRouter />)
    const onCloseReady = routerMocks.documentDialogProps?.onCloseReady as (
      result: { nodeId: string; session: Record<string, unknown> }
    ) => Promise<void>
    const flushedSession = { ...node.data.imageEditSession, revision: 2 }
    await act(async () => { attachProject('project-b') })
    const backgroundStore = requireCanvasProjectInstance('project-a').store
    routerMocks.saveAfterEditing.mockResolvedValueOnce({ imageEditSession: flushedSession })
    await act(() => onCloseReady({ nodeId: node.id, session: flushedSession }))
    expect(routerMocks.saveAfterEditing).toHaveBeenCalledTimes(1)
    expect(routerMocks.saveAfterEditing).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'project-a', session: flushedSession }),
      expect.objectContaining({ store: backgroundStore }),
    )
    expect(useProjectStore.getState().currentProjectId).toBe('project-b')
    expect(useCanvasStore.getState().nodes).toEqual([])
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
