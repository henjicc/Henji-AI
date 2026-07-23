import { describe, expect, it } from 'vitest'

import { AGENT_CONTRACT_VERSION, type HostContextSnapshot } from '../../../../../../src/core/assistant/hostContracts'
import { createBuiltinAgentToolRegistry } from './index'

function context(commands: string[]): HostContextSnapshot {
  return {
    schemaVersion: AGENT_CONTRACT_VERSION,
    rendererSessionId: 'renderer-canvas',
    revision: 1,
    scopeRevisions: { navigation: 0, generation: 0, canvas: 0, toolbox: 0, assets: 0 },
    workspace: { id: 'nodes', activeToolId: null },
    project: { id: commands.includes('add_canvas_node') ? 'project-1' : null, selectedNodeId: null },
    generation: { commandReady: false },
    assets: { view: 'closed', selectedAssetId: null },
    uiReady: true,
    availableCommands: ['switch_workspace', 'open_canvas_project', ...commands],
    availableQueries: ['list_canvas_projects', 'search_canvas_node_types', 'get_canvas_node_schema'],
    capturedAt: new Date().toISOString(),
  }
}

describe('frontend canvas builtin tools', () => {
  it('按宿主实际命令目录隐藏尚无项目目标的写工具', () => {
    const registry = createBuiltinAgentToolRegistry(() => Promise.reject(new Error('not executed')))
    const withoutProject = registry.list(context([])).map((item) => item.name)
    expect(withoutProject).toEqual(expect.arrayContaining([
      'list_canvas_projects', 'open_canvas_project', 'search_canvas_node_types', 'get_canvas_node_schema',
    ]))
    expect(withoutProject).not.toContain('add_canvas_node')

    const withProject = registry.list(context([
      'add_canvas_node', 'connect_canvas_nodes', 'focus_canvas_node', 'undo_canvas_change',
    ])).map((item) => item.name)
    expect(withProject).toEqual(expect.arrayContaining([
      'add_canvas_node', 'connect_canvas_nodes', 'focus_canvas_node', 'undo_canvas_change',
    ]))
  })
})
