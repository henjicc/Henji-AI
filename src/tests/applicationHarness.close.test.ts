// @vitest-environment jsdom
import '@/tests/canvasProjectFixture'
import '@/tests/cameraStageProjectFixture'
import '@/tests/imageEditDocumentFixture'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage, readHarnessImageEditDocument } from './harnessNativeStorage'
import { createAttachedImageEditPersistenceFixture } from './imageEditAttachedPersistenceFixture'
import { closeApplication } from '@/features/application-control/applicationCloseService'
import { leaseCanvasProject, requireCanvasProjectInstance } from '@/features/canvas/application/canvasProjectInstances'
import { cameraStageProjectStore } from '@/features/cameraStage/application/cameraStageProjectRuntime'
import { createStoredCameraStageProject } from '@/features/cameraStage/projects/cameraStageProjectService'
import { deserializeScene } from '@/features/cameraStage/domain/sceneSerialization'
import { getCameraStageProjectRecord } from '@/commands/cameraStageProjects'
import { useProjectStore } from '@/stores/projectStore'
import { getProjectRecord } from '@/commands/projectState'
import { CANVAS_NODE_TYPES } from '@/features/canvas/domain/canvasNodes'
import { getPlatform } from '@/platform/runtime'

const disposals: Array<() => void> = []
beforeEach(installHarnessNativeStorage)
afterEach(() => {
  disposals.splice(0).reverse().forEach((dispose) => dispose())
  vi.restoreAllMocks()
  uninstallHarnessNativeStorage()
})

it('退出保存后台画布、三维与离屏图片文档及投影，最终确认期间拒绝新修改', async () => {
  const image = await createAttachedImageEditPersistenceFixture()
  disposals.push(image.dispose)
  const visibleId = await useProjectStore.getState().createProject('A')
  const background = requireCanvasProjectInstance(image.projectId)
  background.store.getState().addNode(CANVAS_NODE_TYPES.textAnnotation, { x: 50, y: 60 })
  image.bus.dispatch({ type: 'layer.update-common', commandId: 'close-image-change', expectedRevision: 0,
    layerId: 'effect', patch: { opacity: 0.4 } })
  const stage = await createStoredCameraStageProject('后台三维')
  const stageStore = cameraStageProjectStore(stage.id)
  stageStore.getState().addPrimitive('box')
  const confirm = vi.fn(async () => {
    expect(useProjectStore.getState().currentProjectId).toBe(visibleId)
    const record = (await getProjectRecord(image.projectId))!
    expect(JSON.parse(record.nodesJson)).toHaveLength(2)
    expect(JSON.parse(record.historyJson).past.length).toBeGreaterThan(0)
    expect(readHarnessImageEditDocument(image.document.id)?.document.revision).toBe(1)
    expect(background.store.getState().nodes[0].data.imageEditSession?.revision).toBe(1)
    expect(deserializeScene((await getCameraStageProjectRecord(stage.id))!.sceneJson).objects).toHaveLength(2)
    expect(() => background.store.getState().addNode(CANVAS_NODE_TYPES.textAnnotation, { x: 0, y: 0 })).toThrow('APPLICATION_CLOSING')
    expect(() => stageStore.getState().addPrimitive('box')).toThrow('APPLICATION_CLOSING')
    const history = stageStore.temporal.getState().pastStates
    expect(() => stageStore.temporal.getState().undo()).toThrow('APPLICATION_CLOSING')
    expect(stageStore.temporal.getState().pastStates).toBe(history)
    expect(() => image.bus.undo()).toThrow('APPLICATION_CLOSING')
    expect(() => leaseCanvasProject(background)).toThrow('APPLICATION_CLOSING')
    background.store.setState({ canvasViewportSize: { width: 500, height: 300 } })
  })
  await closeApplication(confirm)
  expect(confirm).toHaveBeenCalledOnce()
  expect(image.materialize).toHaveBeenCalledOnce()
})

it('在途任务阻止退出，释放后可关闭；后台保存失败保留原实例并恢复编辑', async () => {
  const backgroundId = await useProjectStore.getState().createProject('B')
  await useProjectStore.getState().createProject('A')
  const instance = requireCanvasProjectInstance(backgroundId)
  instance.store.getState().addNode(CANVAS_NODE_TYPES.textAnnotation, { x: 10, y: 20 })
  const release = leaseCanvasProject(instance)
  const confirm = vi.fn(async () => undefined)
  await expect(closeApplication(confirm)).rejects.toThrow('还有操作正在进行')
  expect(confirm).not.toHaveBeenCalled()
  release()
  const io = getPlatform().storyboardProjects
  const original = io.upsertProjectRecord.bind(io)
  const write = vi.spyOn(io, 'upsertProjectRecord').mockImplementation(async (record) => {
    if (record.id === backgroundId) throw new Error('disk full')
    await original(record)
  })
  await expect(closeApplication(confirm)).rejects.toThrow('disk full')
  expect(confirm).not.toHaveBeenCalled()
  expect(requireCanvasProjectInstance(backgroundId)).toBe(instance)
  expect(instance.dirty).toBe(true)
  instance.store.getState().addNode(CANVAS_NODE_TYPES.textAnnotation, { x: 20, y: 30 })
  write.mockRestore()
  await closeApplication(confirm)
  expect(confirm).toHaveBeenCalledOnce()
  expect(JSON.parse((await getProjectRecord(backgroundId))!.nodesJson)).toHaveLength(2)
})
