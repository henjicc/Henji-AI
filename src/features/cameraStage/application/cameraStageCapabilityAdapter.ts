import type { ApplicationControlExecutionEngine, ApplicationTransactionResult, JsonValue } from '@/core/application-control/index'
import { z } from 'zod'
import { cameraStageCheckIntentShape } from '@/core/application-control/domains/cameraStage/cameraStageCoverageSchemas'
import { COVERAGE_FACT, CUT_FACT } from './cameraStageCoverageExecutors'
import { checkCameraStageEdit } from './editService'

import { cameraStageApplicationService } from '@/features/cameraStage/application/cameraStageApplicationService'
import { verifyCameraStageScene, type CameraStageVerificationRequest } from '@/features/cameraStage/application/cameraStageVerification'

import { getHostScopeRevisions, notifyHostScopeChanged } from '@/features/application-control/hostContext/hostContext'

import { CONFLICT_RECOVERY } from '@/core/application-control/domains/cameraStage/cameraStageCapabilitySchemas'
import { ApplicationTransactionFailure } from '@/core/application-control/execution/transactionFailure'
import { applicationWritePreflight } from '@/core/application-control/execution/writeExecution'

import type { CapabilityExecutionContext } from '@/features/application-control/capabilities/handlerTypes'

const cameraStageCheckInputSchema = z.object({ projectId: z.string().min(1), ...cameraStageCheckIntentShape }).strict()

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

/*
 * 引擎的失败回执带着“哪几步已提交、是否补偿、有无存盘”的事实，执行层靠它区分“写入前就被拒绝”和“结果未知”。
 * 压成普通 Error 会让布景参数不合法、对象不存在这类前置拒绝也被记成结果未知，挡住重试并请用户核对。
 */
function completedTransaction(result: ApplicationTransactionResult): Extract<ApplicationTransactionResult, { status: 'completed' }> {
  if (result.status === 'completed') return result
  if (result.status === 'failed') {
    // 还有未补偿的写入时重新读取后重试会叠加写入，只有可重试的冲突才附上重试办法。
    throw new ApplicationTransactionFailure(result.code === 'CONFLICT' && result.recoverable ? { ...result, message: `${result.message}${CONFLICT_RECOVERY}` } : result)
  }
  throw new Error('CAPABILITY_REJECTED')
}

const OPERATION_SUMMARIES = {
  place_camera_stage_object: '复用或布置三维场景对象',
  apply_camera_stage_camera_move: '应用摄像机语义运镜',
  generate_camera_stage_set: '生成三维布景',
  compose_camera_stage_shot: '按构图意图摆机位',
  block_camera_stage_character: '编排角色走位与动作',
  follow_camera_stage_character: '摄像机跟拍角色',
  cover_camera_stage_scene: '布置多机位覆盖',
  cut_camera_stage_coverage: '按节拍剪辑切机位',
} as const

type CameraStagePlanRequest = Parameters<ApplicationControlExecutionEngine['plan']>[0]

/**
 * 修订核对、引擎就绪与计划校验都在提交之前，放进写入准备阶段，拒绝才会被记为未执行；
 * 提交之后的失败由引擎回执说明实际执行到哪一步。
 */
async function planAndCommit(context: CapabilityExecutionContext, idempotencyName: string,
  request: (revision: number) => CameraStagePlanRequest): Promise<Record<string, unknown>> {
  const appContext = executionContext(context)
  const { engine, plan, revision } = await applicationWritePreflight(context, async () => {
    const revision = assertCameraStageRevision(context)
    const engine = context.getExecutionEngine?.()
    if (!engine) throw new Error('CAPABILITY_NOT_READY:事务引擎尚未装配。')
    return { engine, revision, plan: await engine.plan(request(revision), appContext) }
  })
  return completedTransaction(await engine.commit({
    planRef: plan.planRef,
    expectedRevisions: { camera_stage: revision },
    idempotencyKey: idempotencyKey(idempotencyName, revision, context),
  }, appContext)) as unknown as Record<string, unknown>
}

