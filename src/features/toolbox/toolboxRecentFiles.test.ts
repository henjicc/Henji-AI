import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listAudio: vi.fn(),
  listCamera: vi.fn(),
  openCamera: vi.fn(),
  loadAudio: vi.fn(),
  setProject: vi.fn(),
  setAppView: vi.fn(),
  selectTool: vi.fn(),
}))

vi.mock('@/platform/runtime', () => ({ getPlatform: () => ({ audioEdit: { listProjects: mocks.listAudio } }) }))
vi.mock('@/stores/navigationStore', () => ({ selectToolboxTool: mocks.selectTool }))
vi.mock('@/features/cameraStage/application/cameraStageApplicationService', () => ({
  cameraStageApplicationService: { listProjects: mocks.listCamera, openProject: mocks.openCamera },
}))
vi.mock('@/features/cameraStage/store/cameraStageSessionStore', () => ({
  useCameraStageSessionStore: { getState: () => ({ setAppView: mocks.setAppView }) },
}))
vi.mock('@/features/audioEdit/application/audioEditProjectInstances', () => ({ loadAudioEditProject: mocks.loadAudio }))
vi.mock('@/features/audioEdit/store/audioEditStore', () => ({
  useAudioEditStore: { getState: () => ({ setProject: mocks.setProject }) },
}))

import { loadToolboxRecentFiles, mergeToolboxRecentFiles, openToolboxRecentFile } from './toolboxRecentFiles'

const audio = (id: string, updatedAt: number) => ({ id, name: `${id}.wav`, mediaType: 'audio' as const, durationFrames: 48000, sampleRate: 48000, updatedAt })
const camera = (id: string, updatedAt: number) => ({ id, name: id, createdAt: 0, updatedAt, objectCount: 1, coverPath: null })

describe('工具首页最近文件', () => {
  afterEach(() => { vi.clearAllMocks() })

  it('两个工具的工程按最近编辑合并排序并截取前几项', () => {
    const merged = mergeToolboxRecentFiles([audio('a1', 10), audio('a2', 40)], [camera('c1', 30), camera('c2', 20)], 3)
    expect(merged.map((file) => file.key)).toEqual(['audioEdit:a2', 'cameraStage:c1', 'cameraStage:c2'])
  })

  it('一个来源失败不影响另一个来源', async () => {
    mocks.listAudio.mockRejectedValue(new Error('磁盘不可用'))
    mocks.listCamera.mockResolvedValue([camera('c1', 5)])
    expect((await loadToolboxRecentFiles()).map((file) => file.key)).toEqual(['cameraStage:c1'])
  })

  it('打开 3D 工程走正式打开入口并进入编辑器，再切到该工具', async () => {
    mocks.openCamera.mockResolvedValue({ projectId: 'c1' })
    await openToolboxRecentFile({ key: 'cameraStage:c1', toolId: 'cameraStage', projectId: 'c1', name: 'c1', updatedAt: 1 })
    expect(mocks.openCamera).toHaveBeenCalledWith('c1')
    expect(mocks.setAppView).toHaveBeenCalledWith('editor')
    expect(mocks.selectTool).toHaveBeenCalledWith('cameraStage')
  })

  it('打开口播工程失败时仍进入该工具（落在工程列表）并把错误交给调用方', async () => {
    mocks.loadAudio.mockRejectedValue(new Error('找不到口播工程。'))
    await expect(openToolboxRecentFile({ key: 'audioEdit:a1', toolId: 'audioEdit', projectId: 'a1', name: 'a1', updatedAt: 1 }))
      .rejects.toThrow('找不到口播工程')
    expect(mocks.setProject).not.toHaveBeenCalled()
    expect(mocks.selectTool).toHaveBeenCalledWith('audioEdit')
  })
})
