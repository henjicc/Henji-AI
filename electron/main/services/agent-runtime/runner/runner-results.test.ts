import { describe, expect, it } from 'vitest'

import type { AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import { extractResultReferences, toolMessage } from './runner-results'

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
  it('提取生成、画布、素材、图片编辑和工作流稳定引用', () => {
    expect(extractResultReferences({
      taskId: 'task-1',
      nodeId: 'node-1',
      assetId: 'asset-1',
      previewRef: 'preview-1',
      workflowRunId: 'workflow-run-1',
      ignored: 'internal-value',
    })).toEqual({
      taskId: 'task-1',
      nodeId: 'node-1',
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
