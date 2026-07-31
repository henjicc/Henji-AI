import { describe, expect, it } from 'vitest'

import {
  AGENT_CONTRACT_VERSION,
  frontendToolRequestSchema,
  hostContextSnapshotSchema,
  LEGACY_AGENT_CONTRACT_VERSION,
  parseHostContextSnapshot,
} from './hostContracts'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from './builtinApplicationCapabilityRegistry'

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
        kind: 'capability',
        capability: {
          id: 'add_canvas_node',
          version: 1,
          input: {
            projectId: 'project-1',
            nodeType: 'imageNode',
            placement: { mode: 'viewport_center' },
          },
          expectedRevisions: { canvas: 3 },
        },
      },
    })
    expect(request.operation.kind).toBe('capability')
  })

  it('拒绝没有明确项目 ID 的画布能力输入', () => {
    const capability = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get('add_canvas_node')
    expect(capability).toBeDefined()
    expect(() => capability?.inputSchema.parse({
      nodeType: 'imageNode',
      placement: { mode: 'viewport_center' },
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
      availableCapabilities: ['switch_workspace', 'get_current_application_context'],
      capturedAt: new Date().toISOString(),
    })
    expect(snapshot.revision).toBe(4)
  })

  it('只读迁移 v1 快照中的旧工具目录', () => {
    const snapshot = parseHostContextSnapshot({
      schemaVersion: LEGACY_AGENT_CONTRACT_VERSION,
      rendererSessionId: 'renderer-legacy',
      revision: 1,
      scopeRevisions: { navigation: 0, generation: 0, canvas: 0, toolbox: 0, assets: 0 },
      workspace: { id: 'generation', activeToolId: null },
      project: { id: null, selectedNodeId: null },
      generation: { commandReady: true },
      assets: { view: 'closed', selectedAssetId: null },
      uiReady: true,
      availableCommands: ['switch_workspace'],
      availableQueries: ['get_current_application_context', 'switch_workspace'],
      capturedAt: new Date().toISOString(),
    })
    expect(snapshot.schemaVersion).toBe(AGENT_CONTRACT_VERSION)
    expect(snapshot.availableCapabilities).toEqual([
      'switch_workspace',
      'get_current_application_context',
    ])
    expect('availableCommands' in snapshot).toBe(false)
  })
})
