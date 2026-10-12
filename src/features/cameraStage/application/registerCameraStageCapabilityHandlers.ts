import { configureCameraStageControlDependencies } from './cameraStageControlDependencies'
import { organizeCameraIntentCapability, applyCameraIntentCapability } from '@/core/application-control/domains/cameraStage/cameraStageIntentCapabilities'
import { organizeCameraMotion, applyCameraMotion, cameraMotionDraft } from './cameraMotionDraft'
import { cameraStageProjectStore, ensureCameraStageProjectRuntime } from './cameraStageProjectRuntime'
import { getHostScopeRevisions, notifyHostScopeChanged } from '@/features/application-control/hostContext/hostContext'

import { CAMERA_STAGE_RENDER_CAPABILITY_ID, CANCEL_CAMERA_STAGE_RENDER_TASK_CAPABILITY_ID, GET_CAMERA_STAGE_RENDER_TASK_CAPABILITY_ID, WAIT_CAMERA_STAGE_RENDER_TASK_CAPABILITY_ID, RECOVER_CAMERA_STAGE_RENDER_TASK_CAPABILITY_ID } from '@/core/application-control/domains/cameraStage/cameraStageRenderApplicationCapabilities'

import type { ApplicationCapabilityHandlerRegistrar } from '@/features/application-control/capabilities/handlerTypes'

import { parseDocumentCapabilityInput as parseCapabilityInput, throwIfCapabilityAborted, withDocumentIdOutput } from '@/features/application-control/capabilities/handlerUtils'
import { openApplicationSurface } from '@/features/navigation/application/surfaceCapabilityService'
import { assertCameraStageRevision, applyCameraStageCameraMove, deleteCameraStageObject, duplicateCameraStageObject, observeCameraStageScene, placeCameraStageObject, updateCameraStageObject, verifyCameraStage } from '@/features/cameraStage/application/cameraStageCapabilityAdapter'
import { releaseCameraStageProjectInstance } from '@/features/cameraStage/application/cameraStageProjectRuntime'
import { createDraftCameraStageDocument, openCameraStageDocument } from '@/features/cameraStage/projects/cameraStageProjectService'
import { getDocumentSessionRegistry } from '@/features/documents/documentSessionRegistry'
import { getDocumentOperations, registerDocumentCreator, registerDocumentOpener, registerDocumentReleaser } from '@/features/documents/documentOperations'
import { cancelCameraStageRenderTask, getCameraStageRenderTask, renderCameraStageOutput, waitCameraStageRenderTask, recoverCameraStageRenderTask } from '@/features/cameraStage/application/cameraStageRenderCapabilityAdapter'

interface ProjectInput {
  projectId: string
}

interface CameraObjectInput extends ProjectInput {
  objectId: string
}

/**
 * 镜头参考内容能力的处理器。公共契约里的 `documentId`（镜头参考文档 ID）在取参时换成领域服务使用的 `projectId`，
 * 结果顶层的 `projectId` 换回 `documentId`（见 handlerUtils 的说明）。
 */
export function registerCameraStageCapabilityHandlers(publicRegistrar: ApplicationCapabilityHandlerRegistrar): void {
  const registrar = withDocumentIdOutput(publicRegistrar)
  publicRegistrar.registerHandler(organizeCameraIntentCapability.id, async (raw, context) => {
    context.signal.throwIfAborted()
    const input = organizeCameraIntentCapability.inputSchema.parse(raw), projectId = input.documentRef.id
    await ensureCameraStageProjectRuntime(projectId)
    const child = (ref: { id: string }): string => { const prefix = `${projectId}:`; if (!ref.id.startsWith(prefix) || !ref.id.slice(prefix.length)) throw new Error('机位和状态关键帧必须属于目标文档。'); return ref.id.slice(prefix.length) }
    const review = await organizeCameraMotion(projectId, child(input.cameraRef), input.stateKeyframeRefs.map(child))
    return { baseRevision: getHostScopeRevisions().toolbox, resultRef: input.documentRef, reviewId: cameraMotionDraft(projectId)!.reviewId!, ...review, revision: getHostScopeRevisions().toolbox, scopeRevisions: getHostScopeRevisions() }
  })
  publicRegistrar.registerHandler(applyCameraIntentCapability.id, async (raw, context) => {
    context.signal.throwIfAborted()
    const input = applyCameraIntentCapability.inputSchema.parse(raw), projectId = input.documentRef.id
    assertCameraStageRevision(context)
    if (cameraMotionDraft(projectId)?.reviewId !== input.reviewId) throw new Error('候选已失效，请重新整理。')
    const result = await applyCameraMotion(projectId, input.candidateId)
    notifyHostScopeChanged('toolbox')
    return { ...result, baseRevision: getHostScopeRevisions().toolbox, resultRef: input.documentRef, stateKeyframeRefs: cameraStageProjectStore(projectId).getState().stateKeyframes.map(frame => ({ kind: 'camera_stage.state_keyframe', id: `${projectId}:${frame.id}` })), revision: getHostScopeRevisions().toolbox, scopeRevisions: getHostScopeRevisions() }
  })
  configureCameraStageControlDependencies({
    readRevision: () => getHostScopeRevisions().toolbox,
    bumpRevision: () => notifyHostScopeChanged('toolbox'),
  })
  // 镜头参考文档的通用打开与后台释放（3.2）：列表、管理与打开走通用文档能力（list_documents / open_document 等），
  // 这里只登记“打开到哪里”和“后台持有的实例怎么释放”。
  registerDocumentOpener('camera_stage', async (document) => {
    await openCameraStageDocument({ id: document.id, path: document.path })
    openApplicationSurface('tool.camera_stage')
  })
  registerDocumentReleaser('camera_stage', releaseCameraStageProjectInstance)
  registerDocumentCreator('camera_stage', async (container) => {
    const created = await createDraftCameraStageDocument(container)
    openApplicationSurface('tool.camera_stage')
    return getDocumentSessionRegistry().get(created.id)?.documentMeta ?? (await getDocumentOperations().readDocument({ id: created.id })).meta
  })

  registrar.registerHandler('observe_camera_stage_scene', async (input) => {
    const parsed = parseCapabilityInput<ProjectInput>('observe_camera_stage_scene', input)
    return await observeCameraStageScene(parsed.projectId)
  })

  registrar.registerHandler('place_camera_stage_object', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<Record<string, unknown>>('place_camera_stage_object', input)
    return await placeCameraStageObject(parsed, context)
  })

  registrar.registerHandler('duplicate_camera_stage_object', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<CameraObjectInput>(
      'duplicate_camera_stage_object',
      input
    )
    return await duplicateCameraStageObject(parsed, context)
  })

  registrar.registerHandler('delete_camera_stage_object', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<CameraObjectInput>('delete_camera_stage_object', input)
    return await deleteCameraStageObject(parsed, context)
  })

  registrar.registerHandler('update_camera_stage_object', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<CameraObjectInput & {
      changes: Parameters<typeof updateCameraStageObject>[0]['changes']
    }>('update_camera_stage_object', input)
    return await updateCameraStageObject(parsed, context)
  })

  registrar.registerHandler('apply_camera_stage_camera_move', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<Record<string, unknown>>('apply_camera_stage_camera_move', input)
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