async function executeOperation(
  capabilityId: keyof typeof OPERATION_SUMMARIES,
  input: JsonValue,
  context: CapabilityExecutionContext,
  evidenceFact: string,
): Promise<Record<string, unknown>> {
  return await planAndCommit(context, capabilityId, revision => ({
    summary: OPERATION_SUMMARIES[capabilityId],
    transactionMode: 'atomic',
    steps: [{ kind: 'operation', capabilityId, capabilityVersion: 1, input, expectedRevisions: { camera_stage: revision } }],
    verificationConditions: [{ kind: 'evidence_fact', fact: evidenceFact }],
  }))
}

/** 对象不存在是写入前的拒绝；放在 applicationWritePreflight 里调用，执行层才会记为未执行。 */
function requireSceneObject<T extends { objects: Array<{ id: string }> }>(snapshot: T, objectId: string): T['objects'][number] {
  const object = snapshot.objects.find(candidate => candidate.id === objectId)
  if (!object) throw new Error(`NOT_FOUND:对象 «${objectId}» 不在本场景中，objectId 取自 observe_camera_stage_scene 返回的 objects[].id 原值。`)
  return object
}

export async function observeCameraStageScene(projectId: string, times: readonly number[] = []): Promise<Record<string, unknown>> {
  const scene = await cameraStageApplicationService.observeProject(projectId, times)
  return { scene: { documentId: projectId, ...scene } }
}

export async function placeCameraStageObject(input: Record<string, unknown>, context: CapabilityExecutionContext): Promise<Record<string, unknown>> {
  return await executeOperation('place_camera_stage_object', input as JsonValue, context, '三维场景对象已按复用与空间约束处理。')
}

export async function generateCameraStageSet(input: Record<string, unknown>, context: CapabilityExecutionContext): Promise<Record<string, unknown>> {
  return await executeOperation('generate_camera_stage_set', input as JsonValue, context, '三维布景已生成。')
}

function withoutSetId<T extends { setId?: string }>(object: T): Omit<T, 'setId'> {
  const { setId: _setId, ...rest } = object
  return rest
}

export async function duplicateCameraStageObject(input: { projectId: string; objectId: string }, context: CapabilityExecutionContext): Promise<Record<string, unknown>> {
  const { before, source } = await applicationWritePreflight(context, async () => {
    assertCameraStageRevision(context)
    const before = await cameraStageApplicationService.readSnapshot(input.projectId)
    return { before, source: requireSceneObject(before, input.objectId) }
  })
  const result = await cameraStageApplicationService.duplicateObject(input.projectId, input.objectId)
  notifyHostScopeChanged('camera_stage')
  const after = await cameraStageApplicationService.readSnapshot(input.projectId)
  const created = after.objects.find(object => object.id === result.objectId)
  const verified = Boolean(created && !before.objects.some(object => object.id === created.id)
    // 副本不随布景重新生成，所以不带 setId；其余属性应与源对象一致。
    && JSON.stringify(withoutSetId({ ...source, id: created.id, name: created.name })) === JSON.stringify(created))
  return { projectId: result.projectId, objectId: result.objectId, duplicatedFromObjectId: result.duplicatedFromObjectId, undoRef: result.undoToken,
    verification: { verified, condition: '从正式场景回读副本，确认新身份及源对象属性一致。', target: { kind: created?.type === 'camera' ? 'camera_stage.camera' : 'camera_stage.object', id: `${input.projectId}:${result.objectId}` } } }
}

export async function deleteCameraStageObject(input: { projectId: string; objectId: string }, context: CapabilityExecutionContext): Promise<Record<string, unknown>> {
  const kind = await applicationWritePreflight(context, async () => {
    assertCameraStageRevision(context)
    const object = requireSceneObject(await cameraStageApplicationService.readSnapshot(input.projectId), input.objectId)
    return object.type === 'camera' ? 'camera_stage.camera' : 'camera_stage.object'
  })
  const result = await cameraStageApplicationService.deleteObject(input.projectId, input.objectId)
  notifyHostScopeChanged('camera_stage')
  const snapshot = await cameraStageApplicationService.readSnapshot(input.projectId)
  const verified = !snapshot.objects.some(object => object.id === input.objectId)
    && snapshot.stateKeyframes.every(frame => !frame.objectStates[input.objectId])
  return { ...result, verification: { verified, condition: '从正式场景回读确认对象及状态关键帧中的对象状态已删除。', target: { kind, id: `${input.projectId}:${input.objectId}` } } }
}

