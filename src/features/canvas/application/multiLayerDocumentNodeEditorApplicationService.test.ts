// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useCanvasStore } from '@/stores/canvasStore'

import { CANVAS_NODE_TYPES, type CanvasNode } from '../domain/canvasNodes'
import { CanvasApplicationError } from './canvasApplicationService'
import { openMultiLayerDocumentNodeEditor } from './multiLayerDocumentNodeEditorApplicationService'

function editableNode(id = 'document-node'): CanvasNode {
  const imageUrl = 'henji-media://multi-layer/composite.png'
  return {
    id,
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
        documentRef: `image-edit-v3:${id}`,
        revision: 1,
        previewRef: null,
      },
    },
  }
}

function input(nodeId = 'document-node') {
  return {
    projectRef: { kind: 'canvas.project' as const, id: 'project-a' },
    nodeRef: { kind: 'canvas.node' as const, id: `project-a:${nodeId}` },
  }
}

function dependencies(order: string[] = []) {
  return {
    openProject: vi.fn(async () => { order.push('project') }) as never,
    openSurface: vi.fn(() => {
      order.push('surface')
      return { surfaceId: 'workspace.canvas', status: 'opened', navigationRevision: 1 }
    }) as never,
    focusNode: vi.fn(async () => {
      order.push('focus')
      return { focused: true }
    }) as never,
    validateDocument: vi.fn(async ({ data }) => {
      order.push('validate')
      return data.imageEditSession
    }) as never,
  }
}

describe('openMultiLayerDocumentNodeEditor', () => {
  beforeEach(() => {
    useCanvasStore.setState({ nodes: [], activeToolDialog: null })
  })

  it('按工程、Surface、节点定位和权威文档校验顺序打开节点自己的编辑器', async () => {
    const order: string[] = []
    useCanvasStore.setState({ nodes: [editableNode()] })

    const result = await openMultiLayerDocumentNodeEditor(input(), dependencies(order))

    expect(order).toEqual(['project', 'surface', 'focus', 'validate'])
    expect(useCanvasStore.getState().activeToolDialog).toEqual({
      nodeId: 'document-node',
      toolType: 'edit',
    })
    expect(result).toMatchObject({
      surfaceId: 'workspace.canvas',
      editorKind: 'multi_layer_document',
      status: 'opened',
      nodeRef: { kind: 'canvas.node', id: 'project-a:document-node' },
    })
    expect(result.resultRefs).toEqual([
      { kind: 'canvas.project', id: 'project-a' },
      { kind: 'canvas.node', id: 'project-a:document-node' },
      { kind: 'application.surface', id: 'workspace.canvas' },
    ])
  })

  it('重复打开同一文档保持幂等，不替换为工具箱图片编辑器', async () => {
    const validateDocument = vi.fn(async () => {
      throw new CanvasApplicationError('CONFLICT', '节点会话 revision 已被实时保存推进')
    })
    useCanvasStore.setState({
      nodes: [editableNode()],
      activeToolDialog: { nodeId: 'document-node', toolType: 'edit' },
    })

    const result = await openMultiLayerDocumentNodeEditor(input(), {
      ...dependencies(),
      validateDocument: validateDocument as never,
    })

    expect(result.status).toBe('already_open')
    expect(validateDocument).not.toHaveBeenCalled()
    expect(useCanvasStore.getState().activeToolDialog).toEqual({
      nodeId: 'document-node',
      toolType: 'edit',
    })
  })

  it('普通节点拒绝时返回实际类型和当前可打开的稳定引用', async () => {
    useCanvasStore.setState({
      nodes: [
        {
          id: 'ordinary-image',
          type: CANVAS_NODE_TYPES.upload,
          position: { x: 0, y: 0 },
          data: { imageUrl: '/ordinary.png' },
        },
        editableNode('available-document'),
      ],
    })

    const operation = openMultiLayerDocumentNodeEditor(
      input('ordinary-image'),
      dependencies(),
    )

    await expect(operation).rejects.toMatchObject({
      code: 'CAPABILITY_REJECTED',
      details: {
        actualNodeType: CANVAS_NODE_TYPES.upload,
        editableNodeRefs: ['project-a:available-document'],
      },
    })
    await expect(operation).rejects.toThrow('project-a:available-document')
    expect(useCanvasStore.getState().activeToolDialog).toBeNull()
  })

  it('项目与节点引用不匹配时在任何导航前拒绝并给出改道提示', async () => {
    const calls = dependencies()

    await expect(openMultiLayerDocumentNodeEditor({
      projectRef: { kind: 'canvas.project', id: 'project-a' },
      nodeRef: { kind: 'canvas.node', id: 'project-b:document-node' },
    }, calls)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringContaining('请重新读取该项目的节点引用'),
    } satisfies Partial<CanvasApplicationError>)
    expect(calls.openProject).not.toHaveBeenCalled()
  })

  it.each([
    ['裸节点 ID', 'document-node'],
    ['缺少节点 ID 的截断引用', 'project-a:'],
  ])('%s 在任何导航前以 INVALID_INPUT 拒绝', async (_caseName, nodeRefId) => {
    const calls = dependencies()

    await expect(openMultiLayerDocumentNodeEditor({
      projectRef: { kind: 'canvas.project', id: 'project-a' },
      nodeRef: { kind: 'canvas.node', id: nodeRefId },
    }, calls)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      recoverable: true,
      message: expect.stringContaining('project-a:<nodeId>'),
      details: { expectedNodeRefFormat: 'project-a:<nodeId>' },
    } satisfies Partial<CanvasApplicationError>)
    expect(calls.openProject).not.toHaveBeenCalled()
    expect(calls.openSurface).not.toHaveBeenCalled()
    expect(calls.focusNode).not.toHaveBeenCalled()
  })
})
