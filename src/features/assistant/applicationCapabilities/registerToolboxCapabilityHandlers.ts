import {
  addCameraStageObjectFromAgent,
  addCameraStageShotFromAgent,
  commitImageEditFromAgent,
  createCameraStageProjectFromAgent,
  deleteCameraStageObjectFromAgent,
  deleteCameraStageProjectFromAgent,
  duplicateCameraStageObjectFromAgent,
  getCameraStageProjectFromAgent,
  getStoryboardProjectFromAgent,
  getToolboxStateFromAgent,
  listCameraStageProjectsFromAgent,
  listStoryboardProjectsFromAgent,
  listToolboxToolsFromAgent,
  openCameraStageProjectFromAgent,
  renameCameraStageProjectFromAgent,
  updateCameraStageObjectFromAgent,
  updateCameraStageShotFromAgent,
} from '@/features/assistant/hostActions'
import type { StagePrimitiveKind } from '@/features/cameraStage/domain/sceneTypes'
import { selectToolboxTool } from '@/stores/navigationStore'

import type { ApplicationCapabilityHandlerRegistrar } from './handlerTypes'
import { createImageEditPreviewFromRef } from './generationCapabilities'
import { parseCapabilityInput, throwIfCapabilityAborted } from './handlerUtils'
import { openApplicationSurface } from './surfaceRegistry'

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
    tools: listToolboxToolsFromAgent(),
  }))

  registrar.registerHandler('get_toolbox_state', () => ({
    state: getToolboxStateFromAgent(),
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

  registrar.registerHandler('list_camera_stage_projects', async () => ({
    projects: await listCameraStageProjectsFromAgent(),
  }))

  registrar.registerHandler('get_camera_stage_project', async (input) => {
    const parsed = parseCapabilityInput<ProjectInput>('get_camera_stage_project', input)
    return { project: await getCameraStageProjectFromAgent(parsed.projectId) }
  })

  registrar.registerHandler('open_camera_stage_project', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<ProjectInput>('open_camera_stage_project', input)
    const project = await openCameraStageProjectFromAgent(parsed.projectId)
    return { ...project, ...openApplicationSurface('tool.camera_stage', context) }
  })

  registrar.registerHandler('create_camera_stage_project', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<{
      name: string
      mode: 'simple' | 'pro'
    }>('create_camera_stage_project', input)
    return await createCameraStageProjectFromAgent(parsed.name, parsed.mode)
  })

  registrar.registerHandler('rename_camera_stage_project', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<ProjectInput & { name: string }>(
      'rename_camera_stage_project',
      input
    )
    return await renameCameraStageProjectFromAgent(parsed.projectId, parsed.name)
  })

  registrar.registerHandler('delete_camera_stage_project', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<ProjectInput>('delete_camera_stage_project', input)
    return await deleteCameraStageProjectFromAgent(parsed.projectId)
  })

  registrar.registerHandler('add_camera_stage_object', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<ProjectInput & {
      objectType: 'primitive' | 'character' | 'camera'
      primitiveKind?: StagePrimitiveKind
    }>('add_camera_stage_object', input)
    return await addCameraStageObjectFromAgent(parsed)
  })

  registrar.registerHandler('duplicate_camera_stage_object', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<CameraObjectInput>(
      'duplicate_camera_stage_object',
      input
    )
    return await duplicateCameraStageObjectFromAgent(parsed)
  })

  registrar.registerHandler('delete_camera_stage_object', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<CameraObjectInput>('delete_camera_stage_object', input)
    return await deleteCameraStageObjectFromAgent(parsed)
  })

  registrar.registerHandler('update_camera_stage_object', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<CameraObjectInput & {
      patch: Record<string, unknown>
    }>('update_camera_stage_object', input)
    return await updateCameraStageObjectFromAgent(parsed)
  })

  registrar.registerHandler('add_camera_stage_shot', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<ProjectInput & {
      name: string
      cameraId: string | null
    }>('add_camera_stage_shot', input)
    return await addCameraStageShotFromAgent(parsed)
  })

  registrar.registerHandler('update_camera_stage_shot', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<ProjectInput & {
      shotId: string
      patch: {
        name?: string
        hold?: number
        transitionDuration?: number
        continuity?: 'stop' | 'smooth'
        cameraId?: string | null
      }
    }>('update_camera_stage_shot', input)
    return await updateCameraStageShotFromAgent(parsed)
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
    return await commitImageEditFromAgent(parsed.previewRef, parsed.displayName)
  })

  registrar.registerHandler('list_storyboard_projects', async () => ({
    projects: await listStoryboardProjectsFromAgent(),
  }))

  registrar.registerHandler('get_storyboard_project', async (input) => {
    const parsed = parseCapabilityInput<ProjectInput>('get_storyboard_project', input)
    return { project: await getStoryboardProjectFromAgent(parsed.projectId) }
  })
}
