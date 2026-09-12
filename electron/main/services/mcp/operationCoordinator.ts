import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '../../../../src/core/assistant/builtinApplicationCapabilityRegistry'
import { z } from 'zod'
import type { LocalHostReply } from '../../../../src/core/application-control/localHostContracts'
import { McpOperationStore, operationDigest, type OperationRecord } from './operationStore'

const refSchema = z.object({ kind: z.string(), id: z.string() }).passthrough()
const envelopeSchema = z.object({ operationId: z.string().uuid(), baselineIds: z.array(z.string().uuid()).max(32).default([]) })
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

function resultRefs(value: unknown): Array<{ kind: string; id: string }> {
  if (Array.isArray(value)) return value.flatMap(resultRefs)
  if (!value || typeof value !== 'object') return []
  const parsed = refSchema.safeParse(value)
  return parsed.success ? [{ kind: parsed.data.kind, id: parsed.data.id }] : Object.values(value).flatMap(resultRefs)
}

type TargetRecord = Pick<OperationRecord, 'operationId' | 'capabilityId' | 'input' | 'targetRefs'>
const refKey = (ref: { kind: string; id: string }): string => `${ref.kind}:${ref.id}`

/** 读依赖、集合追加和覆盖写入不是同一种冲突；旧账本也从同一能力声明解析。 */
function operationAccess(record: TargetRecord): Map<string, 'append' | 'write'> {
  const targets = new Map<string, 'append' | 'write'>()
  const add = (value: unknown, mode: 'append' | 'write'): void => {
    const parsed = refSchema.safeParse(value)
    if (parsed.success && targets.get(refKey(parsed.data)) !== 'write') targets.set(refKey(parsed.data), mode)
  }
  if (!record.capabilityId || record.capabilityId === 'change_application_entities') {
    for (const value of Array.isArray(record.input.changes) ? record.input.changes : []) {
      const change = object(value)
      add(change.target, 'write')
      add(change.parent, change.kind === 'create_items' ? 'append' : 'write')
      for (const target of Array.isArray(change.targets) ? change.targets : []) add(target, 'write')
    }
    for (const ref of record.targetRefs ?? []) if (!targets.has(refKey(ref))) add(ref, 'write')
    return targets
  }
  const definition = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(record.capabilityId)
  const parsed = definition?.inputSchema.safeParse(record.input)
  if (!definition || !parsed?.success) {
    for (const ref of record.targetRefs ?? []) add(ref, 'write')
    return targets
  }
  const reads = definition.resolveOperationTargets?.(parsed.data) ?? []
  const writes = definition.resolveOperationWriteTargets?.(parsed.data, record.operationId) ?? reads
  const appends = new Set((definition.resolveOperationAppendTargets?.(parsed.data) ?? []).map(refKey))
  for (const ref of writes) add(ref, appends.has(refKey(ref)) ? 'append' : 'write')
  // 回执里的实际新增对象仍受保护；不能把原本只读的模型/参考素材升级为锁。
  const readKeys = new Set(reads.map(refKey))
  for (const ref of record.targetRefs ?? []) if (!targets.has(refKey(ref)) && !readKeys.has(refKey(ref))) add(ref, 'write')
  return targets
}

