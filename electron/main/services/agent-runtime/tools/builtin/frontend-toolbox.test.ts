import { describe, expect, it } from 'vitest'

import { AGENT_CONTRACT_VERSION, type HostContextSnapshot } from '../../../../../../src/core/assistant/hostContracts'
import { createBuiltinAgentToolRegistry } from './index'

function context(commands: string[], queries: string[], activeToolId: 'cameraStage' | 'imageMark' | null = 'cameraStage'): HostContextSnapshot {
  return {
    schemaVersion: AGENT_CONTRACT_VERSION,
    rendererSessionId: 'renderer-toolbox',
    revision: 1,
    scopeRevisions: { navigation: 0, generation: 0, canvas: 0, toolbox: 0, assets: 0 },
    workspace: { id: 'tools', activeToolId },
    project: { id: null, selectedNodeId: null },
    generation: { commandReady: false },
    assets: { view: 'closed', selectedAssetId: null },
    uiReady: true,
    availableCommands: ['switch_workspace', ...commands],
    availableQueries: queries,
    capturedAt: new Date().toISOString(),
  }
}

describe('frontend toolbox builtin tools', () => {
  it('注册 3D、分镜和图片编辑的稳定工具，并按宿主目录过滤', () => {
    const registry = createBuiltinAgentToolRegistry(() => Promise.reject(new Error('not executed')))
    const names = registry.list(context([
      'select_toolbox_tool',
      'rename_camera_stage_project',
      'delete_camera_stage_project',
      'duplicate_camera_stage_object',
      'delete_camera_stage_object',
      'update_camera_stage_object',
      'create_image_edit_preview',
      'commit_image_edit',
    ], [
      'list_toolbox_tools',
      'get_toolbox_state',
      'list_camera_stage_projects',
      'get_camera_stage_project',
      'list_storyboard_projects',
      'get_storyboard_project',
    ])).map((item) => item.name)

    expect(names).toEqual(expect.arrayContaining([
      'rename_camera_stage_project',
      'delete_camera_stage_project',
      'duplicate_camera_stage_object',
      'delete_camera_stage_object',
      'update_camera_stage_object',
      'list_storyboard_projects',
      'get_storyboard_project',
      'create_image_edit_preview',
      'commit_image_edit',
    ]))
  })

  it('图片编辑输入拒绝未声明的标记结构', () => {
    const registry = createBuiltinAgentToolRegistry(() => Promise.reject(new Error('not executed')))
    const definition = registry.get('create_image_edit_preview')
    expect(definition).toBeDefined()
    expect(definition?.inputSchema.safeParse({
      assetId: 'asset-1',
      operations: [{ kind: 'mark', item: { type: 'unknown', x: 0, y: 0 } }],
    }).success).toBe(false)
    expect(definition?.inputSchema.safeParse({
      assetId: 'asset-1',
      operations: [{ kind: 'crop', crop: { x: 0, y: 0, width: 100, height: 100 } }],
    }).success).toBe(true)
  })
})
