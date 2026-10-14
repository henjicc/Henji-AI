import { describe, expect, it } from 'vitest'

import {
  APPLICATION_HOST_CONTRACT_VERSION,
  hostContextSnapshotSchema,
} from './hostContracts'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from './builtinApplicationCapabilityRegistry'
import { VIDEO_EDIT_FOCUSABLE_PANELS } from '../videoEdit/panels'
import { TOOL_DESCRIPTORS } from '../toolbox/toolCatalog'

describe('application host contracts', () => {
  it('全部正式工具共享宿主枚举，打开新工具不会中断上下文发布', () => {
    for (const tool of TOOL_DESCRIPTORS) expect(hostContextSnapshotSchema.shape.workspace.parse({ id: 'tools', activeToolId: tool.id }).activeToolId).toBe(tool.id)
    expect(hostContextSnapshotSchema.shape.workspace.safeParse({ id: 'tools', activeToolId: 'missing' }).success).toBe(false)
  })
  it('剪辑任一可聚焦面板都能通过宿主上下文校验（曾漏 ColorGrade / 标题模板 / 跟踪，导致助手读取全部失败）', () => {
    const videoEdit = hostContextSnapshotSchema.shape.videoEdit.unwrap()
    for (const focusedPanel of VIDEO_EDIT_FOCUSABLE_PANELS) {
      expect(videoEdit.safeParse({ documentRef: 'video_edit.document:p', sequenceRef: null, frame: 0, playing: false, inFrame: null, outFrame: null, focusedPanel, selectedClipRefs: [], openAnnotations: { count: 0, items: [] }, targetTrackRefs: [] }).success, focusedPanel).toBe(true)
    }
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
      schemaVersion: APPLICATION_HOST_CONTRACT_VERSION,
      rendererEpoch: 'renderer-1',
      revision: 4,
      scopeRevisions: { navigation: 1, generation: 0, canvas: 2, toolbox: 1, assets: 0 },
      workspace: { id: 'nodes', activeToolId: null },
      canvas: { id: 'project-1', selectedNodeId: 'node-1' },
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
