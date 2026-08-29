import { describe, expect, it, vi } from 'vitest'
import type { CameraStageProjectPlatformWrite } from '@/platform/contracts/cameraStageProjects'

const commandMocks = vi.hoisted(() => ({
  deleteRecord: vi.fn<[string], Promise<void>>(),
  getRecord: vi.fn(),
  listSummaries: vi.fn(),
  renameRecord: vi.fn(),
  upsertRecord: vi.fn<[CameraStageProjectPlatformWrite], Promise<void>>(),
}))

vi.mock('@/commands/cameraStageProjects', () => ({
  deleteCameraStageProjectRecord: commandMocks.deleteRecord,
  getCameraStageProjectRecord: commandMocks.getRecord,
  listCameraStageProjectSummaries: commandMocks.listSummaries,
  renameCameraStageProjectRecord: commandMocks.renameRecord,
  upsertCameraStageProjectRecord: commandMocks.upsertRecord,
}))

import { createDefaultSceneSettings } from '../domain/sceneDefaults'
import { deserializeScene, serializeScene } from '../domain/sceneSerialization'
import {
  applyProjectEnvironmentImage,
  deleteProject,
  listProjects,
  saveProjectDraft,
  type CameraStageProjectDraft,
} from './cameraStageProjectService'

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
  it('工程列表只返回当前 schema，旧记录不进入界面和反射枚举', async () => {
    commandMocks.listSummaries.mockResolvedValue([
      { id: 'current', name: '新工程', createdAt: 1, updatedAt: 2, objectCount: 1 },
      { id: 'old', name: '旧工程', createdAt: 1, updatedAt: 2, objectCount: 1 },
    ])
    commandMocks.getRecord.mockImplementation(async (id: string) => ({
      id,
      name: id === 'current' ? '新工程' : '旧工程',
      createdAt: 1,
      updatedAt: 2,
      objectCount: 1,
      sceneJson: JSON.stringify({ schemaVersion: id === 'current' ? 14 : 13 }),
    }))

    await expect(listProjects()).resolves.toEqual([
      { id: 'current', name: '新工程', createdAt: 1, updatedAt: 2, objectCount: 1 },
    ])
  })

  it('把画布全景输入持久化到未打开的 3D 工程', async () => {
    const record = {
      id: 'environment-project',
      name: '环境工程',
      createdAt: 1,
      updatedAt: 2,
      objectCount: 0,
      sceneJson: serializeScene({
        objects: [],
        activeCameraId: null,
        sceneSettings: createDefaultSceneSettings(),
        stateKeyframes: [],
      }),
    }
    commandMocks.getRecord.mockResolvedValueOnce(record)
    commandMocks.upsertRecord.mockResolvedValueOnce(undefined)

    await applyProjectEnvironmentImage(record.id, '/media/panorama.png')

    const saved = commandMocks.upsertRecord.mock.calls.at(-1)?.[0]
    expect(saved).toBeDefined()
    if (!saved) throw new Error('未写入工程')
    expect(deserializeScene(saved.sceneJson).sceneSettings.sky.environmentImageUrl)
      .toBe('/media/panorama.png')
  })

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
