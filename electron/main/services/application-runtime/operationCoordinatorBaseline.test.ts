import { expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { ApplicationOperationStore, type OperationRecord, type ReadBaseline } from './operationStore'
import { ApplicationOperationCoordinator } from './operationCoordinator'

it('B/A：删除只要求对象基线、允许文档基线；verified 完成后不阻挡同文档后续写入', () => {
  const caller = randomUUID(), epoch = randomUUID()
  const target = { kind: 'camera_stage.object', id: 'scene:object' }, document = { kind: 'camera_stage.document', id: 'scene' }
  const baselines: ReadBaseline[] = [target, document].map(ref => ({ id: randomUUID(), callerId: caller, rendererEpoch: epoch, refs: [ref], revisions: { camera_stage: 3 }, capturedAt: Date.now() }))
  let record: OperationRecord | undefined
  const store = Object.create(ApplicationOperationStore.prototype) as ApplicationOperationStore
  vi.spyOn(store, 'recoverInterrupted').mockImplementation(() => undefined)
  vi.spyOn(store, 'unresolved').mockImplementation(() => record?.verificationState === 'unresolved' ? [record] : [])
  vi.spyOn(store, 'get').mockReturnValue(undefined)
  vi.spyOn(store, 'readBaseline').mockImplementation(id => baselines.find(value => value.id === id)!)
  vi.spyOn(store, 'prepare').mockImplementation(value => value as OperationRecord)
  vi.spyOn(store, 'byRequest').mockImplementation(() => record)
  vi.spyOn(store, 'save').mockImplementation(value => { record = value })
  const coordinator = new ApplicationOperationCoordinator(store)
  const access = { allowWrites: true, allowDestructive: true }
  const input = { documentId: 'scene', objectId: 'object' }
  for (const ids of [[baselines[0].id], baselines.map(value => value.id)]) {
    expect(coordinator.prepare(caller, { ...input, operationId: randomUUID(), baselineIds: ids }, epoch, access, 'delete_camera_stage_object')).toMatchObject({ state: 'prepared', targetRefs: [target], expectedRevisions: { camera_stage: 3 } })
  }
  // 即便旧计数与新计数相同、宿主代次也相同，持久旧键仍必须过期，不能静默放行。
  baselines[0].revisions = { toolbox: 3 }
  expect(() => coordinator.prepare(caller, { ...input, operationId: randomUUID(), baselineIds: [baselines[0].id] }, epoch, access, 'delete_camera_stage_object')).toThrow(/BASELINE_EXPIRED:.*camera_stage.*read_application_entity.*baselineId/)
  expect(baselines[0].revisions).toEqual({ toolbox: 3 })
  baselines[0].revisions = { camera_stage: 3 }
  expect(() => coordinator.prepare(caller, { ...input, operationId: randomUUID(), baselineIds: [baselines[1].id] }, epoch, access, 'delete_camera_stage_object')).toThrow(/BASELINE_TARGET_MISMATCH:.*camera_stage.object.*read_application_entity/)
  record = { ...coordinator.prepare(caller, { ...input, operationId: randomUUID(), baselineIds: [baselines[0].id] }, epoch, access, 'delete_camera_stage_object'), state: 'executing', requestId: randomUUID(), rendererEpoch: epoch }
  coordinator.complete({ requestId: record.requestId!, rendererEpoch: epoch, result: { ok: true, data: { status: 'deleted', verification: { verified: true, condition: '正式场景确认对象已不存在' } } } })
  expect(coordinator.result(record)).toMatchObject({ ok: true, executionState: 'completed', verificationState: 'verified' })
  expect(() => coordinator.prepare(caller, { operationId: randomUUID(), documentId: 'scene', objectType: 'primitive', primitiveKind: 'sphere' }, epoch, access, 'place_camera_stage_object')).not.toThrow()
  vi.restoreAllMocks()
})

it('同事务删除字幕与修改另一字幕，只要求删除目标被基线覆盖', () => {
  const caller = randomUUID(); const epoch = randomUUID()
  const removed = { kind: 'video_edit.caption', id: 'document:removed' }
  const updated = { kind: 'video_edit.caption', id: 'document:updated' }
  const baseline: ReadBaseline = { id: randomUUID(), callerId: caller, rendererEpoch: epoch, refs: [removed], revisions: { 'video_edit:document': 3 }, capturedAt: Date.now() }
  // Storage is the sole boundary; coordinator target extraction and policy remain real.
  const store = Object.create(ApplicationOperationStore.prototype) as ApplicationOperationStore
  vi.spyOn(store, 'recoverInterrupted').mockImplementation(() => undefined)
  vi.spyOn(store, 'unresolved').mockReturnValue([])
  vi.spyOn(store, 'get').mockReturnValue(undefined)
  vi.spyOn(store, 'readBaseline').mockImplementation(id => { if (id !== baseline.id) throw new Error('未知基线'); return baseline })
  vi.spyOn(store, 'prepare').mockImplementation(record => record as OperationRecord)
  const coordinator = new ApplicationOperationCoordinator(store, undefined, () => new Set(['video_edit.caption']))
  const input = { operationId: randomUUID(), baselineIds: [baseline.id], changes: [
    { kind: 'remove_items', entityType: 'video_edit.caption', parent: { kind: 'video_edit.sequence', id: 'document:sequence' }, targets: [removed] },
    { kind: 'set_properties', entityType: 'video_edit.caption', target: updated, properties: { 'video_edit.caption.text': '修正文字' } },
  ] }
  const access = { allowWrites: true, allowDestructive: true }
  expect(coordinator.prepare(caller, input, epoch, access)).toMatchObject({ state: 'prepared', expectedRevisions: baseline.revisions })
  baseline.refs = [updated]
  expect(() => coordinator.prepare(caller, { ...input, operationId: randomUUID() }, epoch, access)).toThrow('BASELINE_TARGET_MISMATCH')
  vi.restoreAllMocks()
})

it('旧镜头操作的核对面板读取 camera_stage 当前状态，保留待人工核对事实', async () => {
  const caller = randomUUID(), epoch = randomUUID()
  const target = { kind: 'camera_stage.object', id: 'scene:object' }
  let record: OperationRecord = { operationId: randomUUID(), callerId: caller, inputDigest: 'digest',
    input: { documentId: 'scene', objectId: 'object' }, expectedRevisions: { toolbox: 3 },
    capabilityId: 'duplicate_camera_stage_object', targetRefs: [target], state: 'unknown',
    // 人工核对只保留给涉及付费的操作：这条带一笔付费预估，验证核对面板的内容
    verificationState: 'unresolved', rendererEpoch: epoch, requestId: randomUUID(), paidGenerationEstimate: 0.5 }
  const store = Object.create(ApplicationOperationStore.prototype) as ApplicationOperationStore
  vi.spyOn(store, 'recoverInterrupted').mockImplementation(() => undefined)
  vi.spyOn(store, 'unresolved').mockReturnValue([])
  vi.spyOn(store, 'get').mockImplementation(() => record)
  vi.spyOn(store, 'save').mockImplementation(value => { record = value })
  const showReview = vi.fn()
  const coordinator = new ApplicationOperationCoordinator(store, undefined, undefined, showReview)
  const read = vi.fn().mockResolvedValue({ ok: true, data: { ref: target, properties: { 'camera_stage.object.name': '球体' }, revisions: { camera_stage: 4 } } })
  try {
    await coordinator.review(record, randomUUID(), read, () => undefined)
    expect(read).toHaveBeenCalledWith(target)
    expect(showReview).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('球体') }))
    expect(showReview.mock.calls[0][0].message).not.toMatch(/toolbox|camera_stage|revision/)
    expect(record).toMatchObject({ state: 'awaiting_user_confirmation', verificationState: 'unresolved', expectedRevisions: { toolbox: 3 } })
  } finally { vi.restoreAllMocks() }
})

