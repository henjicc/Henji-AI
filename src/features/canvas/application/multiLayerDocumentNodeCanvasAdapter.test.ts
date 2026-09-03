import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CANVAS_NODE_TYPES, type CanvasNode } from '../domain/canvasNodes'
import { getNodeMediaOutputs } from '../domain/nodeRegistry'
import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore, type Project } from '@/stores/projectStore'
import { MULTI_LAYER_NODE_PROJECTION_HISTORY_POLICY } from './multiLayerDocumentNodeApplicationContracts'
import { createMultiLayerDocumentProjectionCanvasPort } from './multiLayerDocumentNodeCanvasAdapter'

const mocks = vi.hoisted(() => ({ persist: vi.fn() }))

vi.mock('./canvasApplicationService', () => ({ persistCanvasState: mocks.persist }))

const oldSession = {
  kind: 'image-edit-v3' as const,
  sourceUrl: '/managed/old-composite.png',
  documentRef: 'image-edit-v3:canvas-document' as const,
  revision: 2,
  previewRef: `sha256:${'a'.repeat(64)}` as const,
}

const newImageUrl = `henji-media://image-editor-v3/${'b'.repeat(64)}?mediaType=image%2Fpng`
const projection = {
  imageUrl: newImageUrl,
  previewImageUrl: newImageUrl,
  aspectRatio: '3:2',
  imageEditSession: {
    kind: 'image-edit-v3' as const,
    sourceUrl: newImageUrl,
    documentRef: oldSession.documentRef,
    revision: 3,
    previewRef: `sha256:${'b'.repeat(64)}` as const,
  },
}

function node(): CanvasNode {
  return {
    id: 'document-node',
    type: CANVAS_NODE_TYPES.layerStackResult,
    position: { x: 120, y: 80 },
    width: 420,
    height: 260,
    data: {
      resultKind: 'layer-stack',
      imageUrl: oldSession.sourceUrl,
      previewImageUrl: '/managed/old-preview.webp',
      aspectRatio: '4:3',
      imageEditSession: oldSession,
    },
  }
}

function project(nodes: CanvasNode[]): Project {
  return {
    id: 'project-a',
    name: '测试项目',
    createdAt: 1,
    updatedAt: 1,
    nodeCount: nodes.length,
    coverPath: null,
    nodes,
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    history: { past: [], future: [] },
  }
}

function commitInput() {
  return {
    projectId: 'project-a',
    nodeId: 'document-node',
    expectedSession: oldSession,
    projection,
    historyPolicy: MULTI_LAYER_NODE_PROJECTION_HISTORY_POLICY,
  }
}

describe('多图层文档节点投影 CAS', () => {
  beforeEach(() => {
    mocks.persist.mockReset()
    const source = node()
    useCanvasStore.setState({
      nodes: [source],
      edges: [{ id: 'edge-a', source: source.id, target: 'downstream' }],
      history: { past: [{ nodes: [source], edges: [] }], future: [] },
      selectedNodeId: source.id,
      activeToolDialog: { nodeId: source.id, toolType: 'edit' },
    })
    useProjectStore.setState({
      currentProjectId: 'project-a',
      currentProject: project([source]),
    })
  })

  it('一次提交会话、预览与比例，保持节点身份、位置、连线和画布历史不变', async () => {
    const release = vi.fn(async () => undefined)
    const port = createMultiLayerDocumentProjectionCanvasPort({ releaseReplacedLocalImages: release })
    const before = useCanvasStore.getState()
    const beforeNode = before.nodes[0]
    const beforeEdges = before.edges
    const beforeHistory = before.history

    await port.commitMaterializedProjection(commitInput())

    const after = useCanvasStore.getState()
    const updated = after.nodes[0]
    expect(updated).toMatchObject({
      id: beforeNode.id,
      position: beforeNode.position,
      width: beforeNode.width,
      height: beforeNode.height,
      data: {
        imageUrl: newImageUrl,
        previewImageUrl: newImageUrl,
        aspectRatio: '3:2',
        imageEditSession: projection.imageEditSession,
      },
    })
    expect(after.edges).toBe(beforeEdges)
    expect(after.history).toBe(beforeHistory)
    expect(getNodeMediaOutputs(updated.type, updated.data)).toEqual([{
      kind: 'image',
      url: newImageUrl,
      previewUrl: newImageUrl,
    }])
    expect(release).toHaveBeenCalledWith([
      '/managed/old-composite.png',
      '/managed/old-preview.webp',
    ])
    expect(mocks.persist).toHaveBeenCalledOnce()
  })

  it('旧平面资源释放失败不回滚已经提交的节点状态', async () => {
    const port = createMultiLayerDocumentProjectionCanvasPort({
      releaseReplacedLocalImages: vi.fn(async () => { throw new Error('lease busy') }),
    })

    await expect(port.commitMaterializedProjection(commitInput())).resolves.toBeUndefined()
    expect(useCanvasStore.getState().nodes[0].data.imageUrl).toBe(newImageUrl)
  })

  it.each([
    ['项目切换', () => useProjectStore.setState({ currentProjectId: 'project-b' })],
    ['节点删除', () => useCanvasStore.setState({ nodes: [] })],
    ['预期旧会话冲突', () => {
      const current = node()
      current.data = {
        ...current.data,
        imageUrl: '/managed/other.png',
        imageEditSession: { ...oldSession, sourceUrl: '/managed/other.png', revision: 9 },
      }
      useCanvasStore.setState({ nodes: [current] })
    }],
  ])('%s 时拒绝覆盖并保留既有状态', async (_label, arrange) => {
    arrange()
    const before = useCanvasStore.getState().nodes
    const port = createMultiLayerDocumentProjectionCanvasPort({
      releaseReplacedLocalImages: vi.fn(async () => undefined),
    })

    await expect(port.commitMaterializedProjection(commitInput())).rejects.toMatchObject({
      code: 'DOCUMENT_CONFLICT',
      recoverable: true,
    })
    expect(useCanvasStore.getState().nodes).toBe(before)
    expect(mocks.persist).not.toHaveBeenCalled()
  })
})
