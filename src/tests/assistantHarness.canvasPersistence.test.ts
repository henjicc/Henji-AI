// @vitest-environment jsdom
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { getProjectRecord } from '@/commands/projectState'
import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore } from '@/stores/projectStore'
import { loadRealModelsIntoRegistry } from './loadRealModels'
import { runAssistantHarness, type HarnessModelStep } from './assistantRuntimeHarness'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from './harnessNativeStorage'

beforeAll(async () => { installHarnessNativeStorage(); await loadRealModelsIntoRegistry() })
afterAll(() => { vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

function script(id: string, source: string): HarnessModelStep {
  return { actions: [{ type: 'tool_call', toolCall: {
    toolCallId: id, toolName: 'run_henji_script', dynamic: false,
    input: { language: 'henji-ts/v1', summary: id, source },
  } }] }
}

it('正式助手写入遭存储拒绝后通过恢复动作保存同一修改，不重建节点', async () => {
  useCanvasStore.getState().setCanvasData([], [], { past: [], future: [] })
  useProjectStore.setState({ projects: [], currentProjectId: null, currentProject: null, isHydrated: true })
  const projectId = await useProjectStore.getState().createProject('隔离保存恢复')
  const saves = vi.spyOn(window.henjiNative!.storyboardProjects, 'upsertProjectRecord')
    .mockRejectedValueOnce(new Error('readonly storage'))
  const result = await runAssistantHarness({
    goal: '创建一个图片上传节点。如果磁盘保存失败，只重试保存，不重复创建节点。', intent: 'canvas',
    steps: [
      { actions: [{ type: 'tool_call', toolCall: {
        toolCallId: 'discover-save', toolName: 'discover_application_capabilities', dynamic: false,
        input: { queries: ['创建画布节点', '重试保存画布项目'], domains: ['canvas'],
          entityTypes: ['canvas.project', 'canvas.node', 'canvas.node_type'], writes: true },
      } }] },
      script('create-once', `await app.action('get_canvas_node_schema', { nodeType: 'uploadNode' }); await app.action('add_canvas_node', { projectId: '${projectId}', nodeType: 'uploadNode', placement: { mode: 'viewport_center' } });`),
      script('retry-save', `await app.action('retry_canvas_project_save', { projectRef: { kind: 'canvas.project', id: '${projectId}' } });`),
      { actions: [{ type: 'text', value: '原节点已保存，没有再次创建。' }] },
    ],
  })
  const calls = result.toolCalls.filter((call) => call.toolName === 'run_henji_script')
  expect(calls[0]?.ok, JSON.stringify(result.toolCalls)).toBe(false)
  expect(calls[0]?.errorMessage).toContain('画布修改已保留在当前会话')
  expect(calls[0]?.errorMessage).toContain('保存未确认')
  expect(calls[0]?.errorMessage).toContain('请重试保存，不要重复新增、删除或撤销操作')
  expect(calls[1]?.ok, JSON.stringify(result.toolCalls)).toBe(true)
  const record = (await getProjectRecord(projectId))!
  expect(JSON.parse(record.nodesJson)).toHaveLength(1)
  expect(JSON.parse(record.historyJson).past).toHaveLength(1)
  expect(useCanvasStore.getState().nodes).toHaveLength(1)
  expect(saves).toHaveBeenCalledTimes(2)
  expect(useProjectStore.getState().persistenceError).toBeNull()
  const effects = result.state.executionOutcome.effects
  expect(effects.some((effect) => effect.effect === 'execute'
    && effect.targetRefs.some((ref) => ref.kind === 'canvas.project' && ref.id === projectId)), JSON.stringify(effects)).toBe(true)
  expect(effects.filter((effect) => effect.effect === 'create' && effect.entityTypes.includes('canvas.node'))).toHaveLength(0)
})
