import { describe, expect, it } from 'vitest'

import { extractResultReferences } from './runner-results'

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
})
