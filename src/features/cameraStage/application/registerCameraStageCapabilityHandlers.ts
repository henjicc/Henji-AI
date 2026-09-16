import { configureCameraStageControlDependencies } from './applicationDomain'
import { getHostScopeRevisions, notifyHostScopeChanged } from '@/features/application-control/hostContext/hostContext'

import { CAMERA_STAGE_RENDER_CAPABILITY_ID, CANCEL_CAMERA_STAGE_RENDER_TASK_CAPABILITY_ID, GET_CAMERA_STAGE_RENDER_TASK_CAPABILITY_ID, WAIT_CAMERA_STAGE_RENDER_TASK_CAPABILITY_ID, RECOVER_CAMERA_STAGE_RENDER_TASK_CAPABILITY_ID } from '@/core/application-control/domains/cameraStage/cameraStageRenderApplicationCapabilities'

import type { ApplicationCapabilityHandlerRegistrar } from '@/features/application-control/capabilities/handlerTypes'

import { parseCapabilityInput, throwIfCapabilityAborted } from '@/features/application-control/capabilities/handlerUtils'
import { openApplicationSurface } from '@/features/navigation/application/surfaceCapabilityService'
import { applyCameraStageCameraMove, createCameraStageProject, deleteCameraStageObject, deleteCameraStageProject, duplicateCameraStageObject, getCameraStageProject, listCameraStageProjects, observeCameraStageScene, openCameraStageProject, placeCameraStageObject, renameCameraStageProject, updateCameraStageObject, verifyCameraStage } from '@/features/cameraStage/application/cameraStageCapabilityAdapter'
import { cancelCameraStageRenderTask, getCameraStageRenderTask, renderCameraStageOutput, waitCameraStageRenderTask, recoverCameraStageRenderTask } from '@/features/cameraStage/application/cameraStageRenderCapabilityAdapter'

interface ProjectInput {
  projectId: string
}

interface CameraObjectInput extends ProjectInput {
  objectId: string
}

export function registerCameraStageCapabilityHandlers(registrar: ApplicationCapabilityHandlerRegistrar): void {
  configureCameraStageControlDependencies({
    readRevision: () => getHostScopeRevisions().toolbox,
    bumpRevision: () => notifyHostScopeChanged('toolbox'),
  })
  registrar.registerHandler('list_camera_stage_projects', async () => await listCameraStageProjects())

  registrar.registerHandler('get_camera_stage_project', async (input) => {
    const parsed = parseCapabilityInput<ProjectInput>('get_camera_stage_project', input)
    return await getCameraStageProject(parsed.projectId)
  })

  registrar.registerHandler('observe_camera_stage_scene', async (input) => {
    const parsed = parseCapabilityInput<ProjectInput>('observe_camera_stage_scene', input)
    return await observeCameraStageScene(parsed.projectId)
  })

  registrar.registerHandler('open_camera_stage_project', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<ProjectInput>('open_camera_stage_project', input)
    const project = await openCameraStageProject(parsed.projectId)
    return { ...project, ...openApplicationSurface('tool.camera_stage', context) }
  })

  registrar.registerHandler('create_camera_stage_project', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<{ name: string }>('create_camera_stage_project', input)
    return await createCameraStageProject(parsed.name)
  })

  registrar.registerHandler('rename_camera_stage_project', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<ProjectInput & { name: string; baseRevision: number }>(
      'rename_camera_stage_project',
      input
    )
    return await renameCameraStageProject(parsed, context)
  })

  registrar.registerHandler('delete_camera_stage_project', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<ProjectInput & { baseRevision: number }>('delete_camera_stage_project', input)
    return await deleteCameraStageProject(parsed)
  })

  registrar.registerHandler('place_camera_stage_object', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<Record<string, unknown> & { baseRevision: number }>('place_camera_stage_object', input)
    return await placeCameraStageObject(parsed, context)
  })

  registrar.registerHandler('duplicate_camera_stage_object', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<CameraObjectInput & { baseRevision: number }>(
      'duplicate_camera_stage_object',
      input
    )
    return await duplicateCameraStageObject(parsed)
  })

  registrar.registerHandler('delete_camera_stage_object', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<CameraObjectInput & { baseRevision: number }>('delete_camera_stage_object', input)
    return await deleteCameraStageObject(parsed)
  })

  registrar.registerHandler('update_camera_stage_object', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<CameraObjectInput & {
      baseRevision: number
      changes: Parameters<typeof updateCameraStageObject>[0]['changes']
    }>('update_camera_stage_object', input)
    return await updateCameraStageObject(parsed, context)
  })

  registrar.registerHandler('apply_camera_stage_camera_move', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<Record<string, unknown> & { baseRevision: number }>('apply_camera_stage_camera_move', input)
    return await applyCameraStageCameraMove(parsed, context)
  })

  registrar.registerHandler('verify_camera_stage_scene', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<Parameters<typeof verifyCameraStage>[0]>('verify_camera_stage_scene', input)
    return await verifyCameraStage(parsed)
  })

  registrar.registerHandler(CAMERA_STAGE_RENDER_CAPABILITY_ID, async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<Parameters<typeof renderCameraStageOutput>[0]>(
      CAMERA_STAGE_RENDER_CAPABILITY_ID,
      input,
    )
    return await renderCameraStageOutput(parsed, context)
  })

  registrar.registerHandler(GET_CAMERA_STAGE_RENDER_TASK_CAPABILITY_ID, async (input) => {
    const parsed = parseCapabilityInput<{ taskRef: Parameters<typeof getCameraStageRenderTask>[0] }>(
      GET_CAMERA_STAGE_RENDER_TASK_CAPABILITY_ID,
      input,
    )
    return await getCameraStageRenderTask(parsed.taskRef)
  })

  registrar.registerHandler(CANCEL_CAMERA_STAGE_RENDER_TASK_CAPABILITY_ID, async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<{ taskRef: Parameters<typeof cancelCameraStageRenderTask>[0] }>(
      CANCEL_CAMERA_STAGE_RENDER_TASK_CAPABILITY_ID,
      input,
    )
    return await cancelCameraStageRenderTask(parsed.taskRef)
  })

  for (const [id, execute] of [
    [WAIT_CAMERA_STAGE_RENDER_TASK_CAPABILITY_ID, waitCameraStageRenderTask],
    [RECOVER_CAMERA_STAGE_RENDER_TASK_CAPABILITY_ID, recoverCameraStageRenderTask],
  ] as const) registrar.registerHandler(id, async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<{ taskRef: Parameters<typeof getCameraStageRenderTask>[0] }>(id, input)
    return execute(parsed.taskRef, context.signal)
  })

}
