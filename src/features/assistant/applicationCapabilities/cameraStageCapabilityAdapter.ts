import type { ApplicationTransactionResult, JsonValue } from '@/core/application-control'
import { cameraStageApplicationService, type CameraStageObjectUpdate } from '@/features/cameraStage/application/cameraStageApplicationService'
import { verifyCameraStageScene, type CameraStageVerificationRequest } from '@/features/cameraStage/application/cameraStageVerification'
import { useCameraStageSessionStore } from '@/features/cameraStage/store/cameraStageSessionStore'
import { useCameraStageStore } from '@/features/cameraStage/store/cameraStageStore'

import { getHostScopeRevisions, notifyHostScopeChanged } from '../hostContext/hostContext'
import {
  configureCameraStageControlDependencies,
  getApplicationControlExecutionEngine,
} from './applicationControlRegistry'
import type { CapabilityExecutionContext } from './handlerTypes'

const permissions = new Set(['camera_stage:read', 'camera_stage:write', 'camera_stage:open', 'camera_stage:delete'])

configureCameraStageControlDependencies({
  readRevision: () => getHostScopeRevisions().toolbox,
  bumpRevision: () => notifyHostScopeChanged('toolbox'),
})

function baseRevision(): number {
  return getHostScopeRevisions().toolbox
}

function assertBaseRevision(expected: number): void {
  if (baseRevision() !== expected) throw new Error('CONFLICT')
}

function executionContext(context: CapabilityExecutionContext) {
  return {
    exposure: 'assistant' as const,
    permissions,
    acceptedDataClasses: new Set(['C1'] as const),
    requestId: context.requestId ?? `camera-stage-${Date.now()}`,
    signal: context.signal,
  }
}

function idempotencyKey(capabilityId: string, revision: number, context: CapabilityExecutionContext): string {
  return `${capabilityId}:${context.requestId ?? context.taskId ?? 'renderer'}:${revision}`.padEnd(16, '0').slice(0, 256)
}

/**
 * 所有三维写入都必须回带写入后的 `baseRevision`。
 *
 * 走事务引擎的能力（摆放、运镜、改名、改属性）此前只返回 `resultingRevisions` 这个映射，
 * 而不走事务的能力（新建、复制、删除、打开）返回的是扁平的 `baseRevision`——同一个领域里
 * 同一个概念两种形状。结果是模型每摆一个物体就得再读一次工程才能拿到下一次写入要用的
 * revision，本来一步的事变成两步。叠加单轮 8 个工具位的轮换，读的那个工具下一轮往往就
 * 不在了，任务就卡死在这里。
 */
function withBaseRevision(result: Record<string, unknown>): Record<string, unknown> {
  return { ...result, baseRevision: baseRevision() }
}

function completedTransaction(result: ApplicationTransactionResult): Extract<ApplicationTransactionResult, { status: 'completed' }> {
  if (result.status === 'completed') return result
  if (result.status === 'failed') throw new Error(result.code === 'CONFLICT' ? 'CONFLICT' : result.message)
  throw new Error('CAPABILITY_REJECTED')
}

async function executeOperation(
  capabilityId: 'place_camera_stage_object' | 'apply_camera_stage_camera_move',
  input: JsonValue,
  revision: number,
  context: CapabilityExecutionContext,
  evidenceFact: string,
): Promise<Record<string, unknown>> {
  assertBaseRevision(revision)
  const engine = getApplicationControlExecutionEngine()
  const appContext = executionContext(context)
  const plan = await engine.plan({
    summary: capabilityId === 'place_camera_stage_object' ? '复用或布置三维场景对象' : '应用摄像机语义运镜',
    transactionMode: 'atomic',
    steps: [{ kind: 'operation', capabilityId, capabilityVersion: 1, input, expectedRevisions: { toolbox: revision } }],
    verificationConditions: [{ kind: 'evidence_fact', fact: evidenceFact }],
  }, appContext)
  const result = completedTransaction(await engine.commit({
    planRef: plan.planRef,
    expectedRevisions: { toolbox: revision },
    idempotencyKey: idempotencyKey(capabilityId, revision, context),
  }, appContext)) as unknown as Record<string, unknown>
  return withBaseRevision(result)
}

