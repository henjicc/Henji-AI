import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  openDialog: vi.fn(),
  importProjectPackage: vi.fn(),
  upsertProjectRecord: vi.fn(),
  deleteDocumentIfRevision: vi.fn(),
  collectGarbage: vi.fn(),
}))

vi.mock('@/platform/desktopApi', () => ({ openDialog: mocks.openDialog }))
vi.mock('@/commands/projectPackage', () => ({ importProjectPackage: mocks.importProjectPackage }))
vi.mock('@/commands/projectState', () => ({
  deleteProjectRecord: vi.fn(),
  getProjectRecord: vi.fn(),
  listProjectSummaries: vi.fn(),
  renameProjectRecord: vi.fn(),
  updateProjectViewportRecord: vi.fn(),
  upsertProjectRecord: mocks.upsertProjectRecord,
}))
vi.mock('@/commands/imageEditorV3', () => ({
  deleteImageEditorV3DocumentIfRevision: mocks.deleteDocumentIfRevision,
}))
vi.mock('@/platform/runtime', () => ({
  getPlatform: () => ({ imageEditorV3: { collectGarbage: mocks.collectGarbage } }),
}))

import { importProjectFromPackage } from './importProject'

const PREVIEW_REF = `sha256:${'a'.repeat(64)}` as const

beforeEach(() => {
  vi.clearAllMocks()
  mocks.openDialog.mockResolvedValue('/tmp/project.henjiproj')
  mocks.deleteDocumentIfRevision.mockResolvedValue({ deleted: true })
  mocks.collectGarbage.mockResolvedValue({ deletedResourceRefs: [], reclaimedBytes: 0 })
})

describe('项目包渲染层导入事务', () => {
  it('项目记录写入失败时精确补偿已导入 V3 文档并保留原项目', async () => {
    mocks.importProjectPackage.mockResolvedValue({
      manifestJson: JSON.stringify({
        formatVersion: 2,
        project: { name: '待导入' },
        nodes: [{
          id: 'document-node',
          type: 'layerStackResult',
          position: { x: 0, y: 0 },
          data: {
            resultKind: 'layer-stack',
            imageUrl: '/managed/result.png',
            previewImageUrl: '/managed/result.png',
            aspectRatio: '1:1',
            imageEditSession: {
              kind: 'image-edit-v3',
              sourceUrl: '/managed/result.png',
              documentRef: 'image-edit-v3:source',
              revision: 4,
              previewRef: PREVIEW_REF,
            },
          },
        }],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      }),
      pathMap: {},
      imageEditReferences: [{
        source: { documentRef: 'image-edit-v3:source', revision: 4, previewRef: PREVIEW_REF },
        imported: { documentRef: 'image-edit-v3:imported', revision: 4, previewRef: PREVIEW_REF },
      }],
    })
    mocks.upsertProjectRecord.mockRejectedValue(new Error('database unavailable'))

    await expect(importProjectFromPackage()).rejects.toThrow('database unavailable')
    expect(mocks.deleteDocumentIfRevision).toHaveBeenCalledWith(expect.objectContaining({
      documentRef: 'image-edit-v3:imported',
      expectedRevision: 4,
    }))
    expect(mocks.collectGarbage).toHaveBeenCalledOnce()
  })
})
