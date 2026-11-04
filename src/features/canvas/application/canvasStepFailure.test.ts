import { canvasTestRegistry, setCanvasTestProjectState, createCanvasTestProject } from '@/tests/canvasProjectFixture'
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApplicationExecutionProgressFailure, applicationFailureOrigin, isApplicationCancellation, isApplicationConflict } from '@/core/application-control/execution/persistence'
import { useCanvasStore } from '@/stores/canvasStore'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { CANVAS_NODE_TYPES } from '../domain/canvasNodes'
import { addCanvasNode } from './canvasApplicationService'
import { CanvasCollectionExecutor } from './canvasCollectionExecutor'
import { CanvasNodeMutationExecutor } from './canvasMutationExecutor'
import { CanvasSourceCompensationError, CanvasTransactionConflictError } from './canvasPersistenceService'
import { CANVAS_ENTITY_TYPES } from './canvasReflection'
import { canvasRemainingWrite, canvasStepFailure } from './canvasStepFailure'

/*
 * 通用事务里画布写入之后的失败（保存未确认、并发冲突、来源补偿未完成）必须带着这一步的写入事实交给引擎。
 * 原样抛出会被报成“没有任何步骤被提交、可以直接重试”，助手重试就叠出重复节点。
 */
describe('画布执行器写入后的失败如实报告', () => {
  let projectId: string
  beforeEach(async () => {
    installHarnessNativeStorage()
    useCanvasStore.getState().setCanvasData([], [], { past: [], future: [] })
    setCanvasTestProjectState({ currentProject: null, currentProjectId: null })
    projectId = await createCanvasTestProject('执行器失败测试')
  })
  afterEach(() => {
    vi.restoreAllMocks()
    setCanvasTestProjectState({ currentProjectId: null, currentProject: null })
    uninstallHarnessNativeStorage()
  })

  it('集合新建后保存未确认：报告新节点为未补偿写入', async () => {
    canvasTestRegistry().commands.failSaves = 1
    const failure = await new CanvasCollectionExecutor(CANVAS_ENTITY_TYPES.node).apply({
      kind: 'collection', parent: { kind: CANVAS_ENTITY_TYPES.project, id: projectId }, entityType: CANVAS_ENTITY_TYPES.node,
      expectedRevisions: {}, operation: { kind: 'create', items: [{ properties: { 'canvas.node.node_type': CANVAS_NODE_TYPES.textAnnotation } }] },
    }).catch((error) => error)
    expect(failure).toBeInstanceOf(ApplicationExecutionProgressFailure)
    expect(failure.compensatedStepIndexes).toEqual([])
    const nodeId = useCanvasStore.getState().nodes[0].id
    expect(failure.completed[0].directRefs).toEqual([{ kind: CANVAS_ENTITY_TYPES.node, id: `${projectId}:${nodeId}` }])
  })

  it('节点属性写入后保存未确认：报告目标节点为未补偿写入', async () => {
    const created = await addCanvasNode({ projectId, nodeType: CANVAS_NODE_TYPES.textAnnotation, placement: { mode: 'viewport_center' } })
    canvasTestRegistry().commands.failSaves = 1
    const target = { kind: CANVAS_ENTITY_TYPES.node, id: `${projectId}:${String(created.nodeId)}` }
    const failure = await new CanvasNodeMutationExecutor().apply({ kind: 'mutation', target, entityType: CANVAS_ENTITY_TYPES.node, expectedRevisions: {},
      mutations: [{ propertyId: 'canvas.node.display_name', operation: 'set', value: '新名字' }] }, { requestId: 'canvas-step-failure', exposure: 'assistant', acceptedDataClasses: new Set(['C1']) })
      .catch((error) => error)
    expect(failure).toBeInstanceOf(ApplicationExecutionProgressFailure)
    expect(failure.compensatedStepIndexes).toEqual([])
    expect(failure.completed[0].directRefs).toEqual([target])
  })

  it('并发冲突带着写入报告，错误码仍能认出冲突', () => {
    const failure = canvasStepFailure(new CanvasTransactionConflictError(projectId), () => [canvasRemainingWrite(projectId, [])])
    expect(failure).toBeInstanceOf(ApplicationExecutionProgressFailure)
    expect((failure as ApplicationExecutionProgressFailure).compensatedStepIndexes).toEqual([])
    expect(isApplicationConflict(applicationFailureOrigin(failure))).toBe(true)
    const beforeWrite = new CanvasTransactionConflictError(projectId, undefined, false)
    expect(canvasStepFailure(beforeWrite, () => [canvasRemainingWrite(projectId, [])])).toBe(beforeWrite)
  })

  it('来源补偿失败带着写入报告，原始错误的取消性质不丢', () => {
    const original = new DOMException('This operation was aborted', 'AbortError')
    const failure = canvasStepFailure(new CanvasSourceCompensationError(original, [new Error('来源文档只读')]), () => [canvasRemainingWrite(projectId, [])])
    expect(failure).toBeInstanceOf(ApplicationExecutionProgressFailure)
    expect((failure as ApplicationExecutionProgressFailure).message).toContain('来源文档只读')
    expect(isApplicationCancellation(applicationFailureOrigin(failure))).toBe(true)
  })
})
