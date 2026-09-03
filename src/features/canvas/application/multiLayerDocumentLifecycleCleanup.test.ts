import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  deleteIfRevision: vi.fn(),
  collectGarbage: vi.fn(),
}))

vi.mock('@/commands/imageEditorV3', () => ({
  deleteImageEditorV3DocumentIfRevision: mocks.deleteIfRevision,
}))
vi.mock('@/platform/runtime', () => ({
  getPlatform: () => ({ imageEditorV3: { collectGarbage: mocks.collectGarbage } }),
}))

import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore } from '@/stores/projectStore'
import {
  createMultiLayerDocumentLifecyclePort,
  maintainMultiLayerDocumentReleaseCandidates,
  resetMultiLayerDocumentLifecycleForTests,
} from './multiLayerDocumentLifecycleService'

const projectId = 'cleanup-project'
const session = {
  kind: 'image-edit-v3' as const,
  sourceUrl: '/managed/source.png',
  documentRef: 'image-edit-v3:cleanup-document' as const,
  revision: 2,
  previewRef: `sha256:${'a'.repeat(64)}` as const,
}

beforeEach(() => {
  vi.clearAllMocks()
  resetMultiLayerDocumentLifecycleForTests()
  useCanvasStore.getState().setCanvasData([], [], { past: [], future: [] })
  useProjectStore.setState({
    currentProjectId: projectId,
    currentProject: {
      id: projectId,
      name: '候选清理测试项目',
      createdAt: 1,
      updatedAt: 1,
      nodeCount: 0,
      coverPath: null,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      history: { past: [], future: [] },
    },
  })
  mocks.collectGarbage.mockResolvedValue({ deletedResourceRefs: [], reclaimedBytes: 0 })
})

describe('多图层文档候选清理', () => {
  it('仅在没有活引用且 revision 精确匹配时删除并回收资源', async () => {
    mocks.deleteIfRevision.mockResolvedValue({ deleted: true })
    await createMultiLayerDocumentLifecyclePort().markReleaseCandidate({
      nodeId: 'deleted-node', session,
    })
    expect(mocks.deleteIfRevision).toHaveBeenCalledWith(expect.objectContaining({
      documentRef: session.documentRef,
      expectedRevision: session.revision,
    }))
    expect(mocks.collectGarbage).toHaveBeenCalledOnce()
  })

  it('revision 已变化时保留候选，后续维护仍可重试', async () => {
    mocks.deleteIfRevision.mockResolvedValueOnce({ deleted: false }).mockResolvedValueOnce({ deleted: true })
    await createMultiLayerDocumentLifecyclePort().markReleaseCandidate({
      nodeId: 'deleted-node', session,
    })
    expect(mocks.collectGarbage).not.toHaveBeenCalled()
    await maintainMultiLayerDocumentReleaseCandidates(projectId)
    expect(mocks.deleteIfRevision).toHaveBeenCalledTimes(2)
    expect(mocks.collectGarbage).toHaveBeenCalledOnce()
  })

  it('文档已删除但资源回收失败时保留候选，重试时不重复删除文档', async () => {
    mocks.deleteIfRevision.mockResolvedValue({ deleted: true })
    mocks.collectGarbage.mockRejectedValueOnce(new Error('resource busy')).mockResolvedValueOnce({
      deletedResourceRefs: [],
      reclaimedBytes: 0,
    })
    await createMultiLayerDocumentLifecyclePort().markReleaseCandidate({
      nodeId: 'deleted-node', session,
    })
    await maintainMultiLayerDocumentReleaseCandidates(projectId)
    expect(mocks.deleteIfRevision).toHaveBeenCalledOnce()
    expect(mocks.collectGarbage).toHaveBeenCalledTimes(2)
  })
})