async function executeMutation(
  input: {
    summary: string
    entityType: string
    targetId: string
    mutations: Array<{ propertyId: string; operation: 'set'; value: JsonValue }>
    revision: number
  },
  context: CapabilityExecutionContext,
): Promise<Record<string, unknown>> {
  assertBaseRevision(input.revision)
  const engine = getApplicationControlExecutionEngine()
  const appContext = executionContext(context)
  const plan = await engine.plan({
    summary: input.summary,
    transactionMode: 'atomic',
    steps: [{
      kind: 'mutation',
      target: { kind: input.entityType, id: input.targetId },
      entityType: input.entityType,
      expectedRevisions: { toolbox: input.revision },
      mutations: input.mutations,
    }],
  }, appContext)
  const result = completedTransaction(await engine.commit({
    planRef: plan.planRef,
    expectedRevisions: { toolbox: input.revision },
    idempotencyKey: idempotencyKey(input.entityType, input.revision, context),
  }, appContext)) as unknown as Record<string, unknown>
  return withBaseRevision(result)
}

function mutation(propertyId: string, value: JsonValue) {
  return { propertyId, operation: 'set' as const, value }
}

function vec3Value(value: { x: number; y: number; z: number }): JsonValue {
  return { x: value.x, y: value.y, z: value.z }
}

export async function listCameraStageProjects(): Promise<Record<string, unknown>> {
  return { projects: await cameraStageApplicationService.listProjects(), baseRevision: baseRevision() }
}

export async function getCameraStageProject(projectId: string): Promise<Record<string, unknown>> {
  const scene = await cameraStageApplicationService.observeProject(projectId)
  return { project: { id: projectId, ...scene }, baseRevision: baseRevision() }
}

export async function observeCameraStageScene(projectId: string): Promise<Record<string, unknown>> {
  const scene = await cameraStageApplicationService.observeProject(projectId)
  return { scene: { projectId, ...scene }, baseRevision: baseRevision() }
}

export async function openCameraStageProject(projectId: string): Promise<Record<string, unknown>> {
  const result = await cameraStageApplicationService.openProject(projectId)
  useCameraStageSessionStore.getState().setAppView('editor')
  notifyHostScopeChanged('toolbox')
  return { ...result, baseRevision: baseRevision() }
}

export async function createCameraStageProject(name: string, mode: 'simple' | 'pro'): Promise<Record<string, unknown>> {
  const result = await cameraStageApplicationService.createProject(name, mode)
  useCameraStageSessionStore.getState().setAppView('editor')
  notifyHostScopeChanged('toolbox')
  const state = useCameraStageStore.getState()
  const defaultCameraId = state.activeCameraId
  const defaultShotId = state.shots[0]?.id
  if (!defaultCameraId || !defaultShotId) throw new Error('CAPABILITY_REJECTED')
  return { ...result, defaultCameraId, defaultShotId, baseRevision: baseRevision() }
}

export async function renameCameraStageProject(input: { projectId: string; name: string; baseRevision: number }, context: CapabilityExecutionContext): Promise<Record<string, unknown>> {
  return await executeMutation({
    summary: '重命名三维工程', entityType: 'camera_stage.project', targetId: input.projectId, revision: input.baseRevision,
    mutations: [mutation('camera_stage.project.name', input.name)],
  }, context)
}

export async function deleteCameraStageProject(input: { projectId: string; baseRevision: number }): Promise<Record<string, unknown>> {
  assertBaseRevision(input.baseRevision)
  const result = await cameraStageApplicationService.deleteProject(input.projectId)
  notifyHostScopeChanged('toolbox')
  return { ...result, baseRevision: baseRevision() }
}

export async function placeCameraStageObject(input: Record<string, unknown> & { baseRevision: number }, context: CapabilityExecutionContext): Promise<Record<string, unknown>> {
  const { baseRevision: revision, ...operationInput } = input
  return await executeOperation('place_camera_stage_object', operationInput as JsonValue, revision, context, '三维场景对象已按复用与空间约束处理。')
}