export async function applyCameraStageCameraMove(input: Record<string, unknown>, context: CapabilityExecutionContext): Promise<Record<string, unknown>> {
  return await executeOperation('apply_camera_stage_camera_move', input as JsonValue, context, '三维摄像机运镜已应用。')
}

/**
 * 构图读回是这个能力的主要结果，从执行器证据提到结果顶层：外部客户端默认不展开证据，
 * 留在证据里等于看不到景别、位置与遮挡。证据只留机位引用，不重复整份读回。
 */
export async function composeCameraStageShotOperation(input: Record<string, unknown>, context: CapabilityExecutionContext): Promise<Record<string, unknown>> {
  const transaction = await executeOperation('compose_camera_stage_shot', input as JsonValue, context, '三维摄像机已按构图意图摆好。')
  const evidence = transaction.evidence as Array<Record<string, unknown>>
  // 执行器每次都把读回放在证据里。
  const index = evidence.findIndex(item => Array.isArray((item.data as { shots?: unknown } | undefined)?.shots))
  const readback = evidence[index].data as Record<string, unknown> & { shots: Array<{ cameraId: string }> }
  return {
    ...transaction,
    ...readback,
    evidence: evidence.map((item, position) => position === index
      ? { ...item, data: { cameraIds: readback.shots.map(shot => shot.cameraId), stateKeyframeId: readback.stateKeyframeId } }
      : item),
  }
}

/**
 * 走位与跟拍的读回同样从执行器证据提到结果顶层；证据只留引用。
 */
async function timelineOperation(capabilityId: 'block_camera_stage_character' | 'follow_camera_stage_character' | 'cover_camera_stage_scene' | 'cut_camera_stage_coverage', input: Record<string, unknown>, context: CapabilityExecutionContext, fact: string): Promise<Record<string, unknown>> {
  const transaction = await executeOperation(capabilityId, input as JsonValue, context, fact)
  const evidence = transaction.evidence as Array<Record<string, unknown>>
  const index = evidence.findIndex(item => item.fact === fact)
  const readback = evidence[index].data as Record<string, unknown>
  return {
    ...transaction,
    ...readback,
    evidence: evidence.map((item, position) => position === index ? { ...item, data: { target: item.target ?? null } } : item),
  }
}

export async function blockCameraStageCharacterOperation(input: Record<string, unknown>, context: CapabilityExecutionContext): Promise<Record<string, unknown>> {
  return await timelineOperation('block_camera_stage_character', input, context, '角色走位与动作已写进时间轴。')
}

export async function followCameraStageCharacterOperation(input: Record<string, unknown>, context: CapabilityExecutionContext): Promise<Record<string, unknown>> {
  return await timelineOperation('follow_camera_stage_character', input, context, '摄像机跟拍已写进时间轴。')
}

export async function coverCameraStageSceneOperation(input: Record<string, unknown>, context: CapabilityExecutionContext): Promise<Record<string, unknown>> {
  return await timelineOperation('cover_camera_stage_scene', input, context, COVERAGE_FACT)
}

export async function cutCameraStageCoverageOperation(input: Record<string, unknown>, context: CapabilityExecutionContext): Promise<Record<string, unknown>> {
  return await timelineOperation('cut_camera_stage_coverage', input, context, CUT_FACT)
}

export async function checkCameraStageEditQuery(input: { projectId: string } & Record<string, unknown>): Promise<Record<string, unknown>> {
  const parsed = cameraStageCheckInputSchema.parse(input)
  return { ...await checkCameraStageEdit(parsed) }
}

export async function verifyCameraStage(
  input: CameraStageVerificationRequest,
): Promise<Record<string, unknown>> {
  return { ...await verifyCameraStageScene(input) }
}
