import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listDocuments: vi.fn(),
  openCamera: vi.fn(),
  openAudio: vi.fn(),
  selectTool: vi.fn(),
}))

vi.mock('@/stores/navigationStore', () => ({ selectToolboxTool: mocks.selectTool }))
vi.mock('@/features/documents/documentOperations', () => ({
  getDocumentOperations: () => ({ listDocuments: mocks.listDocuments }),
}))
vi.mock('@/features/cameraStage/projects/cameraStageProjectService', () => ({ openCameraStageDocument: mocks.openCamera }))
vi.mock('@/features/audioEdit/application/audioEditDocumentService', () => ({ openAudioEditDocument: mocks.openAudio }))

import { loadToolboxRecentFiles, mergeToolboxRecentFiles, openToolboxRecentFile } from './toolboxRecentFiles'

const audio = (id: string, updatedAt: number) => ({ id, name: id, updatedAt })
const camera = (id: string, updatedAt: number) => ({ id, name: id, updatedAt })

describe('工具首页最近文件', () => {
  afterEach(() => { vi.clearAllMocks() })

  it('两个工具的工程按最近编辑合并排序并截取前几项', () => {
    const merged = mergeToolboxRecentFiles([audio('a1', 10), audio('a2', 40)], [camera('c1', 30), camera('c2', 20)], 3)
    expect(merged.map((file) => file.key)).toEqual(['audioEdit:a2', 'cameraStage:c1', 'cameraStage:c2'])
  })

  it('一个来源失败不影响另一个来源', async () => {
    mocks.listDocuments.mockImplementation(async (query: { kind: string }) => {
      if (query.kind === 'audio_edit') throw new Error('磁盘不可用')
      return query.kind === 'camera_stage' ? [camera('c1', 5)] : []
    })
    expect((await loadToolboxRecentFiles()).map((file) => file.key)).toEqual(['cameraStage:c1'])
    // 口播与镜头参考都是通用文档：只列已保存且文件还在的
    expect(mocks.listDocuments).toHaveBeenCalledWith({ kind: 'camera_stage', container: { kind: 'any' }, includeDrafts: false, includeMissing: false })
    expect(mocks.listDocuments).toHaveBeenCalledWith({ kind: 'audio_edit', container: { kind: 'any' }, includeDrafts: false, includeMissing: false })
  })

  it('打开镜头参考走它的文档打开入口（进入编辑器），再切到该工具', async () => {
    mocks.openCamera.mockResolvedValue(undefined)
    await openToolboxRecentFile({ key: 'cameraStage:c1', toolId: 'cameraStage', projectId: 'c1', name: 'c1', updatedAt: 1 })
    expect(mocks.openCamera).toHaveBeenCalledWith({ id: 'c1' })
    expect(mocks.selectTool).toHaveBeenCalledWith('cameraStage')
  })

  it('打开口播失败时仍进入该工具（落在口播列表）并把错误交给调用方', async () => {
    mocks.openAudio.mockRejectedValue(new Error('找不到口播。'))
    await expect(openToolboxRecentFile({ key: 'audioEdit:a1', toolId: 'audioEdit', projectId: 'a1', name: 'a1', updatedAt: 1 }))
      .rejects.toThrow('找不到口播')
    expect(mocks.openAudio).toHaveBeenCalledWith({ id: 'a1' })
    expect(mocks.selectTool).toHaveBeenCalledWith('audioEdit')
  })
})
