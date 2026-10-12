import { applicationInvocationId } from '../../../../src/core/application-control/operationIdentity'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '../../../../src/core/application-control/builtinApplicationCapabilityRegistry'
import { z } from 'zod'
import { localHostReplySchema, type LocalHostReply } from '../../../../src/core/application-control/localHostContracts'
import { ApplicationOperationStore, operationDigest, type OperationRecord } from './operationStore'
import { operationVerificationRecovery } from './operationVerificationRecovery'
import { applicationUserConfirmation, USER_CONFIRMATION_TIMEOUT_MS } from '../../../../src/core/application-control/userConfirmation'
import { createMainLogger } from '../logging'

const refSchema = z.object({ kind: z.string(), id: z.string() }).passthrough()
const envelopeSchema = z.object({ operationId: z.string().uuid(), baselineIds: z.array(z.string().uuid()).max(32).default([]) })
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

function resultRefs(value: unknown): Array<{ kind: string; id: string }> {
  if (Array.isArray(value)) return value.flatMap(resultRefs)
  if (!value || typeof value !== 'object') return []
  const parsed = refSchema.safeParse(value)
  return parsed.success ? [{ kind: parsed.data.kind, id: parsed.data.id }] : Object.values(value).flatMap(resultRefs)
}

type TargetRecord = Pick<OperationRecord, 'operationId' | 'callerId' | 'capabilityId' | 'input' | 'targetRefs'>
const refKey = (ref: { kind: string; id: string }): string => `${ref.kind}:${ref.id}`
const subtitleWriters = new Set(['generate_video_edit_subtitles', 'translate_video_edit_subtitles', 'segment_video_edit_subtitles'])
function protectsCaption(record: TargetRecord, key: string): boolean {
  const documentId = object(record.input.documentRef).id
  // A direct caption property write has no sequence parent in the public ref. Until
  // its original owner is known, retain protection for this document's captions only.
  return subtitleWriters.has(record.capabilityId ?? '') && typeof documentId === 'string' && key.startsWith(`video_edit.caption:${documentId}:`)
}

