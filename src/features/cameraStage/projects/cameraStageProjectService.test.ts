import { describe, expect, it, vi } from 'vitest'

const commandMocks = vi.hoisted(() => ({
  deleteRecord: vi.fn<[string], Promise<void>>(),
  getRecord: vi.fn(),
  listSummaries: vi.fn(),
  renameRecord: vi.fn(),
  upsertRecord: vi.fn<[], Promise<void>>(),
}))

vi.mock('@/commands/cameraStageProjects', () => ({
  deleteCameraStageProjectRecord: commandMocks.deleteRecord,
  getCameraStageProjectRecord: commandMocks.getRecord,
  listCameraStageProjectSummaries: commandMocks.listSummaries,
  renameCameraStageProjectRecord: commandMocks.renameRecord,
  upsertCameraStageProjectRecord: commandMocks.upsertRecord,
}))

import { deleteProject, saveProjectDraft, type CameraStageProjectDraft } from './cameraStageProjectService'

function createDraft(id: string): CameraStageProjectDraft {
  return {
    id,
    name: '测试工程',
    fingerprint: `${id}-fingerprint`,
    record: {
      id,
      name: '测试工程',
      createdAt: 1,
      updatedAt: 2,
      objectCount: 0,
      sceneJson: '{}',
    },
  }
}

describe('cameraStageProjectService 工程写入串行化', () => {
  it('删除等待在途保存完成，并阻止删除后的迟到保存复活工程', async () => {
    const projectId = 'delete-race-project'
    let finishSave: (() => void) | undefined
    commandMocks.upsertRecord.mockImplementationOnce(async () => await new Promise<void>((resolve) => {
      finishSave = resolve
    }))
    commandMocks.deleteRecord.mockResolvedValue(undefined)

    const saving = saveProjectDraft(createDraft(projectId), false)
    await vi.waitFor(() => expect(commandMocks.upsertRecord).toHaveBeenCalledTimes(1))
    const deleting = deleteProject(projectId)
    await Promise.resolve()
    expect(commandMocks.deleteRecord).not.toHaveBeenCalledWith(projectId)

    finishSave?.()
    await Promise.all([saving, deleting])
    expect(commandMocks.deleteRecord).toHaveBeenCalledWith(projectId)

    await saveProjectDraft(createDraft(projectId), false)
    expect(commandMocks.upsertRecord).toHaveBeenCalledTimes(1)
  })
})
