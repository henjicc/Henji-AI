import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fork: vi.fn(),
  markReleaseCandidate: vi.fn(),
  rollback: vi.fn(),
}))

vi.mock('./multiLayerDocumentNodeGenerationAdapter', () => ({
  forkMultiLayerDocumentNode: mocks.fork,
  markMultiLayerDocumentReleaseCandidate: mocks.markReleaseCandidate,
  rollbackCreatedMultiLayerDocument: mocks.rollback,
}))

import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore, type Project } from '@/stores/projectStore'
import { CANVAS_NODE_TYPES, type CanvasNode } from '../domain/canvasNodes'
import {
  commitCanvasNodeDuplication,
  deleteCanvasNodes,
  duplicateCanvasNode,
} from './canvasMutationService'
import { redoCanvasChange, undoCanvasChange } from './canvasApplicationService'

const projectId = 'multi-layer-copy-project'
const sourceSession = {
  kind: 'image-edit-v3' as const,
  sourceUrl: '/managed/source.png',
  documentRef: 'image-edit-v3:source-document' as const,
  revision: 2,
  previewRef: `sha256:${'a'.repeat(64)}` as const,
}
const forkedProjection = {
  imageUrl: '/managed/fork.png',
  previewImageUrl: '/managed/fork.png',
  aspectRatio: '4:3',
  imageEditSession: {
    ...sourceSession,
    sourceUrl: '/managed/fork.png',
    documentRef: 'image-edit-v3:fork-document' as const,
  },
}

function sourceNode(): CanvasNode {
  return {
    id: 'source-node',
    type: CANVAS_NODE_TYPES.layerStackResult,
    position: { x: 0, y: 0 },
    data: {
      resultKind: 'layer-stack',
      imageUrl: sourceSession.sourceUrl,
      previewImageUrl: sourceSession.sourceUrl,
      aspectRatio: '4:3',
      imageEditSession: sourceSession,
    },
  } as CanvasNode
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.fork.mockResolvedValue(forkedProjection)
  mocks.rollback.mockResolvedValue(true)
  const source = sourceNode()
  const project: Project = {
    id: projectId,
    name: '复制测试',
    createdAt: 1,
    updatedAt: 1,
    nodeCount: 1,
    coverPath: null,
    nodes: [source],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    history: { past: [], future: [] },
  }
  useCanvasStore.getState().setCanvasData([source], [], project.history)
  useCanvasStore.setState({ currentViewport: project.viewport, canvasViewportSize: { width: 1200, height: 800 } })
  useProjectStore.setState({
    projects: [project],
    currentProjectId: projectId,
    currentProject: project,
    isHydrated: true,
    isOpeningProject: false,
    saveCurrentProject: vi.fn(),
  })
})

describe('多图层文档节点复制事务', () => {
  it('副本获得独立 documentRef，源节点保持不变', async () => {
    const result = await duplicateCanvasNode({
      projectId,
      nodeId: 'source-node',
      placement: { mode: 'right_of_node', anchorNodeId: 'source-node' },
    })
    const source = useCanvasStore.getState().nodes.find((node) => node.id === 'source-node')
    const copied = useCanvasStore.getState().nodes.find((node) => node.id === result.nodeId)
    expect(source?.data.imageEditSession).toMatchObject({ documentRef: sourceSession.documentRef })
    expect(copied?.data.imageEditSession).toMatchObject({ documentRef: 'image-edit-v3:fork-document' })
    expect(mocks.fork).toHaveBeenCalledOnce()
  })

  it('fork 成功但副本节点未接管时精确补偿新文档', async () => {
    await expect(commitCanvasNodeDuplication({
      projectId,
      sourceNodeId: 'source-node',
      data: sourceNode().data,
      createNode: () => { throw new Error('canvas write failed') },
    })).rejects.toThrow('canvas write failed')
    expect(mocks.rollback).toHaveBeenCalledWith(forkedProjection)
    expect(useCanvasStore.getState().nodes).toHaveLength(1)
  })

  it('删除只登记候选，撤销与重做继续保留画布历史语义', async () => {
    const deleted = deleteCanvasNodes(projectId, ['source-node'])
    expect(useCanvasStore.getState().nodes).toHaveLength(0)
    expect(useCanvasStore.getState().history.past.at(-1)?.nodes[0]?.id).toBe('source-node')
    await vi.waitFor(() => expect(mocks.markReleaseCandidate).toHaveBeenCalledOnce())

    undoCanvasChange(projectId, String(deleted.undoRef))
    expect(useCanvasStore.getState().nodes[0]?.id).toBe('source-node')
    redoCanvasChange(projectId)
    expect(useCanvasStore.getState().nodes).toHaveLength(0)
    expect(useCanvasStore.getState().history.past.at(-1)?.nodes[0]?.id).toBe('source-node')
  })
})
