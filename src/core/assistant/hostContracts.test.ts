import { describe, expect, it } from 'vitest'

import {
  AGENT_CONTRACT_VERSION,
  frontendToolRequestSchema,
  hostCommandSchema,
  hostContextSnapshotSchema,
} from './hostContracts'

describe('assistant host contracts', () => {
  it('校验带 scope revision 的前端工具请求', () => {
    const request = frontendToolRequestSchema.parse({
      schemaVersion: AGENT_CONTRACT_VERSION,
      runId: 'run-1',
      toolCallId: 'tool-1',
      callId: 'call-1',
      idempotencyKey: 'idem-1',
      deadline: Date.now() + 10_000,
      operation: {
        kind: 'command',
        command: {
          name: 'add_canvas_node',
          input: {
            projectId: 'project-1',
            nodeType: 'imageNode',
            placement: { mode: 'viewport_center' },
          },
          expectedRevisions: { canvas: 3 },
        },
      },
    })
    expect(request.operation.kind).toBe('command')
  })

  it('拒绝没有明确项目 ID 的画布写命令', () => {
    expect(() => hostCommandSchema.parse({
      name: 'add_canvas_node',
      input: { nodeType: 'imageNode', placement: { mode: 'viewport_center' } },
    })).toThrow()
  })

  it('快照同时包含 renderer session、全局与 scope revision', () => {
    const snapshot = hostContextSnapshotSchema.parse({
      schemaVersion: AGENT_CONTRACT_VERSION,
      rendererSessionId: 'renderer-1',
      revision: 4,
      scopeRevisions: { navigation: 1, generation: 0, canvas: 2, toolbox: 1, assets: 0 },
      workspace: { id: 'nodes', activeToolId: null },
      project: { id: 'project-1', selectedNodeId: 'node-1' },
      generation: { commandReady: true },
      assets: { view: 'closed', selectedAssetId: null },
      uiReady: true,
      availableCommands: ['switch_workspace'],
      availableQueries: ['get_host_context'],
      capturedAt: new Date().toISOString(),
    })
    expect(snapshot.revision).toBe(4)
  })
})
