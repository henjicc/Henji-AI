import { setCanvasTestProjectState, createCanvasTestProject, readCanvasTestProject, canvasSaveSpy, canvasTestRegistry } from '@/tests/canvasProjectFixture'
// @vitest-environment jsdom
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore } from '@/stores/projectStore'
import { loadRealModelsIntoRegistry } from './loadRealModels'
import { createApplicationHarness } from './applicationHarness'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from './harnessNativeStorage'

beforeAll(async () => { installHarnessNativeStorage(); await loadRealModelsIntoRegistry() })
afterAll(() => { vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

it('正式助手写入遭存储拒绝后通过恢复动作保存同一修改，不重建节点', async () => {
  useCanvasStore.getState().setCanvasData([], [], { past: [], future: [] })
  setCanvasTestProjectState({ currentProjectId: null, currentProject: null })
  const projectId = await createCanvasTestProject('隔离保存恢复')
  const saves = canvasSaveSpy()
  canvasTestRegistry().commands.failSaves = 1
  const app = createApplicationHarness()
  try {
    const result = await app.call('change_application_entities', { summary: '新增上传节点', changes: [{
      kind: 'create_items', entityType: 'canvas.node', parent: { kind: 'canvas.project', id: projectId },
      items: [{ properties: { 'canvas.node.node_type': 'uploadNode' } }],
    }] })
    expect(result.ok, JSON.stringify(result)).toBe(false)
    expect(JSON.stringify(result)).toContain('保存未确认')
    expect(JSON.stringify(result)).toContain('不要重复')
    const retry = await app.call('retry_canvas_project_save', { projectRef: { kind: 'canvas.project', id: projectId } })
    expect(retry.ok, JSON.stringify(retry)).toBe(true)
  } finally { app.dispose() }
  const record = (readCanvasTestProject(projectId))!
  expect(record.nodes).toHaveLength(1)
  expect(useCanvasStore.getState().history.past).toHaveLength(1)
  expect(useCanvasStore.getState().nodes).toHaveLength(1)
  expect(saves).toHaveBeenCalledTimes(2)
  expect(useProjectStore.getState().persistenceError).toBeNull()
})
