import type { ApplicationTransactionResult, JsonValue } from '@/core/application-control/index'
import { cameraStageApplicationService, type CameraStageObjectUpdate } from '@/features/cameraStage/application/cameraStageApplicationService'
import { verifyCameraStageScene, type CameraStageVerificationRequest } from '@/features/cameraStage/application/cameraStageVerification'

import { getHostScopeRevisions, notifyHostScopeChanged } from '@/features/application-control/hostContext/hostContext'

import { CONFLICT_RECOVERY } from '@/core/application-control/domains/cameraStage/cameraStageCapabilitySchemas'

import type { CapabilityExecutionContext } from '@/features/application-control/capabilities/handlerTypes'

const permissions = new Set(['camera_stage:read', 'camera_stage:write', 'camera_stage:delete'])

function baseRevision(): number {
  return getHostScopeRevisions().camera_stage
}

export function assertCameraStageRevision(context: CapabilityExecutionContext): number {
  const expected = context.expectedRevisions?.camera_stage
  if (expected === undefined || baseRevision() !== expected) throw new Error(`CONFLICT:${CONFLICT_RECOVERY}`)
  return expected
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

function completedTransaction(result: ApplicationTransactionResult): Extract<ApplicationTransactionResult, { status: 'completed' }> {
  if (result.status === 'completed') return result
  if (result.status === 'failed') throw new Error(result.code === 'CONFLICT' ? `CONFLICT:${CONFLICT_RECOVERY}` : result.message)
  throw new Error('CAPABILITY_REJECTED')
}

async function executeOperation(
  capabilityId: 'place_camera_stage_object' | 'apply_camera_stage_camera_move',
  input: JsonValue,
  revision: number,
  context: CapabilityExecutionContext,
  evidenceFact: string,
): Promise<Record<string, unknown>> {
  assertCameraStageRevision(context)
  const engine = context.getExecutionEngine?.()
  if (!engine) throw new Error('CAPABILITY_NOT_READY:事务引擎尚未装配。')
  const appContext = executionContext(context)
  const plan = await engine.plan({
    summary: capabilityId === 'place_camera_stage_object' ? '复用或布置三维场景对象' : '应用摄像机语义运镜',
    transactionMode: 'atomic',
    steps: [{ kind: 'operation', capabilityId, capabilityVersion: 1, input, expectedRevisions: { camera_stage: revision } }],
    verificationConditions: [{ kind: 'evidence_fact', fact: evidenceFact }],
  }, appContext)
  const result = completedTransaction(await engine.commit({
    planRef: plan.planRef,
    expectedRevisions: { camera_stage: revision },
    idempotencyKey: idempotencyKey(capabilityId, revision, context),
  }, appContext)) as unknown as Record<string, unknown>
  return result
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
  assertCameraStageRevision(context)
  const engine = context.getExecutionEngine?.()
  if (!engine) throw new Error('CAPABILITY_NOT_READY:事务引擎尚未装配。')
  const appContext = executionContext(context)
  const plan = await engine.plan({
    summary: input.summary,
    transactionMode: 'atomic',
    steps: [{
      kind: 'mutation',
      target: { kind: input.entityType, id: input.targetId },
      entityType: input.entityType,
      expectedRevisions: { camera_stage: input.revision },
      mutations: input.mutations,
    }],
  }, appContext)
  const result = completedTransaction(await engine.commit({
    planRef: plan.planRef,
    expectedRevisions: { camera_stage: input.revision },
    idempotencyKey: idempotencyKey(input.entityType, input.revision, context),
  }, appContext)) as unknown as Record<string, unknown>
  return result
}

function mutation(propertyId: string, value: JsonValue) {
  return { propertyId, operation: 'set' as const, value }
}

function vec3Value(value: { x: number; y: number; z: number }): JsonValue {
  return { x: value.x, y: value.y, z: value.z }
}

export async function observeCameraStageScene(projectId: string): Promise<Record<string, unknown>> {
  const scene = await cameraStageApplicationService.observeProject(projectId)
  return { scene: { documentId: projectId, ...scene } }
}

export async function placeCameraStageObject(input: Record<string, unknown>, context: CapabilityExecutionContext): Promise<Record<string, unknown>> {
  const revision = assertCameraStageRevision(context)
  const operationInput = input
  return await executeOperation('place_camera_stage_object', operationInput as JsonValue, revision, context, '三维场景对象已按复用与空间约束处理。')
}

export async function duplicateCameraStageObject(input: { projectId: string; objectId: string }, context: CapabilityExecutionContext): Promise<Record<string, unknown>> {
  assertCameraStageRevision(context)
  const before = await cameraStageApplicationService.readSnapshot(input.projectId)
  const source = before.objects.find(object => object.id === input.objectId)
  const result = await cameraStageApplicationService.duplicateObject(input.projectId, input.objectId)
  notifyHostScopeChanged('camera_stage')
  const after = await cameraStageApplicationService.readSnapshot(input.projectId)
  const created = after.objects.find(object => object.id === result.objectId)
  const verified = Boolean(source && created && !before.objects.some(object => object.id === created.id)
    && JSON.stringify({ ...source, id: created.id, name: created.name }) === JSON.stringify(created))
  return { projectId: result.projectId, objectId: result.objectId, duplicatedFromObjectId: result.duplicatedFromObjectId, undoRef: result.undoToken,
    verification: { verified, condition: '从正式场景回读副本，确认新身份及源对象属性一致。', target: { kind: created?.type === 'camera' ? 'camera_stage.camera' : 'camera_stage.object', id: `${input.projectId}:${result.objectId}` } } }
}

export async function deleteCameraStageObject(input: { projectId: string; objectId: string }, context: CapabilityExecutionContext): Promise<Record<string, unknown>> {
  assertCameraStageRevision(context)
  const before = await cameraStageApplicationService.readSnapshot(input.projectId)
  const kind = before.objects.find(object => object.id === input.objectId)?.type === 'camera' ? 'camera_stage.camera' : 'camera_stage.object'
  const result = await cameraStageApplicationService.deleteObject(input.projectId, input.objectId)
  notifyHostScopeChanged('camera_stage')
  const snapshot = await cameraStageApplicationService.readSnapshot(input.projectId)
  const verified = !snapshot.objects.some(object => object.id === input.objectId)
    && snapshot.stateKeyframes.every(frame => !frame.objectStates[input.objectId])
  return { ...result, verification: { verified, condition: '从正式场景回读确认对象及状态关键帧中的对象状态已删除。', target: { kind, id: `${input.projectId}:${input.objectId}` } } }
}

export async function updateCameraStageObject(
  input: { projectId: string; objectId: string; changes: CameraStageObjectUpdate },
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
  return await executeMutation({ summary: '更新三维对象属性', entityType, targetId: `${input.projectId}:${input.objectId}`, mutations, revision: assertCameraStageRevision(context) }, context)
}

export async function applyCameraStageCameraMove(input: Record<string, unknown>, context: CapabilityExecutionContext): Promise<Record<string, unknown>> {
  const revision = assertCameraStageRevision(context)
  const operationInput = input
  return await executeOperation('apply_camera_stage_camera_move', operationInput as JsonValue, revision, context, '三维摄像机运镜已应用。')
}

export async function verifyCameraStage(
  input: CameraStageVerificationRequest,
): Promise<Record<string, unknown>> {
  return { ...await verifyCameraStageScene(input) }
}
