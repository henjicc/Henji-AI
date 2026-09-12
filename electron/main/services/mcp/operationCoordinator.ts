import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '../../../../src/core/assistant/builtinApplicationCapabilityRegistry'
import { z } from 'zod'
import type { LocalHostReply } from '../../../../src/core/application-control/localHostContracts'
import { McpOperationStore, operationDigest, type OperationRecord } from './operationStore'

const refSchema = z.object({ kind: z.string(), id: z.string() }).passthrough()
const envelopeSchema = z.object({ operationId: z.string().uuid(), baselineIds: z.array(z.string().uuid()).min(1).max(32) })
const writableDomain = (type: string): boolean => type === 'settings.registry' || type.startsWith('generation.') || type === 'asset' || ['asset.', 'canvas.', 'camera_stage.', 'image_edit.', 'image_mark.'].some((prefix) => type.startsWith(prefix))
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

function resultRefs(value: unknown): Array<{ kind: string; id: string }> {
  if (Array.isArray(value)) return value.flatMap(resultRefs)
  if (!value || typeof value !== 'object') return []
  const parsed = refSchema.safeParse(value)
  return parsed.success ? [{ kind: parsed.data.kind, id: parsed.data.id }] : Object.values(value).flatMap(resultRefs)
}

/** 业务事实独立于 HTTP 等待；读取不会关闭任何写操作的未知/部分状态。 */
export class McpOperationCoordinator {
  constructor(readonly store: McpOperationStore, private readonly recoverPersisted?: (record: OperationRecord) => OperationRecord | undefined) {
    store.recoverInterrupted()
    for (const record of store.unresolved()) {
      const recovered = recoverPersisted?.(record)
      if (recovered) store.save(recovered)
    }
  }
  rememberRead(callerId: string, result: Record<string, unknown>, sessionId: string): Record<string, unknown> {
    if (result.ok !== true) return result
    const data = object(result.data)
    const revisions = z.record(z.string(), z.number().int().nonnegative()).safeParse(data.revisions)
    const refs = z.array(refSchema).safeParse(data.ref ? [data.ref] : data.refs ?? [data.taskRef, object(data.task).taskRef].filter(Boolean))
    if (!revisions.success || !refs.success || !refs.data.length || !Object.keys(revisions.data).length) return result
    const baseline = this.store.baseline(callerId, refs.data, revisions.data, sessionId)
    return { ...result, baselineId: baseline.id }
  }
  prepare(callerId: string, raw: Record<string, unknown>, sessionId: string, access: { allowWrites: boolean; allowDestructive: boolean; allowPaid?: boolean }, capabilityId: OperationRecord['capabilityId'] = 'change_application_entities'): OperationRecord {
    const { operationId, baselineIds } = envelopeSchema.parse(raw)
    const input = { ...raw }; delete input.operationId; delete input.baselineIds
    if ('expectedRevisions' in input) throw new Error('INVALID_INPUT:并发基线由 baselineIds 提供。')
    const digest = operationDigest(capabilityId === 'change_application_entities' ? { input, baselineIds } : { input, baselineIds, capabilityId })
    if (!access.allowWrites) throw new Error('PERMISSION_DENIED:请在应用内授权修改。')
    if (Array.isArray(input.changes) && input.changes.some((change) => object(change).kind === 'remove_items') && !access.allowDestructive) throw new Error('PERMISSION_DENIED:此连接没有删除授权。')
    const prior = this.store.get(operationId, callerId)
    if (prior) {
      if (prior.inputDigest !== digest) throw new Error('OPERATION_INPUT_CONFLICT:同一操作标识不能修改参数或基线。')
      if (prior.state !== 'prepared') return prior
    }
    if (!access.allowWrites) throw new Error('PERMISSION_DENIED:请在应用内授权修改。')
    const refs: Array<{ kind: string; id: string }> = []
    let writeRefs: Array<{ kind: string; id: string }> | undefined
    if (capabilityId !== 'change_application_entities') {
      const definition = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(capabilityId ?? '')
      if (!definition?.resolveOperationTargets || definition.readOnly) throw new Error('PERMISSION_DENIED:此能力尚未登记持久目标绑定。')
      if (capabilityId === 'create_visible_generation_task' && !access.allowPaid) throw new Error('PERMISSION_DENIED:此连接没有付费生成授权。')
      if (definition.destructive && !access.allowDestructive) throw new Error('PERMISSION_DENIED:此连接没有删除授权。')
      const parsed = definition.inputSchema.parse(input)
      refs.push(...definition.resolveOperationTargets(parsed))
      writeRefs = definition.resolveOperationWriteTargets?.(parsed, operationId)
    } else {
    const changes = z.array(z.object({ kind: z.string(), entityType: z.string() }).passthrough()).min(1).max(32).parse(input.changes)
    for (const change of changes) {
      if (!writableDomain(change.entityType)) throw new Error('PERMISSION_DENIED:实体不属于公开业务写入范围。')
      if (change.kind === 'remove_items' && !access.allowDestructive) throw new Error('PERMISSION_DENIED:此连接没有删除授权。')
      if (change.kind === 'set_properties' || change.kind === 'mutate_properties') refs.push(refSchema.parse(change.target))
      else {
        refs.push(refSchema.parse(change.parent))
        if (change.kind === 'remove_items') refs.push(...z.array(refSchema).parse(change.targets))
      }
    }
    }
    const baselines = baselineIds.map((id) => this.store.readBaseline(id, callerId))
    const keys = new Set((writeRefs ?? refs).map((ref) => `${ref.kind}:${ref.id}`))
    for (const unresolved of this.store.unresolved()) {
      const changes = Array.isArray(unresolved.input.changes) ? unresolved.input.changes : []
      const overlaps = (unresolved.targetRefs ?? []).some((ref) => keys.has(`${ref.kind}:${ref.id}`)) || changes.some((value) => {
        const change = object(value)
        return [change.target, change.parent, ...(Array.isArray(change.targets) ? change.targets : [])].some((candidate) => {
          const parsed = refSchema.safeParse(candidate)
          return parsed.success && keys.has(`${parsed.data.kind}:${parsed.data.id}`)
        })
      })
      if (overlaps) throw new Error('RECOVERY_REQUIRED:原目标存在尚未核对或保存的操作，请先查询原操作并恢复；新标识不能绕过保护。')
    }
    if (baselines.some((baseline) => baseline.sessionId !== sessionId)) throw new Error('BASELINE_EXPIRED:应用宿主已重载，请重新读取目标。')
    if (refs.some((ref) => !baselines.some((baseline) => baseline.refs.some((item) => item.kind === ref.kind && item.id === ref.id)))) throw new Error('BASELINE_TARGET_MISMATCH:必须先读取每个原目标及集合父对象，其他对象的读取不能替代。')
    const expectedRevisions: Record<string, number> = {}
    for (const baseline of baselines) for (const [scope, revision] of Object.entries(baseline.revisions)) {
      if (scope in expectedRevisions && expectedRevisions[scope] !== revision) throw new Error('BASELINE_CONFLICT:读取基线不一致，请重新读取相关目标。')
      expectedRevisions[scope] = revision
    }
    return this.store.prepare({ operationId, callerId, inputDigest: digest, input, expectedRevisions, state: 'prepared', capabilityId, targetRefs: writeRefs ?? refs })
  }
  dispatched(record: OperationRecord, requestId: string, sessionId: string): void { this.store.claim(record, requestId, sessionId) }
  interrupted(requestId: string, sessionId: string): void {
    const record = this.store.byRequest(requestId, sessionId)
    if (record?.state === 'executing') this.store.save({ ...record, state: 'unknown' })
  }
  complete(reply: LocalHostReply): void {
    const record = this.store.byRequest(reply.requestId, reply.sessionId)
    if (!record || (record.state !== 'executing' && record.state !== 'unknown')) return
    const details = object(object(reply.result.error).details)
    const transaction = object(details.transaction)
    const partial = object(transaction.partial)
    const changed = Array.isArray(transaction.effects) && transaction.effects.length > 0
    const cleanFailure = object(details.execution).notExecuted === true || (Array.isArray(partial.completedStepIndexes) && partial.completedStepIndexes.length === 0 && !transaction.persistence)
    const state = reply.result.ok === true ? 'completed' : changed || transaction.persistence || details.persistence ? 'partial' : cleanFailure ? 'not_executed' : 'unknown'
    const verified = object(object(reply.result.data).verification).verified === true
    this.store.save({ ...record, state, targetRefs: [...record.targetRefs ?? [], ...resultRefs(reply.result)], verificationState: verified ? 'verified' : 'unresolved', result: reply.result })
    if (record.recoveryOf && reply.result.ok === true) {
      const original = this.store.get(record.recoveryOf, record.callerId)
      if (original) this.store.save({ ...original, state: verified ? 'completed' : original.state,
        verificationState: verified ? 'verified' : 'unresolved', recoveryResult: reply.result })
    }
  }
  prepareSaveRecovery(callerId: string, raw: Record<string, unknown>, sessionId: string, access: { allowWrites: boolean }): OperationRecord {
    const { operationId, originalOperationId } = z.object({ operationId: z.string().uuid(), originalOperationId: z.string().uuid() }).strict().parse(raw)
    if (!access.allowWrites) throw new Error('PERMISSION_DENIED:请在应用内授权修改。')
    const existing = this.store.get(operationId, callerId)
    if (existing && existing.inputDigest !== operationDigest(raw)) throw new Error('OPERATION_INPUT_CONFLICT:恢复操作已绑定其他输入。')
    if (existing && existing.state !== 'prepared') return existing
    const original = this.store.get(originalOperationId, callerId)
    if (!original || original.state !== 'partial') throw new Error('RECOVERY_UNAVAILABLE:原操作没有已确认的保存失败，未知修改不能重放。')
    if (original.sessionId !== sessionId) throw new Error('RECOVERY_SESSION_LOST:原编辑会话已关闭，未保存的内存不能伪造恢复；请在应用中核对原工程。')
    const transaction = object(object(object(original.result?.error).details).transaction)
    const recovery = object(object(transaction.persistence).recovery)
    const target = refSchema.safeParse(recovery.target)
    if (recovery.replayMutation !== false || !target.success || !((recovery.capabilityId === 'retry_canvas_project_save' && target.data.kind === 'canvas.project') || (recovery.capabilityId === 'retry_image_edit_document_save' && target.data.kind === 'image_edit.document'))) throw new Error('RECOVERY_UNAVAILABLE:原领域没有登记可执行的仅保存恢复入口。')
    const verification = transaction.recoveryVerification as OperationRecord['recoveryVerification']
    const ownerId = recovery.capabilityId === 'retry_image_edit_document_save' ? z.string().uuid().safeParse(recovery.ownerId) : undefined
    if (ownerId && !ownerId.success) throw new Error('RECOVERY_SESSION_LOST:原记录缺少图片保存宿主身份，请在原文档核对，不会借用新宿主恢复。')
    if (!verification?.conditions.length || !verification.evidence.length) throw new Error('RECOVERY_PROOF_MISSING:原操作缺少精确验证条件，请在应用中保存并核对。')
    return this.store.prepare({ operationId, callerId, inputDigest: operationDigest(raw), input: { [recovery.capabilityId === 'retry_canvas_project_save' ? 'projectRef' : 'documentRef']: { kind: target.data.kind, id: target.data.id }, ...(ownerId?.success ? { expectedOwnerId: ownerId.data } : {}) },
      expectedRevisions: {}, state: 'prepared', recoveryOf: originalOperationId, capabilityId: recovery.capabilityId as OperationRecord['capabilityId'], recoveryVerification: verification })
  }
  result(record: OperationRecord): Record<string, unknown> {
    const recovered = this.recoverPersisted?.(record)
    if (recovered) { this.store.save(recovered); record = recovered }
    return { ok: record.state === 'completed' && record.verificationState === 'verified', operationId: record.operationId, executionState: record.state,
      verificationState: record.verificationState ?? 'unresolved', result: record.result ?? null, recoveryResult: record.recoveryResult ?? null,
      recovery: record.state === 'unknown' ? '执行结果尚待核对；禁止重复原修改。等待原回执，或在应用内核对原目标。' : undefined }
  }
}