export async function duplicateCameraStageObject(input: { projectId: string; objectId: string; baseRevision: number }): Promise<Record<string, unknown>> {
  assertBaseRevision(input.baseRevision)
  const result = await cameraStageApplicationService.duplicateObject(input.projectId, input.objectId)
  notifyHostScopeChanged('toolbox')
  return { projectId: result.projectId, objectId: result.objectId, duplicatedFromObjectId: result.duplicatedFromObjectId, undoRef: result.undoToken, baseRevision: baseRevision() }
}

export async function deleteCameraStageObject(input: { projectId: string; objectId: string; baseRevision: number }): Promise<Record<string, unknown>> {
  assertBaseRevision(input.baseRevision)
  const result = await cameraStageApplicationService.deleteObject(input.projectId, input.objectId)
  notifyHostScopeChanged('toolbox')
  return { ...result, baseRevision: baseRevision() }
}

export async function updateCameraStageObject(
  input: { projectId: string; objectId: string; baseRevision: number; changes: CameraStageObjectUpdate },
  context: CapabilityExecutionContext,
): Promise<Record<string, unknown>> {
  const snapshot = await cameraStageApplicationService.readSnapshot(input.projectId)
  const object = snapshot.objects.find((candidate) => candidate.id === input.objectId)
  if (!object) throw new Error('NOT_FOUND')
  const entityType = object.type === 'camera' ? 'camera_stage.camera' : 'camera_stage.object'
  const prefix = entityType
  const changes = input.changes
  const mutations = [
    ...(changes.name !== undefined ? [mutation(`${prefix}.name`, changes.name)] : []),
    ...(changes.visible !== undefined ? [mutation(`${prefix}.visible`, changes.visible)] : []),
    ...(changes.color !== undefined ? [mutation(`${prefix}.color`, changes.color)] : []),
    ...(changes.transform?.position ? [mutation(`${prefix}.transform.position`, vec3Value(changes.transform.position))] : []),
    ...(changes.transform?.rotation ? [mutation(`${prefix}.transform.rotation`, vec3Value(changes.transform.rotation))] : []),
    ...(changes.transform?.scale ? [mutation(`${prefix}.transform.scale`, vec3Value(changes.transform.scale))] : []),
    ...(changes.variant !== undefined ? [mutation('camera_stage.object.character_variant', changes.variant)] : []),
    ...(changes.fov !== undefined ? [mutation('camera_stage.camera.fov', changes.fov)] : []),
    ...(changes.lookAt?.mode === 'manual' ? [mutation('camera_stage.camera.look_at_target', vec3Value(changes.lookAt.target))] : []),
    ...(changes.lookAt?.mode === 'object' ? [mutation('camera_stage.camera.look_at_object_ref', { kind: 'camera_stage.object', id: `${input.projectId}:${changes.lookAt.objectId}` })] : []),
    ...(changes.aspectRatio ? [
      mutation('camera_stage.camera.aspect_ratio_preset', changes.aspectRatio.preset),
      mutation('camera_stage.camera.aspect_ratio', changes.aspectRatio.ratio),
    ] : []),
  ]
  if (mutations.length === 0 || changes.effectors) throw new Error('INVALID_INPUT')
  return await executeMutation({ summary: '更新三维对象属性', entityType, targetId: `${input.projectId}:${input.objectId}`, mutations, revision: input.baseRevision }, context)
}

export async function applyCameraStageCameraMove(input: Record<string, unknown> & { baseRevision: number }, context: CapabilityExecutionContext): Promise<Record<string, unknown>> {
  const { baseRevision: revision, ...operationInput } = input
  return await executeOperation('apply_camera_stage_camera_move', operationInput as JsonValue, revision, context, '三维摄像机运镜已应用。')
}

export async function verifyCameraStage(
  input: CameraStageVerificationRequest,
): Promise<Record<string, unknown>> {
  return { ...await verifyCameraStageScene(input), baseRevision: baseRevision() }
}
