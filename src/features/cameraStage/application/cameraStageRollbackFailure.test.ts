import { cameraStageTestDocuments, loadCameraStageTestProject } from '@/tests/cameraStageProjectFixture'
import { beforeEach, describe, expect, it } from 'vitest'

import { ApplicationExecutionProgressFailure } from '@/core/application-control/execution/persistence'
import { createDefaultAnimation } from '../domain/animationTypes'
import { createCameraObject, createDefaultSceneSettings, createPrimitiveObject, pickDefaultColor } from '../domain/sceneDefaults'
import { useCameraStageStore } from '../store/cameraStageStore'
import { cameraStageApplicationService } from './cameraStageApplicationService'
import { cameraStageStateKeyframeService } from './cameraStageStateKeyframeService'

/*
 * 写入失败后回滚到快照；回滚也失败时场景还留着这次写入。助手按 partial / recoverable 判断要不要重试，
 * 回滚失败被吞掉就会报成“没有任何步骤被提交”，重试叠出重复内容。
 */
describe('三维写入回滚失败如实报告', () => {
  beforeEach(async () => {
    const camera = createCameraObject('摄像机01', pickDefaultColor(0))
    const cube = createPrimitiveObject('box', '立方体', pickDefaultColor(1))
    await loadCameraStageTestProject({
      objects: [camera, cube], activeCameraId: camera.id, animation: createDefaultAnimation(),
      sceneSettings: createDefaultSceneSettings(), stateKeyframes: [],
    }, { id: 'project-1', name: '回滚失败测试' })
  })

  function cubeId(): string {
    return useCameraStageStore.getState().objects.find((object) => object.type === 'primitive')!.id
  }

  it('写入与回滚的保存都失败时，抛出带未补偿写入的进度失败', async () => {
    cameraStageTestDocuments()!.failSaves = 2
    const failure = await cameraStageApplicationService.updateObject('project-1', cubeId(), { name: '新名字' }).catch((error) => error)
    expect(failure).toBeInstanceOf(ApplicationExecutionProgressFailure)
    expect(failure.completed).toHaveLength(1)
    expect(failure.compensatedStepIndexes).toEqual([])
    expect(failure.message).toContain('磁盘已满')
  })

  it('回滚成功时原样抛出写入错误，场景回到写入前', async () => {
    cameraStageTestDocuments()!.failSaves = 1
    const failure = await cameraStageApplicationService.updateObject('project-1', cubeId(), { name: '新名字' }).catch((error) => error)
    expect(failure).not.toBeInstanceOf(ApplicationExecutionProgressFailure)
    expect(failure.message).toBe('磁盘已满')
    expect(useCameraStageStore.getState().objects.find((object) => object.type === 'primitive')!.name).toBe('立方体')
  })

  it('自己调用回滚的服务同样报告未补偿', async () => {
    cameraStageTestDocuments()!.failSaves = 2
    const failure = await cameraStageStateKeyframeService.createStateKeyframes('project-1', [{ time: 1 }]).catch((error) => error)
    expect(failure).toBeInstanceOf(ApplicationExecutionProgressFailure)
    expect(failure.compensatedStepIndexes).toEqual([])
  })
})
