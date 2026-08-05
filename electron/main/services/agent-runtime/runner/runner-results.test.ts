import { describe, expect, it } from 'vitest'

import type { AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import { AgentStopPolicyExceededError } from './budget'
import { extractResultReferences, serializeError, toolMessage } from './runner-results'

function observation(output: unknown): AgentToolObservation {
  return {
    source: { toolName: 'search_models', toolVersion: 1, toolCallId: 'call-1' },
    trust: 'untrusted_observation',
    dataClasses: ['C0'],
    summary: '模型目录搜索返回 32 项。',
    output,
  }
}

describe('Agent 结果引用', () => {
  /*
   * 回归：卸载门槛与真实上下文预算脱钩。
   *
   * 固定 8KB 门槛让 80KB 的实体结构文档被推去做 4KB 分页，模型花 20 轮把刚拿到的数据一页页
   * 读回来——而当时用的是 100 万上下文窗口，峰值只占 3%。
   */
  it('卸载门槛跟随上下文窗口，大窗口下工具结果直接内联', () => {
    const call = { toolCallId: 'call-1', toolName: 'describe_application_entities', input: {}, dynamic: false }
    const large = observation({ ok: true, properties: Array.from({ length: 40 }, (_, index) => ({
      propertyId: `camera_stage.object.property_${index}`,
      writable: true,
      description: '属'.repeat(200),
    })) })
    const inlined = String(JSON.stringify(toolMessage(call, large, 1_000_000)))
    const offloaded = String(JSON.stringify(toolMessage(call, large, 8_000)))
    expect(inlined).toContain('camera_stage.object.property_39')
    expect(offloaded).toContain('largeResultOmitted')
    // 无论窗口多大都保留绝对上限，避免单条结果吃掉整段历史。
    const huge = observation({ ok: true, blob: 'x'.repeat(700 * 1024) })
    expect(String(JSON.stringify(toolMessage(call, huge, 1_000_000)))).toContain('largeResultOmitted')
  })

  it('提取生成、画布、素材、图片编辑和工作流稳定引用', () => {
    expect(extractResultReferences({
      taskId: 'task-1',
      nodeId: 'node-1',
      surfaceId: 'workspace.canvas',
      assetId: 'asset-1',
      previewRef: 'preview-1',
      workflowRunId: 'workflow-run-1',
      ignored: 'internal-value',
    })).toEqual({
      taskId: 'task-1',
      nodeId: 'node-1',
      surfaceId: 'workspace.canvas',
      assetId: 'asset-1',
      previewRef: 'preview-1',
      workflowRunId: 'workflow-run-1',
    })
  })

  it('兼容从嵌套生成任务提取 taskId', () => {
    expect(extractResultReferences({ task: { id: 'task-nested' } }))
      .toEqual({ taskId: 'task-nested' })
  })

  it('结果引用数量遵守事件协议上限', () => {
    expect(Object.keys(extractResultReferences({
      taskId: '1', projectId: '2', nodeId: '3', edgeId: '4', undoRef: '5',
      workspace: '6', workspaceId: '7', modelId: '8', assetId: '9',
    }) ?? {})).toHaveLength(8)
  })

  it('运行停止策略向界面返回可执行的用户恢复动作', () => {
    expect(serializeError(new AgentStopPolicyExceededError(
      'CONSECUTIVE_FAILURES',
      '工具连续失败，已停止继续尝试'
    ))).toMatchObject({
      code: 'CONSECUTIVE_FAILURES',
      retryable: false,
      recovery: 'user_action',
    })
  })

  it('将紧凑模型目录留在工具消息中，避免模型看不到候选后重复搜索', () => {
    const output = { models: [{ modelId: 'model-1', description: 'x'.repeat(9_000) }] }
    const message = toolMessage({
      toolCallId: 'call-1', toolName: 'search_models', input: {}, dynamic: false,
    }, observation(output))

    expect(JSON.stringify(message)).toContain('model-1')
    expect(JSON.stringify(message)).not.toContain('largeResultOmitted')
  })

  it('非模型目录的大结果仍遵循通用卸载阈值', () => {
    const message = toolMessage({
      toolCallId: 'call-2', toolName: 'query_diagnostic_events', input: {}, dynamic: false,
    }, observation({ evidence: 'x'.repeat(9_000) }))

    expect(JSON.stringify(message)).toContain('largeResultOmitted')
  })
})
