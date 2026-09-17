import '@/tests/imageEditDocumentFixture';
import { setCanvasTestProjectState } from '@/tests/canvasProjectFixture';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  deleteIfRevision: vi.fn(),
  listProjects: vi.fn(),
  getProject: vi.fn(),
  collectGarbage: vi.fn(),
}))

vi.mock('@/commands/projectState', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/commands/projectState')>(),
  listProjectSummaries: mocks.listProjects, getProjectRecord: mocks.getProject,
}))

vi.mock('@/commands/imageEditorV3', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/commands/imageEditorV3')>(),
  deleteImageEditorV3DocumentIfRevision: mocks.deleteIfRevision,
}))
vi.mock('@/platform/runtime', () => ({
  isUiInspectionReadOnly: () => true,
  getPlatform: () => ({ imageEditorV3: { collectGarbage: mocks.collectGarbage } }),
}))

import { useCanvasStore } from '@/stores/canvasStore';
import { registerCanvasProjectInstance, requireCanvasProjectInstance } from './canvasProjectInstances'
import { toProjectRecord } from '@/stores/projectStoreSerialization'
import { CANVAS_NODE_TYPES, type CanvasNode } from '../domain/canvasNodes'

import { createMultiLayerDocumentLifecyclePort, maintainMultiLayerDocumentReleaseCandidates, resetMultiLayerDocumentLifecycleForTests } from './multiLayerDocumentLifecycleService';

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
  mocks.listProjects.mockReset().mockResolvedValue([])
  mocks.getProject.mockReset()
  resetMultiLayerDocumentLifecycleForTests()
  useCanvasStore.getState().setCanvasData([], [], { past: [], future: [] })
  setCanvasTestProjectState({
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
  it('后台工程仍被另一工程的撤销历史引用时保留，历史释放后才清理', async () => {
    const node = { id: 'retained', type: CANVAS_NODE_TYPES.layerStackResult, position: { x: 0, y: 0 },
      data: { resultKind: 'layer-stack', imageUrl: session.sourceUrl, imageEditSession: session } } as CanvasNode
    const other = registerCanvasProjectInstance({ ...requireCanvasProjectInstance(projectId).snapshot(), id: 'other',
      history: { past: [{ nodes: [node], edges: [] }], future: [] } })
    mocks.deleteIfRevision.mockResolvedValue({ deleted: true })
    await createMultiLayerDocumentLifecyclePort().markReleaseCandidate({ projectId, nodeId: 'deleted-node', session })
    expect(mocks.deleteIfRevision).not.toHaveBeenCalled()
    other.store.getState().setCanvasData([], [], { past: [], future: [] })
    await maintainMultiLayerDocumentReleaseCandidates(projectId)
    expect(mocks.deleteIfRevision).toHaveBeenCalledOnce()
  })

  it('未加载工程的保存记录及其撤销历史也保留文档；读取失败不删除', async () => {
    const node = { id: 'retained', type: CANVAS_NODE_TYPES.layerStackResult, position: { x: 0, y: 0 },
      data: { resultKind: 'layer-stack', imageUrl: session.sourceUrl, imageEditSession: session } } as CanvasNode
    const record = toProjectRecord({ ...requireCanvasProjectInstance(projectId).snapshot(), id: 'unopened',
      history: { past: [], future: [{ nodes: [node], edges: [] }] } })
    mocks.listProjects.mockResolvedValue([{ id: 'unopened' }])
    mocks.getProject.mockResolvedValue(record)
    await createMultiLayerDocumentLifecyclePort().markReleaseCandidate({ projectId, nodeId: 'deleted-node', session })
    expect(mocks.deleteIfRevision).not.toHaveBeenCalled()
    mocks.getProject.mockRejectedValueOnce(new Error('read unavailable'))
    await maintainMultiLayerDocumentReleaseCandidates(projectId)
    expect(mocks.deleteIfRevision).not.toHaveBeenCalled()
  })

  it('仅在没有活引用且 revision 精确匹配时删除并回收资源', async () => {
    mocks.deleteIfRevision.mockResolvedValue({ deleted: true })
    await createMultiLayerDocumentLifecyclePort().markReleaseCandidate({
      projectId, nodeId: 'deleted-node', session,
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
      projectId, nodeId: 'deleted-node', session,
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
      projectId, nodeId: 'deleted-node', session,
    })
    await maintainMultiLayerDocumentReleaseCandidates(projectId)
    expect(mocks.deleteIfRevision).toHaveBeenCalledOnce()
    expect(mocks.collectGarbage).toHaveBeenCalledTimes(2)
  })
})
