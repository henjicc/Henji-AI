import { afterEach, expect, it, vi } from 'vitest'
import { createFixture, createEngine } from '@/core/application-control/execution/engineTestFixture'
import * as authorization from '../creativeIntentAuthorization'
import { createApplicationCallerGrant } from '@/core/application-control/callerContext'

afterEach(() => { vi.restoreAllMocks() })

const state = vi.hoisted(() => ({ current: undefined as undefined | ReturnType<typeof createEngine> & { fixture: ReturnType<typeof createFixture> } }))
vi.mock('./applicationControlRegistry', () => ({
  getApplicationReflectionRegistry: () => state.current!.fixture.registry,
  getApplicationControlExecutionEngine: () => state.current!.engine,
}))
import { applicationReflectionHandlers } from './applicationReflectionAdapter'

it('同一 requestId 零步失败后通过真实计划存储重试成功', async () => {
  const fixture = createFixture()
  state.current = { fixture, ...createEngine(fixture) }
  vi.spyOn(state.current.executor, 'apply').mockRejectedValueOnce(new Error('temporary failure'))
  const input = { summary: '修改数值', changes: [{ kind: 'set_properties' as const, entityType: 'sample.item', target: { kind: 'sample.item', id: 'one' }, properties: { 'sample.value': 6 } }] }
  const context = { requestId: 'same-operation', expectedRevisions: { 'sample.scope': 0 }, signal: new AbortController().signal }
  await expect(applicationReflectionHandlers.changeEntities(input, context)).rejects.toThrow()
  await expect(applicationReflectionHandlers.changeEntities(input, context)).resolves.toMatchObject({ status: 'completed' })
  expect(fixture.values.get('one')).toBe(6)
})

it('公开撤销回执淘汰最旧项，最新回执仍可撤销', async () => {
  const forget = vi.spyOn(authorization, 'forgetExplanationUndoAccess')
  const fixture = createFixture()
  state.current = { fixture, ...createEngine(fixture) }
  const refs: string[] = []
  const context = { requestId: 'bounded-public-undo', signal: new AbortController().signal }
  for (let i = 0; i < 257; i++) {
    const result = await applicationReflectionHandlers.changeEntities({ summary: '修改数值', changes: [{ kind: 'set_properties', entityType: 'sample.item', target: { kind: 'sample.item', id: 'one' }, properties: { 'sample.value': (i % 5) * 2 } }] }, { ...context, expectedRevisions: { 'sample.scope': fixture.revisions.value } })
    refs.push(result.undoRef!)
  }
  await expect(applicationReflectionHandlers.undoEntities({ undoRef: refs[0] }, context)).rejects.toThrow('NOT_FOUND')
  expect(forget).toHaveBeenCalledWith(refs[0])
  await expect(applicationReflectionHandlers.undoEntities({ undoRef: refs.at(-1)! }, context)).resolves.toMatchObject({ status: 'completed' })
  expect(forget).toHaveBeenCalledWith(refs.at(-1))
})

it('私密索引释放回调同步作废公开撤销回执', async () => {
  const remember = vi.spyOn(authorization, 'rememberExplanationUndoAccess')
  const fixture = createFixture()
  state.current = { fixture, ...createEngine(fixture) }
  const context = { requestId: 'release-private', signal: new AbortController().signal }
  const result = await applicationReflectionHandlers.changeEntities({ summary: '修改数值', changes: [{ kind: 'set_properties', entityType: 'sample.item', target: { kind: 'sample.item', id: 'one' }, properties: { 'sample.value': 6 } }] }, { ...context, expectedRevisions: { 'sample.scope': 0 } })
  const call = remember.mock.calls.find(args => args[0] === result.undoRef)!
  expect(call[2]).toBeTypeOf('function')
  call[2]()
  await expect(applicationReflectionHandlers.undoEntities({ undoRef: result.undoRef! }, context)).rejects.toThrow('NOT_FOUND')
  expect(fixture.values.get('one')).toBe(6)
})

it('同一 requestId 的撤销在零执行冲突消除后可以重试', async () => {
  const fixture = createFixture()
  state.current = { fixture, ...createEngine(fixture) }
  const context = { requestId: 'same-undo-operation', signal: new AbortController().signal }
  const result = await applicationReflectionHandlers.changeEntities({ summary: '修改数值', changes: [{ kind: 'set_properties', entityType: 'sample.item', target: { kind: 'sample.item', id: 'one' }, properties: { 'sample.value': 6 } }] }, { ...context, expectedRevisions: { 'sample.scope': 0 } })
  fixture.revisions.value += 1
  await expect(applicationReflectionHandlers.undoEntities({ undoRef: result.undoRef! }, context)).rejects.toThrow('应用状态已变化')
  fixture.revisions.value -= 1
  await expect(applicationReflectionHandlers.undoEntities({ undoRef: result.undoRef! }, context)).resolves.toMatchObject({ status: 'completed' })
  expect(fixture.values.get('one')).toBe(2)
})

it('撤销回执不限连接：一个助手做的修改可由另一个助手撤销，用过的回执不能再撤', async () => {
  const fixture = createFixture()
  state.current = { fixture, ...createEngine(fixture) }
  const author = { requestId: 'author-change', signal: new AbortController().signal, callerGrant: createApplicationCallerGrant({ callerId: 'external-client' }) }
  const other = { requestId: 'other-undo', signal: new AbortController().signal, callerGrant: createApplicationCallerGrant({ callerId: 'embedded-assistant' }) }
  const result = await applicationReflectionHandlers.changeEntities({ summary: '修改数值', changes: [{ kind: 'set_properties', entityType: 'sample.item', target: { kind: 'sample.item', id: 'one' }, properties: { 'sample.value': 6 } }] }, { ...author, expectedRevisions: { 'sample.scope': 0 } })
  expect(fixture.values.get('one')).toBe(6)
  await expect(applicationReflectionHandlers.undoEntities({ undoRef: result.undoRef! }, other)).resolves.toMatchObject({ status: 'completed' })
  expect(fixture.values.get('one')).toBe(2)
  // 原作者和别的助手都不能把同一份回执再撤一次
  for (const context of [author, other]) await expect(applicationReflectionHandlers.undoEntities({ undoRef: result.undoRef! }, { ...context, requestId: context.requestId + '-again' })).rejects.toThrow('NOT_FOUND')
  expect(fixture.values.get('one')).toBe(2)
})