/** 读依赖、集合追加和覆盖写入不是同一种冲突；访问范围从同一能力声明解析。 */
function operationAccess(record: TargetRecord): Map<string, 'append' | 'write'> {
  const targets = new Map<string, 'append' | 'write'>()
  const add = (value: unknown, mode: 'append' | 'write'): void => {
    const parsed = refSchema.safeParse(value)
    if (parsed.success && targets.get(refKey(parsed.data)) !== 'write') targets.set(refKey(parsed.data), mode)
  }
  if (record.capabilityId === 'change_application_entities') {
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
  const writes = definition.resolveOperationWriteTargets?.(parsed.data, applicationInvocationId(record.callerId, record.operationId)) ?? reads
  const appends = new Set((definition.resolveOperationAppendTargets?.(parsed.data) ?? []).map(refKey))
  for (const ref of writes) add(ref, appends.has(refKey(ref)) ? 'append' : 'write')
  // 回执里的实际新增对象仍受保护；不能把原本只读的模型/参考素材升级为锁。
  const readKeys = new Set(reads.map(refKey))
  for (const ref of record.targetRefs ?? []) if (!targets.has(refKey(ref)) && !readKeys.has(refKey(ref))) add(ref, 'write')
  return targets
}

/** 业务事实独立于 HTTP 等待；未知写入不靠读取猜测，仅完整的最终状态证明可收敛验证失败。 */
export class ApplicationOperationCoordinator {
  private readonly listeners = new Set<() => void>()
  onChange(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private changed(): void { for (const listener of this.listeners) listener() }
  /**
   * `writableEntityTypes` 是公开业务写入范围，由渲染宿主从反射注册表派生后经注册送来
   * （见 externalCapabilityInventory.ts）。这里**不保留任何前缀白名单兜底**：没拿到派生结果就
   * 一个实体都不放行，"忘了派生"只会变成拒绝，不会变成放行。
   */
  constructor(readonly store: ApplicationOperationStore, private readonly recoverPersisted?: (record: OperationRecord) => OperationRecord | undefined,
    private readonly writableEntityTypes: () => ReadonlySet<string> = () => new Set(),
    private readonly requestReview?: (summary: string, signal: AbortSignal) => Promise<'completed' | 'not_executed' | undefined>) {
    store.recoverInterrupted()
    for (const record of store.unresolved()) {
      const recovered = recoverPersisted?.(record)
      if (recovered) store.save(recovered)
    }
  }
  /** 只识别旧通用事务入口的已知前置拒绝，不以缺少回执或目标当前值相等推断。 */
  private recoverPreflight(record: OperationRecord): OperationRecord {
    const error = object(record.result?.error)
    const details = object(error.details)
    const legacyClosedDocument = record.capabilityId === 'change_application_entities'
      && error.code === 'CAPABILITY_REJECTED'
      && error.message === '请先打开目标剪辑：在剪辑页打开所在项目，或用 open_document 打开这份剪辑（文档 ID 取自 list_documents）。'
    // This SDK rejection is emitted before policy/upload/ASR requests, including the recorded t179 failure.
    const nativeUploadRejected = ['generate_video_edit_subtitles', 'transcribe_audio_edit'].includes(record.capabilityId ?? '')
      && error.code === 'CAPABILITY_REJECTED' && typeof error.message === 'string' && error.message.startsWith('[native_upload_unsupported]')
    // 旧引擎步骤内异常会包装为“操作未完整完成”并附 partial；此原文只可能在步骤外逃逸。
    if (record.state === 'unknown' && record.result?.ok === false
      && !details.transaction && !details.persistence && !details.effects && !details.partial
      && !record.result.effects && !record.result.data && !record.recoveryResult && !record.recoveryVerification
      && (object(details.execution).notExecuted === true || legacyClosedDocument || nativeUploadRejected)) {
      const recovered: OperationRecord = { ...record, state: 'not_executed', verificationState: 'verified',
        result: { ...record.result, error: { ...error, recoverable: true, details: { ...details, execution: { notExecuted: true } } } } }
      this.store.save(recovered)
      return recovered
    }
    return record
  }
  async review(record: OperationRecord, rendererEpoch: string, readTarget: (ref: { kind: string; id: string }) => Promise<boolean>, assertAuthorized: () => void): Promise<void> {
    if (record.state !== 'unknown') return
    if (!rendererEpoch || rendererEpoch === record.rendererEpoch) throw new Error('RECOVERY_SESSION_ACTIVE:原执行宿主尚未结束，请先查询回执；应用重新加载后可核对。')
    if (!this.requestReview) throw new Error('RECOVERY_REVIEW_UNAVAILABLE:当前宿主不能发起人工核对，请在痕迹AI桌面应用中重试。')
    const targets = record.targetRefs?.length ? record.targetRefs : resultRefs(record.input)
    for (const ref of targets) if (!await readTarget(ref)) throw new Error('RECOVERY_TARGET_UNAVAILABLE:原目标尚不能读取，请在应用中定位原文档后再核对。')
    assertAuthorized()
    const current = this.store.get(record.operationId, record.callerId)
    if (!current || current.state !== 'unknown' || current.requestId !== record.requestId) return
    const summary = typeof record.input.summary === 'string' ? record.input.summary : '先前的应用修改'
    const confirmation = applicationUserConfirmation({ title: '核对之前的修改', message: `${summary}：请查看原文档，确认已完成或未执行。本次核对不会重新执行修改。`, confirmLabel: '确认已完成 / 确认未执行' }, 'review')
    this.store.save({ ...current, state: 'awaiting_user_confirmation', verificationState: 'unresolved', confirmation })
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort(); finish() }, USER_CONFIRMATION_TIMEOUT_MS)
    const finish = (decision?: 'completed' | 'not_executed') => {
      const latest = this.store.get(record.operationId, record.callerId)
      if (!latest || latest.state !== 'awaiting_user_confirmation' || latest.confirmation?.expiresAt !== confirmation.expiresAt) return
      this.store.save({ ...latest, state: decision ?? 'unknown', confirmation: undefined,
        ...(decision ? { verificationState: 'verified' as const, recoveryResult: { ok: true, verification: { verified: true, source: 'application_user_review', decision } } } : {}) })
      this.changed()
    }
    // The invocation returns after opening the native dialog, never after the human response.
    void this.requestReview(summary, controller.signal).then(decision => {
      assertAuthorized()
      finish(controller.signal.aborted ? undefined : decision)
    }).catch(error => {
      finish()
      createMainLogger('main.application_runtime').warn('人工核对未完成，保留原执行屏障', { event: 'application.confirmation.review_failed', error })
    }).finally(() => { clearTimeout(timer); controller.abort() })
  }
  /** 宿主未注册时只登记入口零执行事实；不读取领域白名单，也绝不覆盖既有执行账。 */
  rejectBeforeDispatch(callerId: string, raw: Record<string, unknown>, capabilityId: OperationRecord['capabilityId'], retryAfterMs: number): OperationRecord {
    const { operationId, baselineIds } = envelopeSchema.parse(raw)
    const input = { ...raw }; delete input.operationId; delete input.baselineIds
    const digest = operationDigest(capabilityId === 'change_application_entities' ? { input, baselineIds } : { input, baselineIds, capabilityId })
    const prior = this.store.get(operationId, callerId)
    if (prior) {
      if (prior.inputDigest !== digest) throw new Error('OPERATION_INPUT_CONFLICT:同一操作标识不能修改参数或基线。')
      return this.recoverPreflight(prior)
    }
    const record = this.store.prepare({ operationId, callerId, inputDigest: digest, input, capabilityId, state: 'prepared' })
    const rejected: OperationRecord = { ...record, state: 'not_executed', verificationState: 'verified', result: { ok: false,
      error: { code: 'APPLICATION_NOT_READY', message: '应用正在重新连接，请稍后重试。', recoverable: true,
        details: { execution: { notExecuted: true }, retryAfterMs } } } }
    this.store.save(rejected)
    return rejected
  }
  rememberRead(callerId: string, result: Record<string, unknown>, rendererEpoch: string): Record<string, unknown> {
    if (result.ok !== true) return result
    const data = object(result.data)
    const revisions = z.record(z.string(), z.number().int().nonnegative()).safeParse(data.revisions)
    const refs = z.array(refSchema).safeParse(data.ref ? [data.ref] : data.refs ?? [data.taskRef, object(data.task).taskRef].filter(Boolean))
    // 无可编辑实体版本的任务读取仍需绑定原任务与宿主会话；空版本集不等于没有读取事实。
    if (!revisions.success || !refs.success || !refs.data.length) return result
    const baseline = this.store.baseline(callerId, refs.data, revisions.data, rendererEpoch)
    return { ...result, baselineId: baseline.id }
  }
  prepare(callerId: string, raw: Record<string, unknown>, rendererEpoch: string, access: { allowWrites: boolean; allowDestructive: boolean; allowPaid?: boolean }, capabilityId: OperationRecord['capabilityId'] = 'change_application_entities'): OperationRecord {
    const { operationId, baselineIds } = envelopeSchema.parse(raw)
    const input = { ...raw }; delete input.operationId; delete input.baselineIds
    if ('expectedRevisions' in input) throw new Error('INVALID_INPUT:并发基线由 baselineIds 提供。')
    const digest = operationDigest(capabilityId === 'change_application_entities' ? { input, baselineIds } : { input, baselineIds, capabilityId })
    if (!access.allowWrites) throw new Error('PERMISSION_DENIED:请在应用内授权修改。')
    if (Array.isArray(input.changes) && input.changes.some((change) => object(change).kind === 'remove_items') && !access.allowDestructive) throw new Error('PERMISSION_DENIED:此连接没有删除授权。')
    const storedPrior = this.store.get(operationId, callerId)
    const prior = storedPrior && this.recoverPreflight(storedPrior)
    if (prior) {
      if (prior.inputDigest !== digest) throw new Error('OPERATION_INPUT_CONFLICT:同一操作标识不能修改参数或基线。')
      if (prior.state !== 'prepared' && prior.state !== 'not_executed') return prior
    }
    if (!access.allowWrites) throw new Error('PERMISSION_DENIED:请在应用内授权修改。')
    const refs: Array<{ kind: string; id: string }> = []
    const deletionRefs: Array<{ kind: string; id: string }> = []
    let destructive = false
    let writeRefs: Array<{ kind: string; id: string }> | undefined
    if (capabilityId !== 'change_application_entities') {
      const definition = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(capabilityId)
      if (!definition?.resolveOperationTargets || definition.readOnly) throw new Error('PERMISSION_DENIED:此能力尚未登记持久目标绑定。')
      if (definition.paidGenerationPreparation && !access.allowPaid) throw new Error('PERMISSION_DENIED:此连接没有付费生成授权。')
      if (definition.destructive && !access.allowDestructive) throw new Error('PERMISSION_DENIED:此连接没有删除授权。')
      destructive = definition.destructive
      const parsed = definition.inputSchema.parse(input)
      refs.push(...definition.resolveOperationTargets(parsed))
      if (destructive) deletionRefs.push(...refs)
      writeRefs = definition.resolveOperationWriteTargets?.(parsed, applicationInvocationId(callerId, operationId))
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
        if (change.kind === 'remove_items') { const targets = z.array(refSchema).parse(change.targets); refs.push(...targets); deletionRefs.push(...targets) }
      }
    }
    }
    if (destructive && !baselineIds.length) throw new Error(`BASELINE_REQUIRED:删除操作需要先核对目标。请用 read_application_entity 读取 ${JSON.stringify(refs)}，再提交返回的 baselineIds。`)
    const baselines = baselineIds.map((id) => this.store.readBaseline(id, callerId))
    const currentAccess = operationAccess({ operationId, callerId, capabilityId, input, targetRefs: writeRefs ?? refs })
    let speechRecoveryOf: string | undefined
    for (const saved of this.store.unresolved()) {
      const unresolved = this.recoverPreflight(saved)
      if (unresolved.state === 'not_executed') continue
      const facts = object(object(object(unresolved.result?.error).details).execution)
      const originalInput = { ...unresolved.input }; delete originalInput.audioDocumentRef
      const resumedInput = { ...input }; delete resumedInput.audioDocumentRef
      if (unresolved.state === 'partial' && unresolved.callerId === callerId && unresolved.capabilityId === capabilityId
        && capabilityId === 'generate_video_edit_subtitles' && facts.targetMutation === 'none'
        && ['submitted', 'completed'].includes(String(facts.billing))
        && object(input.audioDocumentRef).kind === 'audio_edit.document' && object(input.audioDocumentRef).id === facts.audioDocumentId
        && operationDigest(originalInput) === operationDigest(resumedInput)) {
        speechRecoveryOf = unresolved.operationId
        continue
      }
      const previousAccess = operationAccess(unresolved)
      const sameUnknownRequest = unresolved.callerId === callerId && unresolved.state === 'unknown' && unresolved.capabilityId === capabilityId
        && operationDigest(unresolved.input) === operationDigest(input)
      const overlaps = [...currentAccess].some(([key, mode]) => {
        if (protectsCaption(unresolved, key) || [...previousAccess.keys()].some(previousKey => protectsCaption({ capabilityId, input, operationId, callerId }, previousKey))) return true
        const previousMode = previousAccess.get(key)
        if (previousMode !== undefined) return !(mode === 'append' && previousMode === 'append' && unresolved.state !== 'partial' && !sameUnknownRequest)
        // Whole-document overwrites/deletes still overlap child ranges; independent collection appends do not.
        const documentContains = (parent: string, child: string): boolean => {
          const split = parent.indexOf(':'); const kind = parent.slice(0, split); const id = parent.slice(split + 1)
          const childSplit = child.indexOf(':')
          return kind.endsWith('.document') && child.startsWith(`${kind.slice(0, -'document'.length)}`) && child.slice(childSplit + 1).startsWith(`${id}:`)
        }
        return [...previousAccess].some(([previousKey, previousMode]) => (mode === 'write' && documentContains(key, previousKey)) || (previousMode === 'write' && documentContains(previousKey, key)))
      })
      if (sameUnknownRequest || overlaps) throw new Error(`RECOVERY_REQUIRED:${sameUnknownRequest ? '相同请求的执行结果尚未核实，不能更换操作标识再次提交。' : '本次修改与尚未核对或保存的操作涉及同一目标。'}${unresolved.callerId === callerId
        ? `请用 get_application_operation 查询 operationId=${unresolved.operationId}；不要查询本次尚未登记的新标识。`
        : '原操作属于另一连接，请在应用中核对对应目标。'}独立追加可并行，覆盖、删除、保存失败或重复未知请求不能绕过保护。`)
    }
    if (baselines.some((baseline) => baseline.rendererEpoch !== rendererEpoch)) throw new Error('BASELINE_EXPIRED:应用宿主已重载，请重新读取目标。')
    const missing = deletionRefs.filter((ref) => !baselines.some((baseline) => baseline.refs.some((item) => item.kind === ref.kind && item.id === ref.id)))
    if (baselines.length && missing.length) throw new Error(`BASELINE_TARGET_MISMATCH:缺少 ${JSON.stringify(missing)} 的读取。普通操作可省略 baselineIds 由应用自动核对；删除操作请先用 read_application_entity 读取以上目标。`)
    // 非删除目标可不带基线，但显式提交的基线必须对应本次某个目标：传错对象的基线是调用错误，不能被静默忽略
    const unrelated = baselines.filter((baseline) => !baseline.refs.some((item) => refs.some((ref) => ref.kind === item.kind && ref.id === item.id)))
    if (unrelated.length) throw new Error(`BASELINE_TARGET_MISMATCH:基线 ${unrelated.map((baseline) => baseline.id).join('、')} 不对应本次任何目标。请读取本次要修改或删除的目标后再提交，或省略 baselineIds。`)
    const expectedRevisions: Record<string, number> = {}
    for (const baseline of baselines) for (const [scope, revision] of Object.entries(baseline.revisions)) {
      if (scope in expectedRevisions && expectedRevisions[scope] !== revision) throw new Error(`BASELINE_CONFLICT:${scope} 的读取基线不一致。普通操作可省略 baselineIds 由应用自动核对；严格写入请重新读取相关目标。`)
      expectedRevisions[scope] = revision
    }
    return this.store.prepare({ operationId, callerId, inputDigest: digest, input, expectedRevisions: baselines.length ? expectedRevisions : undefined, state: 'prepared', capabilityId, targetRefs: writeRefs ?? refs,
      ...(speechRecoveryOf ? { recoveryOf: speechRecoveryOf } : {}),
      ...(capabilityId === 'place_video_edit_creative_result' ? { atomicPlacement: true } : {}) })
  }
  dispatched(record: OperationRecord, requestId: string, rendererEpoch: string): void { this.store.claim(record, requestId, rendererEpoch) }
  interrupted(requestId: string, rendererEpoch: string): void {
    const record = this.store.byRequest(requestId, rendererEpoch)
    if (record?.state === 'awaiting_user_confirmation' && record.confirmation?.purpose === 'execution') {
      this.store.save({ ...record, state: 'not_executed', verificationState: 'verified', confirmation: undefined,
        result: { ok: false, error: { code: 'CONFIRMATION_INTERRUPTED', message: '应用在确认前重载；未继续执行或计费。', details: { execution: { notExecuted: true } } } } })
    } else if (record?.state === 'executing' || record?.state === 'awaiting_user_confirmation') this.store.save({ ...record, state: 'unknown', confirmation: undefined })
    this.changed()
  }
  /** 未知执行只能用原宿主的执行事实核对，不能按输入或“当前值碰巧相同”推断。 */
  async reconcileReceipt(record: OperationRecord, read: (original: NonNullable<import('../../../../src/core/application-control/localHostContracts').LocalHostRequest['recoveryOperation']>) => Promise<Record<string, unknown>>): Promise<void> {
    if (!['unknown', 'executing', 'awaiting_user_confirmation'].includes(record.state) || !record.requestId || !record.rendererEpoch || record.confirmation?.purpose === 'review') return
    const documentId = object(record.input.documentRef).id
    const result = await read({ requestId: record.requestId, rendererEpoch: record.rendererEpoch,
      ...(record.atomicPlacement && record.capabilityId === 'place_video_edit_creative_result' && typeof documentId === 'string'
        ? { atomicPlacement: { operationId: applicationInvocationId(record.callerId, record.operationId), documentId } } : {}) })
    const reply = localHostReplySchema.safeParse(object(result.data).operationReply)
    if (result.ok !== true || !reply.success || reply.data.progress || reply.data.requestId !== record.requestId || reply.data.rendererEpoch !== record.rendererEpoch) return
    const current = this.store.get(record.operationId, record.callerId)
    if (!current || current.inputDigest !== record.inputDigest || current.requestId !== record.requestId || current.rendererEpoch !== record.rendererEpoch) return
    this.complete(reply.data)
  }
  async reconcileVerification(record: OperationRecord, verify: (proof: NonNullable<OperationRecord['recoveryVerification']>) => Promise<Record<string, unknown>>): Promise<void> {
    const proof = operationVerificationRecovery(record)
    if (!proof) return
    const result = await verify(proof)
    if (result.ok !== true || object(object(result.data).verification).verified !== true) return
    const current = this.store.get(record.operationId, record.callerId)
    if (!current || current.state !== 'partial' || current.inputDigest !== record.inputDigest) return
    this.store.save({ ...current, state: 'completed', verificationState: 'verified', recoveryResult: result })
  }
  complete(reply: LocalHostReply): void {
    if (reply.progress?.phase === 'paid_approval') return
    const record = this.store.byRequest(reply.requestId, reply.rendererEpoch)
    if (!record || !['executing', 'unknown', 'awaiting_user_confirmation'].includes(record.state)) return
    if (reply.progress) {
      // A replayed progress receipt must never move a resumed operation back to waiting.
      if (record.state === 'unknown') return
      this.store.save({ ...record, state: reply.progress.phase, verificationState: 'unresolved',
        confirmation: reply.progress.phase === 'awaiting_user_confirmation' ? reply.progress.confirmation : undefined })
      return
    }
    const details = object(object(reply.result.error).details)
    const transaction = object(details.transaction)
    const partial = object(transaction.partial)
    const changed = Array.isArray(transaction.effects) && transaction.effects.length > 0
    const cleanFailure = object(details.execution).notExecuted === true || (Array.isArray(partial.completedStepIndexes) && partial.completedStepIndexes.length === 0 && !transaction.persistence)
    const completed = Array.isArray(partial.completedStepIndexes) ? partial.completedStepIndexes : []
    const compensated = Array.isArray(partial.compensatedStepIndexes) ? partial.compensatedStepIndexes : []
    const rolledBack = object(details.execution).rolledBack === true || (completed.length > 0
      && completed.every(index => compensated.includes(index)) && Array.isArray(partial.uncompensatedStepIndexes) && partial.uncompensatedStepIndexes.length === 0)
    const persistence = transaction.persistence || details.persistence
    const speech = object(details.execution)
    const speechPartial = speech.billing === 'submitted' || speech.billing === 'completed' || speech.targetMutation === 'applied'
    const state = reply.result.ok === true ? 'completed' : persistence ? 'partial'
      : rolledBack ? 'rolled_back' : changed || speechPartial ? 'partial' : cleanFailure ? 'not_executed' : 'unknown'
    const verified = state === 'not_executed' || state === 'rolled_back' || object(object(reply.result.data).verification).verified === true
    this.store.save({ ...record, state, confirmation: undefined, targetRefs: [...record.targetRefs ?? [], ...resultRefs(reply.result)], verificationState: verified ? 'verified' : 'unresolved', result: reply.result })
    if (record.recoveryOf && reply.result.ok === true) {
      const original = this.store.get(record.recoveryOf, record.callerId)
      if (original) this.store.save({ ...original, state: verified ? 'completed' : original.state,
        verificationState: verified ? 'verified' : 'unresolved', recoveryResult: reply.result })
    }
    this.changed()
  }
  prepareSaveRecovery(callerId: string, raw: Record<string, unknown>, rendererEpoch: string, access: { allowWrites: boolean }): OperationRecord {
    const { operationId, originalOperationId } = z.object({ operationId: z.string().uuid(), originalOperationId: z.string().uuid() }).strict().parse(raw)
    if (!access.allowWrites) throw new Error('PERMISSION_DENIED:请在应用内授权修改。')
    const existing = this.store.get(operationId, callerId)
    if (existing && existing.inputDigest !== operationDigest(raw)) throw new Error('OPERATION_INPUT_CONFLICT:恢复操作已绑定其他输入。')
    if (existing && existing.state !== 'prepared' && existing.state !== 'not_executed') return existing
    const original = this.store.get(originalOperationId, callerId)
    if (!original || original.state !== 'partial') throw new Error('RECOVERY_UNAVAILABLE:原操作没有已确认的保存失败，未知修改不能重放。')
    if (original.rendererEpoch !== rendererEpoch) throw new Error('RECOVERY_SESSION_LOST:原编辑会话已关闭，未保存的内存不能伪造恢复；请在应用中核对原文档。')
    const details = object(object(original.result?.error).details)
    const transaction = object(details.transaction)
    const recovery = object(object(transaction.persistence ?? details.persistence).recovery)
    const target = refSchema.safeParse(recovery.target)
    if (original.atomicPlacement && target.success && recovery.replayMutation === false && recovery.capabilityId === 'save_video_edit'
      && target.data.kind === 'video_edit.document' && target.data.id === object(original.input.documentRef).id && original.requestId && original.rendererEpoch) {
      return this.store.prepare({ operationId, callerId, inputDigest: operationDigest(raw), input: { documentRef: { kind: target.data.kind, id: target.data.id } },
        state: 'prepared', recoveryOf: originalOperationId, capabilityId: 'save_video_edit',
        recoveryOperation: { requestId: original.requestId, rendererEpoch: original.rendererEpoch,
          atomicPlacement: { operationId: applicationInvocationId(callerId, originalOperationId), documentId: target.data.id } } })
    }
    if (recovery.replayMutation !== false || !target.success || !((recovery.capabilityId === 'retry_canvas_document_save' && target.data.kind === 'canvas.document') || (recovery.capabilityId === 'retry_image_edit_document_save' && target.data.kind === 'image_edit.document'))) throw new Error('RECOVERY_UNAVAILABLE:原领域没有登记可执行的仅保存恢复入口。')
    const verification = transaction.recoveryVerification as OperationRecord['recoveryVerification']
    const ownerId = recovery.capabilityId === 'retry_image_edit_document_save' ? z.string().uuid().safeParse(recovery.ownerId) : undefined
    if (ownerId && !ownerId.success) throw new Error('RECOVERY_SESSION_LOST:原记录缺少图片保存宿主身份，请在原文档核对，不会借用新宿主恢复。')
    if (!verification?.conditions.length || !verification.evidence.length) throw new Error('RECOVERY_PROOF_MISSING:原操作缺少精确验证条件，请在应用中保存并核对。')
    return this.store.prepare({ operationId, callerId, inputDigest: operationDigest(raw), input: { documentRef: { kind: target.data.kind, id: target.data.id }, ...(ownerId?.success ? { expectedOwnerId: ownerId.data } : {}) },
      expectedRevisions: {}, state: 'prepared', recoveryOf: originalOperationId, capabilityId: recovery.capabilityId as OperationRecord['capabilityId'], recoveryVerification: verification })
  }
  result(record: OperationRecord): Record<string, unknown> {
    record = this.recoverPreflight(record)
    const recovered = this.recoverPersisted?.(record)
    if (recovered) { this.store.save(recovered); record = recovered }
    return { ok: record.state === 'completed' && record.verificationState === 'verified', operationId: record.operationId, executionState: record.state,
      verificationState: record.verificationState ?? 'unresolved', result: record.result ?? null, recoveryResult: record.recoveryResult ?? null,
      ...(record.approval ? { approval: record.approval } : {}),
      ...(record.confirmation ? { confirmation: record.confirmation } : {}),
      recovery: record.state === 'unknown' ? '执行结果尚待核对；禁止重复原修改。先用 get_application_operation 等待原回执；原宿主已结束时调用 review_application_operation，由应用读取目标并请用户核对是否执行，再解除保护。' : undefined }
  }
}
