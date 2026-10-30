import { applicationInvocationId } from '../../../../src/core/application-control/operationIdentity'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '../../../../src/core/application-control/builtinApplicationCapabilityRegistry'
import { z } from 'zod'
import { localHostReplySchema, type LocalHostReply } from '../../../../src/core/application-control/localHostContracts'
import { ApplicationOperationStore, operationDigest, type OperationRecord } from './operationStore'
import { canReviewOperation, isExecutedVerificationFailure, operationVerificationRecovery, protectsUnknownOutcome } from './operationVerificationRecovery'
import { applicationUserConfirmation } from '../../../../src/core/application-control/userConfirmation'
import { requiresMutationReview } from '../../../../src/core/application-control/applicationCapabilities'
import type { OperationReviewItem } from '../../../../src/core/application-control/operationReview'
import { reviewPresentation } from './operationReviewPresentation'
import { createMainLogger } from '../logging'
import { applicationNotReadyFailure, type ApplicationHostUnavailable, type ApplicationHostUnavailableReason } from './applicationHostBridge'

const refSchema = z.object({ kind: z.string(), id: z.string() }).passthrough()
const envelopeSchema = z.object({ operationId: z.string().uuid(), baselineIds: z.array(z.string().uuid()).max(32).default([]) })
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

/** 拒绝信息只点名前 10 个目标并给总数：一次删几百条时整段引用会把错误撑到读不完。 */

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
  const policy = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(record.capabilityId)
  if (policy && !requiresMutationReview(policy)) return targets
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
    private readonly requestReview?: (item: OperationReviewItem) => void) {
    store.recoverInterrupted()
    for (const record of store.unresolved()) {
      this.recoverPreflight(record)
      const recovered = recoverPersisted?.(record)
      if (recovered) store.save(recovered)
    }
  }
  /** 只识别旧通用事务入口的已知前置拒绝，不以缺少回执或目标当前值相等推断。 */
  private recoverPreflight(record: OperationRecord): OperationRecord {
    const definition = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(record.capabilityId)
    if (record.capabilityId !== 'load_assistant_skill' && definition && !(definition.readOnly && record.state === 'awaiting_user_confirmation') && !requiresMutationReview(definition) && ['unknown', 'partial', 'awaiting_user_confirmation'].includes(record.state)) {
      const recovered: OperationRecord = { ...record, state: 'not_executed', verificationState: 'verified', confirmation: undefined }
      this.store.save(recovered)
      return recovered
    }
    const error = object(record.result?.error)
    const details = object(error.details)
    const legacyClosedDocument = record.capabilityId === 'change_application_entities'
      && error.code === 'CAPABILITY_REJECTED'
      && error.message === '请先打开目标剪辑：在剪辑页打开所在项目，或用 open_document 打开这份剪辑（文档 ID 取自 list_documents）。'
    // This SDK rejection is emitted before policy/upload/ASR requests, including the recorded t179 failure.
    const nativeUploadRejected = ['generate_video_edit_subtitles', 'transcribe_audio_edit'].includes(record.capabilityId ?? '')
      && error.code === 'CAPABILITY_REJECTED' && typeof error.message === 'string' && error.message.startsWith('[native_upload_unsupported]')
    // 三层记忆旧入口把项目条目的全局分区校验放在派发之后；单条建议在纯函数校验即拒绝，尚未落盘。
    // 仅恢复这份可证明零执行的旧回执；多条建议可能已部分写入，仍保留核对保护。
    const memoryChanges = record.input.changes
    let legacyMemoryLayerRejected = false
    if (record.capabilityId === 'organize_assistant_memory' && Array.isArray(memoryChanges) && memoryChanges.length === 1
      && error.code === 'CAPABILITY_REJECTED' && typeof error.message === 'string') {
      const change = object(memoryChanges[0])
      try {
        const issues: unknown = JSON.parse(error.message)
        legacyMemoryLayerRejected = ['project', 'style'].includes(String(object(change.target).layer))
          && object(change.entry).section !== undefined && Array.isArray(issues) && issues.length === 1
          && object(issues[0]).code === 'custom' && JSON.stringify(object(issues[0]).path) === '[0,"section"]'
          && object(issues[0]).message === '只有全局记忆需要分区。'
      } catch { /* 非这份已知校验回执，不推断执行事实。 */ }
    }
    // 2026-10-24 前，写入前就被拒绝的失败（位置校验、文档类型不能独立存放、样片代码编译不过、
    // 复制进刚建好的空文件夹时 fs.cp 报目标已存在且随即删掉）被误记为 unknown，元宝搜索实战里留下这几条。
    // 只认这几份可证明零写入的原文，新回执已由写执行层按错误类型与领域声明直接记为未执行。
    const message = typeof error.message === 'string' ? error.message : ''
    const legacyRejectedBeforeWrite = error.code === 'CAPABILITY_REJECTED' && (
      (['register_external_project', 'create_document', 'move_document', 'duplicate_document'].includes(record.capabilityId ?? '')
        && ['位置无效，请选择一个文件夹。', '这种文档只能放在项目里。', '请选择一个文件夹。', '不能把作品目录本身作为项目打开。', '这个文件夹在另一个项目里，不能单独作为项目打开。'].includes(message))
      || (record.capabilityId === 'render_video_edit_style' && message.startsWith('Parse error'))
      || (record.capabilityId === 'import_web_recording_to_project' && message.startsWith('Target already exists: cp returned EEXIST'))
      // 2026-10-27 前网页录制实验开关没开时的拒绝（入口第一行就拒，未调用宿主）也被记成 unknown。
      || (['start_web_app_recording', 'stop_web_app_recording', 'render_web_app_replay', 'import_web_recording', 'import_web_recording_to_project'].includes(record.capabilityId ?? '')
        && message.startsWith('网页应用录制是实验性功能，尚未开启')))
    // t184 统一写包装记录的结构化事实：未改动目标且未计费，即 t188 修复前被误记为 unknown 的执行前拒绝（如打开不支持格式的文档）。
    const execution = object(details.execution)
    const recordedNoEffect = execution.targetMutation === 'none' && execution.billing === 'not_charged'
    // 旧引擎步骤内异常会包装为“操作未完整完成”并附 partial；此原文只可能在步骤外逃逸。
    // 已经弹给用户核对、但其实可证明零写入的旧记录，同样直接收回，不再让用户回答。
    const awaitingReview = record.state === 'awaiting_user_confirmation' && record.confirmation?.purpose === 'review'
    if ((record.state === 'unknown' || awaitingReview && legacyRejectedBeforeWrite) && record.result?.ok === false
      && !details.transaction && !details.persistence && !details.effects && !details.partial
      && !record.result.effects && !record.result.data && !record.recoveryResult && !record.recoveryVerification
      && (execution.notExecuted === true || legacyClosedDocument || nativeUploadRejected || legacyMemoryLayerRejected || legacyRejectedBeforeWrite || recordedNoEffect)) {
      const recovered: OperationRecord = { ...record, state: 'not_executed', verificationState: 'verified', confirmation: undefined,
        result: { ...record.result, error: { ...error, recoverable: true, details: { ...details, execution: { notExecuted: true } } } } }
      this.store.save(recovered)
      return recovered
    }
    return record
  }
  async review(record: OperationRecord, rendererEpoch: string, readTarget: (ref: { kind: string; id: string }) => Promise<Record<string, unknown>>, assertAuthorized: () => void): Promise<void> {
    record = this.recoverPreflight(record)
    if (!canReviewOperation(record)) return
    if (!rendererEpoch || rendererEpoch === record.rendererEpoch && !isExecutedVerificationFailure(record)) throw new Error('RECOVERY_SESSION_ACTIVE:原执行宿主尚未结束，请先查询回执；应用重新加载后可核对。')
    if (!this.requestReview) throw new Error('RECOVERY_REVIEW_UNAVAILABLE:当前宿主不能发起人工核对，请在痕迹AI桌面应用中重试。')
    const targets = [...new Map([...(record.targetRefs ?? []), ...resultRefs(record.input)].map(ref => [refKey(ref), ref])).values()]
    const observations: Record<string, unknown>[] = []
    for (const ref of targets) {
      try { observations.push(await readTarget(ref)) } catch { /* 读不到仍能由用户核对，面板明确说明。 */ }
    }
    assertAuthorized()
    const current = this.store.get(record.operationId, record.callerId)
    if (!current || !canReviewOperation(current) || current.requestId !== record.requestId || current.inputDigest !== record.inputDigest) return
    const item = reviewPresentation(current, observations)
    const confirmation = applicationUserConfirmation({ title: item.title, message: item.message, confirmLabel: item.executed ? '已核对，继续编辑' : '已经生效' }, 'review')
    this.store.save({ ...current, state: 'awaiting_user_confirmation', verificationState: 'unresolved', confirmation })
    this.changed()
    this.requestReview(item)
  }
  pendingReviews(): OperationReviewItem[] {
    return this.store.unresolved().map(record => this.recoverPreflight(record))
      .filter(canReviewOperation)
      .map(record => ({ ...reviewPresentation(record),
        targets: [...operationAccess(record).keys()].map(key => ({ kind: key.slice(0, key.indexOf(':')), id: key.slice(key.indexOf(':') + 1) })),
        ...(record.confirmation ? { title: record.confirmation.title, message: record.confirmation.message } : {}) }))
  }
  /** 仅可信应用界面调用；外部工具不接受人工决定参数。稍后处理只关闭呈现，保留账本。 */
  resolveReview(operationId: string, callerId: string, decision: 'completed' | 'not_executed' | 'later'): void {
    const record = this.store.get(operationId, callerId)
    if (!record || record.state !== 'awaiting_user_confirmation' || record.confirmation?.purpose !== 'review') return
    if (decision === 'not_executed' && isExecutedVerificationFailure(record)) throw new Error('RECOVERY_ALREADY_EXECUTED:这次修改已执行，请查看结果后确认，不能将它记为未执行。')
    if (decision !== 'later') this.store.save({ ...record, state: decision, confirmation: undefined, verificationState: 'verified',
      recoveryResult: { ok: true, verification: { verified: true, source: 'application_user_review', decision } } })
    createMainLogger('main.application_runtime').info('应用内核对已处理', { event: 'application.confirmation.review_resolved', context: { operationId, decision } })
    this.changed()
  }
  /** 宿主未注册时只登记入口零执行事实；不读取领域白名单，也绝不覆盖既有执行账。 */
  rejectBeforeDispatch(callerId: string, raw: Record<string, unknown>, capabilityId: OperationRecord['capabilityId'], retryAfterMs: number, unavailable?: ApplicationHostUnavailable): OperationRecord {
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
      error: applicationNotReadyFailure(unavailable, retryAfterMs) } }
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
  prepare(callerId: string, raw: Record<string, unknown>, rendererEpoch: string, capabilityId: OperationRecord['capabilityId'] = 'change_application_entities', actor: 'external' | 'embedded' = 'external'): OperationRecord {
    const { operationId, baselineIds } = envelopeSchema.parse(raw)
    const input = { ...raw }; delete input.operationId; delete input.baselineIds
    if ('expectedRevisions' in input) throw new Error('INVALID_INPUT:并发基线由 baselineIds 提供。')
    const digest = operationDigest(capabilityId === 'change_application_entities' ? { input, baselineIds } : { input, baselineIds, capabilityId })
    const storedPrior = this.store.get(operationId, callerId)
    const prior = storedPrior && this.recoverPreflight(storedPrior)
    if (prior) {
      if (prior.inputDigest !== digest) throw new Error('OPERATION_INPUT_CONFLICT:同一操作标识不能修改参数或基线。')
      if (prior.state !== 'prepared' && prior.state !== 'not_executed') return prior
    }
    const refs: Array<{ kind: string; id: string }> = []
    let writeRefs: Array<{ kind: string; id: string }> | undefined
    if (capabilityId !== 'change_application_entities') {
      const definition = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(capabilityId)
      if (!definition?.resolveOperationTargets || definition.readOnly) throw new Error('PERMISSION_DENIED:此能力尚未登记持久目标绑定。')
      const parsed = definition.inputSchema.parse(input)
      refs.push(...definition.resolveOperationTargets(parsed))
      writeRefs = definition.resolveOperationWriteTargets?.(parsed, applicationInvocationId(callerId, operationId))
    } else {
    const changes = z.array(z.object({ kind: z.string(), entityType: z.string() }).passthrough()).min(1).max(32).parse(input.changes)
    const writable = this.writableEntityTypes()
    for (const change of changes) {
      if (!writable.has(change.entityType)) throw new Error(`PERMISSION_DENIED:实体 ${change.entityType} 不属于公开业务写入范围；用 describe_application_contract 查看可写实体，用 describe_application_entities 查看只读原因。`)
      if (change.kind === 'set_properties' || change.kind === 'mutate_properties') refs.push(refSchema.parse(change.target))
      else {
        refs.push(refSchema.parse(change.parent))
        if (change.kind === 'remove_items') { const targets = z.array(refSchema).parse(change.targets); refs.push(...targets) }
      }
    }
    }
    const baselines = baselineIds.map((id) => this.store.readBaseline(id, callerId))
    const currentAccess = operationAccess({ operationId, callerId, capabilityId, input, targetRefs: writeRefs ?? refs })
    let speechRecoveryOf: string | undefined
    for (const saved of this.store.unresolved()) {
      const unresolved = this.recoverPreflight(saved)
      if (unresolved.state === 'not_executed') continue
      // 结果未知的本地修改不挡后续修改（见 protectsUnknownOutcome）；付费与保存失败的仍挡
      if (['unknown', 'partial', 'awaiting_user_confirmation'].includes(unresolved.state) && (unresolved.state !== 'awaiting_user_confirmation' || unresolved.confirmation?.purpose === 'review') && !protectsUnknownOutcome(unresolved)) continue
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
    // 2.6.0 更正镜头参考的修订范围；旧基线只失效，不改写持久记录或映射旧计数。
    if (baselines.some((baseline) => 'toolbox' in baseline.revisions && baseline.refs.some((ref) => ref.kind.startsWith('camera_stage.')))) {
      throw new Error('BASELINE_EXPIRED:镜头参考的修订范围已从 toolbox 改为 camera_stage。请用 read_application_entity 重新读取原目标，使用返回的新 baselineId 提交。')
    }
    // 显式提供的基线必须对应目标，避免错用另一份状态。
    // 非删除目标可不带基线，但显式提交的基线必须对应本次某个目标：传错对象的基线是调用错误，不能被静默忽略
    const unrelated = baselines.filter((baseline) => !baseline.refs.some((item) => refs.some((ref) => ref.kind === item.kind && ref.id === item.id)))
    if (unrelated.length) throw new Error(`BASELINE_TARGET_MISMATCH:基线 ${unrelated.map((baseline) => baseline.id).join('、')} 不对应本次任何目标。请读取本次要修改或删除的目标后再提交，或省略 baselineIds。`)
    const expectedRevisions: Record<string, number> = {}
    for (const baseline of baselines) for (const [scope, revision] of Object.entries(baseline.revisions)) {
      if (scope in expectedRevisions && expectedRevisions[scope] !== revision) throw new Error(`BASELINE_CONFLICT:${scope} 的读取基线不一致。普通操作可省略 baselineIds 由应用自动核对；严格写入请重新读取相关目标。`)
      expectedRevisions[scope] = revision
    }
    return this.store.prepare({ operationId, callerId, inputDigest: digest, input, origin: { at: Date.now(), actor }, expectedRevisions: baselines.length ? expectedRevisions : undefined, state: 'prepared', capabilityId, targetRefs: writeRefs ?? refs,
      ...(speechRecoveryOf ? { recoveryOf: speechRecoveryOf } : {}),
      ...(capabilityId === 'place_video_edit_creative_result' ? { atomicPlacement: true } : {}) })
  }
  dispatched(record: OperationRecord, requestId: string, rendererEpoch: string): void { this.store.claim(record, requestId, rendererEpoch) }
  interrupted(requestId: string, rendererEpoch: string, reason?: ApplicationHostUnavailableReason): void {
    const record = this.store.byRequest(requestId, rendererEpoch)
    if (record?.state === 'awaiting_user_confirmation' && record.confirmation?.purpose === 'execution') {
      this.store.save({ ...record, state: 'not_executed', verificationState: 'verified', confirmation: undefined,
        result: { ok: false, error: { code: 'CONFIRMATION_INTERRUPTED', message: '应用在确认前重载；未继续执行或计费。', details: { execution: { notExecuted: true } } } } })
    } else if (record?.state === 'executing') {
      // 中断不是新的执行状态：账本仍记 unknown（状态枚举属于持久格式），原因写进回执，核对界面按“连接中断”呈现。
      // 不写 execution 事实，免得被当成可证明的零执行；付费保护照常由 protectsUnknownOutcome 判断。
      const interruption = reason ? { result: { ok: false, error: { code: 'CONNECTION_INTERRUPTED', recoverable: true,
        message: '已中断：应用界面在执行中崩溃，修改是否生效尚待核对。', details: { interruption: { reason, at: new Date().toISOString() } } } } } : {}
      this.store.save(this.recoverPreflight({ ...record, state: 'unknown', confirmation: undefined, ...interruption }))
    }
    this.changed()
  }
  /** 未知执行只能用原宿主的执行事实核对，不能按输入或“当前值碰巧相同”推断。 */
  async reconcileReceipt(record: OperationRecord, read: (original: NonNullable<import('../../../../src/core/application-control/localHostContracts').LocalHostRequest['recoveryOperation']>) => Promise<Record<string, unknown>>): Promise<void> {
    if (!['unknown', 'executing', 'awaiting_user_confirmation'].includes(record.state) || !record.requestId || !record.rendererEpoch) return
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
    if (!current || !['partial', 'unknown', 'awaiting_user_confirmation'].includes(current.state) || current.inputDigest !== record.inputDigest) return
    this.store.save({ ...current, state: 'completed', confirmation: undefined, verificationState: 'verified', recoveryResult: result })
    this.changed()
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
    const changed = (Array.isArray(transaction.effects) && transaction.effects.length > 0)
      || (Array.isArray(details.effects) && details.effects.length > 0)
    const definition = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(record.capabilityId)
    const reviewExempt = definition && !requiresMutationReview(definition)
    const cleanFailure = object(details.execution).notExecuted === true || (object(details.execution).targetMutation === 'none' && object(details.execution).billing === 'not_charged') || (Array.isArray(partial.completedStepIndexes) && partial.completedStepIndexes.length === 0 && !transaction.persistence)
    const completed = Array.isArray(partial.completedStepIndexes) ? partial.completedStepIndexes : []
    const compensated = Array.isArray(partial.compensatedStepIndexes) ? partial.compensatedStepIndexes : []
    const rolledBack = object(details.execution).rolledBack === true || (completed.length > 0
      && completed.every(index => compensated.includes(index)) && Array.isArray(partial.uncompensatedStepIndexes) && partial.uncompensatedStepIndexes.length === 0)
    const persistence = transaction.persistence || details.persistence
    const execution = object(details.execution)
    const executionPartial = execution.billing === 'submitted' || execution.billing === 'completed' || execution.targetMutation === 'applied'
    const state = reply.result.ok === true ? 'completed' : reviewExempt ? 'not_executed' : persistence ? 'partial'
      : executionPartial ? 'partial' : execution.billing === 'unknown' ? 'unknown' : rolledBack ? 'rolled_back' : changed ? 'partial' : cleanFailure ? 'not_executed' : 'unknown'
    const verified = state === 'not_executed' || state === 'rolled_back' || definition?.readOnly === true && state === 'completed' || object(object(reply.result.data).verification).verified === true
    this.store.save({ ...record, state, confirmation: undefined, targetRefs: [...record.targetRefs ?? [], ...resultRefs(reply.result)], verificationState: verified ? 'verified' : 'unresolved', result: reply.result })
    if (record.recoveryOf && reply.result.ok === true) {
      const original = this.store.get(record.recoveryOf, record.callerId)
      if (original) this.store.save({ ...original, state: verified ? 'completed' : original.state,
        verificationState: verified ? 'verified' : 'unresolved', recoveryResult: reply.result })
    }
    this.changed()
  }
  prepareSaveRecovery(callerId: string, raw: Record<string, unknown>, rendererEpoch: string): OperationRecord {
    const { operationId, originalOperationId } = z.object({ operationId: z.string().uuid(), originalOperationId: z.string().uuid() }).strict().parse(raw)
    const existing = this.store.get(operationId, callerId)
    if (existing && existing.inputDigest !== operationDigest(raw)) throw new Error('OPERATION_INPUT_CONFLICT:恢复操作已绑定其他输入。')
    if (existing && existing.state !== 'prepared' && existing.state !== 'not_executed') return existing
    const original = this.store.get(originalOperationId, callerId)
    if (!original || original.state !== 'partial') throw new Error('RECOVERY_UNAVAILABLE:原操作没有已确认的保存失败，未知修改不能重放。')
    const details = object(object(original.result?.error).details)
    const transaction = object(details.transaction)
    const recovery = object(object(transaction.persistence ?? details.persistence).recovery)
    const target = refSchema.safeParse(recovery.target)
    // 放入结果的恢复只认剪辑文件里随内容保存的放入记录（操作身份、素材与片段），不看内存，所以原会话关了也能核对
    if (original.atomicPlacement && target.success && recovery.replayMutation === false && recovery.capabilityId === 'save_video_edit'
      && target.data.kind === 'video_edit.document' && target.data.id === object(original.input.documentRef).id && original.requestId && original.rendererEpoch) {
      return this.store.prepare({ operationId, callerId, inputDigest: operationDigest(raw), input: { documentRef: { kind: target.data.kind, id: target.data.id } },
        state: 'prepared', recoveryOf: originalOperationId, capabilityId: 'save_video_edit',
        recoveryOperation: { requestId: original.requestId, rendererEpoch: original.rendererEpoch,
          atomicPlacement: { operationId: applicationInvocationId(callerId, originalOperationId), documentId: target.data.id } } })
    }
    if (original.rendererEpoch !== rendererEpoch) throw new Error('RECOVERY_SESSION_LOST:原编辑会话已关闭，未保存的内存不能伪造恢复；请在应用中核对原文档。')
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
      recovery: record.state !== 'unknown' ? undefined : protectsUnknownOutcome(record)
        ? '执行结果尚待核对；禁止重复原修改。先用 get_application_operation 等待原回执；原宿主已结束时调用 review_application_operation，由应用读取目标并请用户核对是否执行，再解除保护。'
        : '执行结果没能确认（本地修改，不挡后续修改，也不弹窗请用户核对）：先读取目标看改没改上，没改上就直接重做；改错了可以撤销。' }
  }
}