it('项目记忆参数校验失败不登记操作，不占用重试核对锁', () => {
  const store = Object.create(ApplicationOperationStore.prototype) as ApplicationOperationStore
  vi.spyOn(store, 'recoverInterrupted').mockImplementation(() => undefined)
  vi.spyOn(store, 'unresolved').mockReturnValue([])
  vi.spyOn(store, 'get').mockReturnValue(undefined)
  const prepare = vi.spyOn(store, 'prepare').mockImplementation(value => value as OperationRecord)
  const coordinator = new ApplicationOperationCoordinator(store)
  const change = { target: { layer: 'project', ownerId: 'project' }, id: 'brand-red', expectedRevision: 0, entry: { content: '本期品牌色红色。', source: 'assistant' }, actor: 'assistant', reason: '用户明确要求。' }
  const access = { allowWrites: true, allowDestructive: false }
  try {
    for (const bad of [{ ...change, expectedRevision: undefined }, { ...change, entry: { ...change.entry, section: 'creative' } }]) {
      expect(() => coordinator.prepare('caller', { operationId: randomUUID(), changes: [bad] }, 'epoch', access, 'organize_assistant_memory')).toThrow()
    }
    expect(prepare).not.toHaveBeenCalled()
    expect(coordinator.prepare('caller', { operationId: randomUUID(), changes: [change] }, 'epoch', access, 'organize_assistant_memory').state).toBe('prepared')
  } finally { vi.restoreAllMocks() }
})

it.each([1, 2])('旧项目分区校验回执只有单条建议能证明未执行（%s条）', count => {
  const store = Object.create(ApplicationOperationStore.prototype) as ApplicationOperationStore
  vi.spyOn(store, 'recoverInterrupted').mockImplementation(() => undefined)
  let record: OperationRecord = { operationId: randomUUID(), callerId: 'caller', inputDigest: 'digest', capabilityId: 'organize_assistant_memory', state: 'unknown',
    input: { changes: Array.from({ length: count }, () => ({ target: { layer: 'project', ownerId: 'project' }, entry: { section: 'creative' } })) },
    result: { ok: false, error: { code: 'CAPABILITY_REJECTED', message: JSON.stringify([{ code: 'custom', path: [0, 'section'], message: '只有全局记忆需要分区。' }]), details: { execution: { billing: 'not_charged', targetMutation: 'unknown', notExecuted: false } } } } }
  vi.spyOn(store, 'unresolved').mockImplementation(() => [record])
  vi.spyOn(store, 'save').mockImplementation(value => { record = value })
  try {
    new ApplicationOperationCoordinator(store)
    expect(record.state).toBe(count === 1 ? 'not_executed' : 'unknown')
    if (count === 1) expect(record.result).toMatchObject({ error: { details: { execution: { notExecuted: true } } } })
  } finally { vi.restoreAllMocks() }
})