/** 业务事实独立于 HTTP 等待；读取不会关闭任何写操作的未知/部分状态。 */
export class McpOperationCoordinator {
  /**
   * `writableEntityTypes` 是公开业务写入范围，由渲染宿主从反射注册表派生后经注册送来
   * （见 externalCapabilityInventory.ts）。这里**不保留任何前缀白名单兜底**：没拿到派生结果就
   * 一个实体都不放行，"忘了派生"只会变成拒绝，不会变成放行。
   */
  constructor(readonly store: McpOperationStore, private readonly recoverPersisted?: (record: OperationRecord) => OperationRecord | undefined,
    private readonly writableEntityTypes: () => ReadonlySet<string> = () => new Set()) {
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
    // 无可编辑实体版本的任务读取仍需绑定原任务与宿主会话；空版本集不等于没有读取事实。
    if (!revisions.success || !refs.success || !refs.data.length) return result
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
    let destructive = false
    let writeRefs: Array<{ kind: string; id: string }> | undefined
    if (capabilityId !== 'change_application_entities') {
      const definition = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(capabilityId ?? '')
      if (!definition?.resolveOperationTargets || definition.readOnly) throw new Error('PERMISSION_DENIED:此能力尚未登记持久目标绑定。')
      if (capabilityId === 'create_visible_generation_task' && !access.allowPaid) throw new Error('PERMISSION_DENIED:此连接没有付费生成授权。')
      if (definition.destructive && !access.allowDestructive) throw new Error('PERMISSION_DENIED:此连接没有删除授权。')
      destructive = definition.destructive
      const parsed = definition.inputSchema.parse(input)
      refs.push(...definition.resolveOperationTargets(parsed))
      writeRefs = definition.resolveOperationWriteTargets?.(parsed, operationId)
    } else {
    const changes = z.array(z.object({ kind: z.string(), entityType: z.string() }).passthrough()).min(1).max(32).parse(input.changes)
    const writable = this.writableEntityTypes()
    for (const change of changes) {
      destructive ||= change.kind === 'remove_items'
      if (!writable.has(change.entityType)) throw new Error(`PERMISSION_DENIED:实体 ${change.entityType} 不属于公开业务写入范围；用 describe_application_contract 查看可写实体，用 describe_application_entities 查看只读原因。`)
      if (change.kind === 'remove_items' && !access.allowDestructive) throw new Error('PERMISSION_DENIED:此连接没有删除授权。')
      if (change.kind === 'set_properties' || change.kind === 'mutate_properties') refs.push(refSchema.parse(change.target))
      else {
        refs.push(refSchema.parse(change.parent))
        if (change.kind === 'remove_items') refs.push(...z.array(refSchema).parse(change.targets))
      }
    }
    }
    if (destructive && !baselineIds.length) throw new Error(`BASELINE_REQUIRED:删除操作需要先核对目标。请用 read_application_entity 读取 ${JSON.stringify(refs)}，再提交返回的 baselineIds。`)
    const baselines = baselineIds.map((id) => this.store.readBaseline(id, callerId))
    const currentAccess = operationAccess({ operationId, capabilityId, input, targetRefs: writeRefs ?? refs })
    for (const unresolved of this.store.unresolved()) {
      const previousAccess = operationAccess(unresolved)
      const sameUnknownRequest = unresolved.state === 'unknown' && (unresolved.capabilityId ?? 'change_application_entities') === capabilityId
        && operationDigest(unresolved.input) === operationDigest(input)
      const overlaps = [...currentAccess].some(([key, mode]) => {
        const previousMode = previousAccess.get(key)
        return previousMode !== undefined && !(mode === 'append' && previousMode === 'append'
          && unresolved.state !== 'partial' && !sameUnknownRequest)
      })
      if (overlaps) throw new Error(`RECOVERY_REQUIRED:本次修改与尚未核对或保存的操作涉及同一目标。${unresolved.callerId === callerId
        ? `请用 get_application_operation 查询 operationId=${unresolved.operationId}；不要查询本次尚未登记的新标识。`
        : '原操作属于另一连接，请在应用中核对对应目标。'}独立追加可并行，覆盖、删除、保存失败或重复未知请求不能绕过保护。`)
    }
    if (baselines.some((baseline) => baseline.sessionId !== sessionId)) throw new Error('BASELINE_EXPIRED:应用宿主已重载，请重新读取目标。')
    const missing = refs.filter((ref) => !baselines.some((baseline) => baseline.refs.some((item) => item.kind === ref.kind && item.id === ref.id)))
    if (baselines.length && missing.length) throw new Error(`BASELINE_TARGET_MISMATCH:缺少 ${JSON.stringify(missing)} 的读取。普通操作可省略 baselineIds 由应用自动核对；删除操作请先用 read_application_entity 读取以上目标。`)
    const expectedRevisions: Record<string, number> = {}
    for (const baseline of baselines) for (const [scope, revision] of Object.entries(baseline.revisions)) {
      if (scope in expectedRevisions && expectedRevisions[scope] !== revision) throw new Error(`BASELINE_CONFLICT:${scope} 的读取基线不一致。普通操作可省略 baselineIds 由应用自动核对；严格写入请重新读取相关目标。`)
      expectedRevisions[scope] = revision
    }
    return this.store.prepare({ operationId, callerId, inputDigest: digest, input, expectedRevisions: baselines.length ? expectedRevisions : undefined, state: 'prepared', capabilityId, targetRefs: writeRefs ?? refs })
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
    const completed = Array.isArray(partial.completedStepIndexes) ? partial.completedStepIndexes : []
    const compensated = Array.isArray(partial.compensatedStepIndexes) ? partial.compensatedStepIndexes : []
    const rolledBack = object(details.execution).rolledBack === true || (completed.length > 0
      && completed.every(index => compensated.includes(index)) && Array.isArray(partial.uncompensatedStepIndexes) && partial.uncompensatedStepIndexes.length === 0)
    const state = reply.result.ok === true ? 'completed' : changed || transaction.persistence || details.persistence ? 'partial'
      : rolledBack ? 'rolled_back' : cleanFailure ? 'not_executed' : 'unknown'
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
