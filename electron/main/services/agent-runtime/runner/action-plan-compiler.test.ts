import { describe, expect, it } from 'vitest'

import type { ModelStepToolCall } from '../../../../../src/core/llm/modelStep'
import { createBuiltinAgentToolRegistry } from '../tools/builtin'
import { compileActionGroups } from './action-plan-compiler'

function changeCall(index: number, propertyId: string, value: unknown): ModelStepToolCall {
  return {
    toolCallId: `change-${index}`,
    toolName: 'change_application_entities',
    dynamic: false,
    input: {
      summary: `修改 ${propertyId}`,
      changes: [{
        kind: 'set_properties',
        target: { kind: 'settings.item', id: `setting-${index}` },
        entityType: 'settings.item',
        properties: { [propertyId]: value },
      }],
    },
  }
}

describe('Action Plan Compiler', () => {
  it('两个画布节点加两项参数修改编译为一个四操作原生批次', () => {
    const registry = createBuiltinAgentToolRegistry(async () => {
      throw new Error('测试不执行前端工具')
    })
    const placement = { mode: 'viewport_center' as const }
    const calls: ModelStepToolCall[] = [{
      toolCallId: 'add-1', toolName: 'add_canvas_node', dynamic: false,
      input: { projectId: 'project-1', nodeType: 'text', placement },
    }, {
      toolCallId: 'add-2', toolName: 'add_canvas_node', dynamic: false,
      input: { projectId: 'project-1', nodeType: 'image', placement },
    }, {
      toolCallId: 'update-1', toolName: 'update_canvas_node', dynamic: false,
      input: { projectId: 'project-1', nodeId: 'node-1', data: { prompt: 'A' } },
    }, {
      toolCallId: 'update-2', toolName: 'update_canvas_node', dynamic: false,
      input: { projectId: 'project-1', nodeId: 'node-2', data: { prompt: 'B' } },
    }]
    const group = compileActionGroups(
      calls,
      { canvas: 7 },
      registry
    )[0]
    expect(group).toMatchObject({
      mode: 'atomic_batch', atomic: true, reversible: true,
      canvasBatch: { projectId: 'project-1' },
    })
    expect(group?.canvasBatch?.operations.map((operation) => operation.kind))
      .toEqual(['add_node', 'add_node', 'update_node', 'update_node'])
    expect(group?.executableCalls).toHaveLength(0)
  })

  it('多个普通实体修改编译为一次 change_application_entities 事务', () => {
    const registry = createBuiltinAgentToolRegistry(async () => {
      throw new Error('测试不执行前端工具')
    })
    const calls = [
      changeCall(1, 'settings.item.value', true),
      changeCall(2, 'settings.item.value', false),
    ]
    const groups = compileActionGroups(calls, { navigation: 2 }, registry)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      mode: 'atomic_batch', reversible: true, atomic: false,
      memberCalls: [{ toolCallId: 'change-1' }, { toolCallId: 'change-2' }],
      executableCalls: [{ toolName: 'change_application_entities' }],
    })
    expect((groups[0]?.executableCalls[0]?.input as { changes: unknown[] }).changes).toHaveLength(2)
    expect(Object.isFrozen(groups[0])).toBe(true)
    expect(Object.isFrozen(groups[0]?.memberCalls[0]?.input)).toBe(true)
    expect(Object.isFrozen((groups[0]?.executableCalls[0]?.input as { changes: unknown[] }).changes)).toBe(true)
  })

  it('修改内容或 expected revision 改变后 digest 失效', () => {
    const registry = createBuiltinAgentToolRegistry(async () => {
      throw new Error('测试不执行前端工具')
    })
    const calls = [changeCall(1, 'settings.item.value', true), changeCall(2, 'settings.item.value', false)]
    const first = compileActionGroups(calls, { navigation: 2 }, registry)[0]
    const changedRevision = compileActionGroups(calls, { navigation: 3 }, registry)[0]
    const changedTarget = compileActionGroups([
      calls[0] as ModelStepToolCall,
      changeCall(3, 'settings.item.value', false),
    ], { navigation: 2 }, registry)[0]
    expect(first?.digest).not.toBe(changedRevision?.digest)
    expect(first?.digest).not.toBe(changedTarget?.digest)
  })

  it('依赖不同工具输出的序列不会被错误合并', () => {
    const registry = createBuiltinAgentToolRegistry(async () => {
      throw new Error('测试不执行前端工具')
    })
    const groups = compileActionGroups([changeCall(1, 'settings.item.value', true), {
      toolCallId: 'read-2', toolName: 'read_application_entity', dynamic: false,
      input: { ref: { kind: 'settings.item', id: 'setting-1' }, propertyIds: [] },
    }], { navigation: 2 }, registry)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ mode: 'ordered_write', atomic: false })
    expect(groups[0]?.executableCalls).toHaveLength(2)
  })

  it('Task Graph 的 actionGroupId 是编译边界，不把同轮不同组误合并', () => {
    const registry = createBuiltinAgentToolRegistry(async () => {
      throw new Error('测试不执行前端工具')
    })
    const calls: ModelStepToolCall[] = [1, 2].map((index) => ({
      toolCallId: `add-${index}`,
      toolName: 'add_canvas_node',
      dynamic: false,
      input: { projectId: 'project-1', nodeType: 'text', placement: { mode: 'viewport_center' } },
    }))
    const groups = compileActionGroups(calls, { canvas: 7 }, registry, (call) => ({
      actionGroupId: call.toolCallId === 'add-1' ? 'first_group' : 'second_group',
      mode: 'ordered_write',
    }))

    expect(groups).toHaveLength(2)
    expect(groups.map((group) => group.actionGroupId)).toEqual(['first_group', 'second_group'])
    expect(groups.every((group) => !group.canvasBatch && group.atomic === false)).toBe(true)
  })

  it('不可逆步骤即使声明 atomic_batch 也降级为非原子有序执行', () => {
    const registry = createBuiltinAgentToolRegistry(async () => {
      throw new Error('测试不执行前端工具')
    })
    const calls: ModelStepToolCall[] = [1, 2].map((index) => ({
      toolCallId: `cancel-${index}`,
      toolName: 'cancel_generation_task',
      dynamic: false,
      input: { taskId: `task-${index}`, reason: '用户要求停止' },
    }))
    const [group] = compileActionGroups(calls, { generation: 3 }, registry, () => ({
      actionGroupId: 'cancel_group', mode: 'atomic_batch',
    }))

    expect(group).toMatchObject({
      actionGroupId: 'cancel_group', mode: 'ordered_write', atomic: false, reversible: false,
    })
    expect(group?.executableCalls).toHaveLength(2)
  })
})
