import { describe, expect, it } from 'vitest'

import type { AgentToolExecuteRequest } from '../tools/types'
import type { AgentToolGateway } from '../tools/gateway'
import type { AgentToolGatewayResult } from '../../../../../src/core/assistant/toolContracts'
import type { HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import { DeterministicWorkflowService } from './service'

function context(): HostContextSnapshot {
  return {
    schemaVersion: 'agent-contract/v2',
    rendererSessionId: 'session-1',
    revision: 0,
    scopeRevisions: { navigation: 0, generation: 0, canvas: 0, toolbox: 0, assets: 0 },
    workspace: { id: 'generation', activeToolId: null },
    project: { id: 'project-1', selectedNodeId: null },
    generation: { commandReady: true },
    assets: { view: 'closed', selectedAssetId: null },
    uiReady: true,
    availableCapabilities: [],
    capturedAt: new Date().toISOString(),
  }
}

function createGateway(
  current: HostContextSnapshot,
  options?: { failTool?: string; mutateAfter?: string; requireApprovalTool?: string }
): { gateway: AgentToolGateway; calls: AgentToolExecuteRequest[] } {
  const calls: AgentToolExecuteRequest[] = []
  const gateway = {
    execute: async (request: AgentToolExecuteRequest): Promise<AgentToolGatewayResult> => {
      calls.push(request)
      if (options?.failTool === request.toolName) throw new Error('[EXECUTION_FAILED] 测试步骤失败')
      if (options?.requireApprovalTool === request.toolName) {
        return {
          status: 'approval_required',
          approval: {
            approvalId: 'nested-approval', runId: request.runId,
            toolCallId: request.toolCallId, toolName: request.toolName, toolVersion: 1,
            risk: 'R3', title: '嵌套审批', summary: '工作流内部高风险步骤',
            argsDigest: 'a', previewDigest: 'p', targetIds: {}, dataClasses: ['C1'],
            expectedRevisions: {}, permission: 'test:high_risk', scope: 'test:high_risk:x',
            expiresAt: new Date(Date.now() + 60_000).toISOString(), reversible: false,
          },
        }
      }
      const revisions = { ...current.scopeRevisions }
      const scope = request.toolName.includes('canvas') || request.toolName === 'add_canvas_node' || request.toolName === 'add_asset_to_canvas' || request.toolName === 'open_canvas_project'
        ? 'canvas'
        : request.toolName.includes('generation') || request.toolName === 'prepare_generation_task'
          ? 'generation'
          : request.toolName.includes('toolbox') || request.toolName.includes('image_edit')
            ? 'toolbox'
            : 'navigation'
      revisions[scope] += 1
      const output: Record<string, unknown> = {
        scopeRevisions: revisions,
        status: 'submitted',
      }
      if (request.toolName === 'create_image_edit_preview') output.previewRef = 'preview-1'
      if (request.toolName === 'commit_image_edit') output.assetId = 'asset-2'
      if (request.toolName === 'add_canvas_node') output.undoRef = 'canvas-undo-1'
      if (request.toolName === 'add_asset_to_canvas') output.undoRef = 'canvas-undo-asset-1'
      current.scopeRevisions = options?.mutateAfter === request.toolName
        ? { ...revisions, canvas: revisions.canvas + 1 }
        : revisions
      return { status: 'completed', observation: {
        source: { toolName: request.toolName, toolVersion: 1, toolCallId: request.toolCallId },
        trust: 'untrusted_observation', dataClasses: ['C1'], summary: 'ok', output,
      }, cached: false }
    },
  } as unknown as AgentToolGateway
  return { gateway, calls }
}

describe('DeterministicWorkflowService', () => {
  it('按代码固定顺序执行模型生成到画布，并保存可补偿引用', async () => {
    const service = new DeterministicWorkflowService()
    const host = context()
    const { gateway, calls } = createGateway(host)
    const plan = service.plan('model_to_generation_canvas', {
      projectId: 'project-1', modelId: 'model-1', mediaType: 'image', prompt: '猫',
    }, host)
    const result = await service.execute(String(plan.planRef), {
      runId: 'run-1', threadId: 'thread-1', toolCallId: 'call-1', signal: new AbortController().signal,
      gateway, getHostContext: () => host,
    })
    expect(result).toMatchObject({ status: 'completed', totalSteps: 5 })
    expect(calls.map((call) => call.toolName)).toEqual([
      'switch_workspace', 'prepare_generation_task', 'create_visible_generation_task',
      'open_canvas_project', 'add_canvas_node',
    ])
    expect((result.compensations as Array<Record<string, unknown>>)[0]).toMatchObject({ stepId: 'add-generation-node' })
    const workflowRunRef = String(result.workflowRunRef)
    expect(calls.every((call) => call.authorizationSource === 'approved_workflow')).toBe(true)
    expect(calls.every((call) => call.parentToolCallId === 'call-1')).toBe(true)
    expect(calls.every((call) => call.toolCallId.startsWith(`workflow:${workflowRunRef}:step:`))).toBe(true)
  })

  it('用户在步骤间改变 revision 时暂停为失败，不覆盖新状态', async () => {
    const service = new DeterministicWorkflowService()
    const host = context()
    const { gateway } = createGateway(host, { mutateAfter: 'open_canvas_project' })
    const plan = service.plan('model_to_generation_canvas', {
      projectId: 'project-1', modelId: 'model-1', mediaType: 'image', prompt: '猫',
    }, host)
    const result = await service.execute(String(plan.planRef), {
      runId: 'run-1', threadId: 'thread-1', toolCallId: 'call-1', signal: new AbortController().signal,
      gateway, getHostContext: () => host,
    })
    expect(result).toMatchObject({ status: 'failed' })
    expect((result.error as Record<string, unknown>).code).toBe('STALE_CONTEXT')
  })

  it('素材编辑工作流会传递预览引用，且可从完成状态执行补偿回滚', async () => {
    const service = new DeterministicWorkflowService()
    const host = context()
    const { gateway, calls } = createGateway(host)
    const plan = service.plan('asset_edit_to_canvas', {
      assetId: 'asset-1', projectId: 'project-1', operations: [{ kind: 'rotate_cw' }],
    }, host)
    const result = await service.execute(String(plan.planRef), {
      runId: 'run-1', threadId: 'thread-1', toolCallId: 'call-1', signal: new AbortController().signal,
      gateway, getHostContext: () => host,
    })
    expect(result.status).toBe('completed')
    expect(calls.some((call) => call.toolName === 'select_toolbox_tool')).toBe(false)
    expect(calls.filter((call) => call.toolName === 'open_canvas_project')).toHaveLength(1)
    const commit = calls.find((call) => call.toolName === 'commit_image_edit')
    expect(commit?.input).toMatchObject({ previewRef: 'preview-1' })
    const addAsset = calls.find((call) => call.toolName === 'add_asset_to_canvas')
    expect(addAsset?.input).toMatchObject({ assetId: 'asset-2' })
    const runRef = String(result.workflowRunRef)
    const rollback = await service.rollback(runRef, {
      runId: 'run-2', threadId: 'thread-1', toolCallId: 'call-2', signal: new AbortController().signal,
      gateway, getHostContext: () => host,
    })
    expect(rollback.status).toBe('rolled_back')
    const compensationCalls = calls.filter((call) => call.toolCallId.includes(':compensation:'))
    expect(compensationCalls.every((call) => call.parentToolCallId === 'call-2')).toBe(true)
    expect(compensationCalls.every((call) => call.authorizationSource === 'approved_workflow')).toBe(true)
  })

  it('内部 R3/C2 子步骤需要独立审批时不会被父工作流授权吞掉', async () => {
    const service = new DeterministicWorkflowService()
    const host = context()
    const { gateway, calls } = createGateway(host, { requireApprovalTool: 'prepare_generation_task' })
    const plan = service.plan('model_to_generation_canvas', {
      projectId: 'project-1', modelId: 'model-1', mediaType: 'image', prompt: '猫',
    }, host)
    const result = await service.execute(String(plan.planRef), {
      runId: 'run-1', threadId: 'thread-1', toolCallId: 'call-1',
      signal: new AbortController().signal, gateway, getHostContext: () => host,
    })

    expect(result).toMatchObject({ status: 'failed' })
    expect(calls.map((call) => call.toolName)).toEqual([
      'switch_workspace',
      'prepare_generation_task',
    ])
  })
})
