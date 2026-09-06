import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore } from '@/stores/projectStore'
import { CANVAS_NODE_TYPES, type CanvasNode } from '../domain/canvasNodes'
import { createMultiLayerDocumentPersistenceConfirmation } from './multiLayerDocumentPersistenceConfirmation'

const session = { kind: 'image-edit-v3' as const, sourceUrl: 'image.png',
  documentRef: 'image-edit-v3:saved-document' as const, revision: 1, previewRef: null }
const node: CanvasNode = { id: 'original', type: CANVAS_NODE_TYPES.layerStackResult,
  position: { x: 0, y: 0 }, data: { resultKind: 'layer-stack', imageUrl: 'image.png',
    previewImageUrl: 'image.png', imageEditSession: session } }
const originalCanvas = useCanvasStore.getState()
const originalProject = useProjectStore.getState()
afterEach(() => {
  useCanvasStore.setState(originalCanvas)
  useProjectStore.setState(originalProject)
})

describe('图片编辑结果只能同步回原文档节点', () => {
  it.each(['deleted', 'replaced', 'project-switched'] as const)('%s 时保留保存结果，拒绝覆盖；恢复关联后可重试', async (failure) => {
    useProjectStore.setState({ currentProjectId: 'project' })
    const saveProjection = vi.fn(async () => ({ imageEditSession: session,
      imageUrl: 'preview.png', previewImageUrl: 'preview.png', aspectRatio: '1:1' }))
    const confirmation = createMultiLayerDocumentPersistenceConfirmation({
      projectId: 'project', nodeId: 'original', documentRef: session.documentRef,
    }, { saveProjection })
    const changed = { ...node, data: { ...node.data, imageEditSession: {
      ...session, documentRef: 'image-edit-v3:other-document' as const,
    } } }
    useCanvasStore.setState({ nodes: failure === 'deleted' ? [] : [failure === 'replaced' ? changed : node] })
    if (failure === 'project-switched') useProjectStore.setState({ currentProjectId: 'other' })
    const before = useCanvasStore.getState().nodes
    await expect(confirmation.confirm(session)).rejects.toMatchObject({
      code: 'NODE_TARGET_CHANGED', message: expect.stringContaining('恢复原节点及其文档关联后重试同步'),
    })
    expect(saveProjection).not.toHaveBeenCalled()
    expect(useCanvasStore.getState().nodes).toBe(before)
    useProjectStore.setState({ currentProjectId: 'project' })
    useCanvasStore.setState({ nodes: [node] })
    await expect(confirmation.confirm(session)).resolves.toMatchObject({ reference: { documentId: 'saved-document', revision: 1 } })
    expect(saveProjection).toHaveBeenCalledOnce()
    expect(saveProjection).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 'original', session }))
  })
})
