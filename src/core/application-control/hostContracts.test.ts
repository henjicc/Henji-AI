import { describe, expect, it } from 'vitest'

import {
  APPLICATION_HOST_CONTRACT_VERSION,
  hostContextSnapshotSchema,
} from './hostContracts'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from './builtinApplicationCapabilityRegistry'

describe('application host contracts', () => {
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
      schemaVersion: APPLICATION_HOST_CONTRACT_VERSION,
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

  it('拒绝旧协议宿主快照', () => {
    expect(hostContextSnapshotSchema.safeParse({ schemaVersion: 'agent-contract/v1' }).success).toBe(false)
  })
})
