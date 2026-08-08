import { getStoryboardProject, listStoryboardProjects } from '@/features/canvas/application/storyboardProjectService'
import { commitImageEdit } from '@/features/imageEdit/application/imageEditApplicationService'
import { getToolboxState, listToolboxTools } from '@/features/toolbox/application/toolboxApplicationService'
import { selectToolboxTool } from '@/stores/navigationStore'

import type { ApplicationCapabilityHandlerRegistrar } from './handlerTypes'
import { createImageEditPreviewFromRef } from './generationCapabilities'
import { parseCapabilityInput, throwIfCapabilityAborted } from './handlerUtils'
import { openApplicationSurface } from './surfaceRegistry'
import {
  applyCameraStageCameraMove,
  bakeCameraStageToPro,
  createCameraStageProject,
  deleteCameraStageObject,
  deleteCameraStageProject,
  duplicateCameraStageObject,
  getCameraStageProject,
  listCameraStageProjects,
  observeCameraStageScene,
  openCameraStageProject,
  placeCameraStageObject,
  renameCameraStageProject,
  updateCameraStageObject,
  verifyCameraStage,
} from './cameraStageCapabilityAdapter'

interface ProjectInput {
  projectId: string
}

interface CameraObjectInput extends ProjectInput {
  objectId: string
}

export function registerToolboxCapabilityHandlers(
  registrar: ApplicationCapabilityHandlerRegistrar
): void {
  registrar.registerHandler('list_toolbox_tools', () => ({
    tools: listToolboxTools(),
  }))

  registrar.registerHandler('get_toolbox_state', () => ({
    state: getToolboxState(),
  }))

  registrar.registerHandler('select_toolbox_tool', (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<{
      toolId: 'cameraStage' | 'imageMark' | null
    }>('select_toolbox_tool', input)
    if (parsed.toolId) {
      const surfaceId = parsed.toolId === 'cameraStage' ? 'tool.camera_stage' : 'tool.image_edit'
      return { toolId: parsed.toolId, ...openApplicationSurface(surfaceId, context) }
    }
    // 关闭工具只回工具箱首页，不抢占用户当前所在工作区。
    selectToolboxTool(null)
    return { toolId: parsed.toolId, surfaceId: null }
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
    const parsed = parseCapabilityInput<{
      name: string
      mode: 'simple' | 'pro'
    }>('create_camera_stage_project', input)
    return await createCameraStageProject(parsed.name, parsed.mode)
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

  registrar.registerHandler('bake_camera_stage_to_pro', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<ProjectInput & { baseRevision: number }>('bake_camera_stage_to_pro', input)
    return await bakeCameraStageToPro(parsed)
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

  registrar.registerHandler('create_image_edit_preview', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<{
      assetId: string
      operations: Record<string, unknown>[]
    }>('create_image_edit_preview', input)
    const preview = await createImageEditPreviewFromRef({
      sourceRef: { kind: 'asset', id: parsed.assetId },
      operations: parsed.operations,
    }, context)
    return {
      previewRef: preview.previewRef,
      assetId: parsed.assetId,
      operationCount: preview.operationCount,
      hasEffect: preview.hasEffect,
      width: preview.width,
      height: preview.height,
    }
  })

  registrar.registerHandler('commit_image_edit', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<{
      previewRef: string
      displayName?: string
    }>('commit_image_edit', input)
    return await commitImageEdit(parsed.previewRef, parsed.displayName)
  })

  registrar.registerHandler('list_storyboard_projects', async () => ({
    projects: await listStoryboardProjects(),
  }))

  registrar.registerHandler('get_storyboard_project', async (input) => {
    const parsed = parseCapabilityInput<ProjectInput>('get_storyboard_project', input)
    return { project: await getStoryboardProject(parsed.projectId) }
  })
}
