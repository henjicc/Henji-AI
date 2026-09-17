import { setCanvasTestProjectState } from '@/tests/canvasProjectFixture';
// @vitest-environment jsdom
// @vitest-environment jsdom
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { ApplicationRef } from '@/core/application-control';
import { readPersistedCanvasProjectSnapshot } from '@/features/canvas/application/canvasQueryService';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';

import { createApplicationHarness } from './applicationHarness';
import { loadRealModelsIntoRegistry } from './loadRealModels';
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from './harnessNativeStorage';

beforeAll(async () => { installHarnessNativeStorage(); await loadRealModelsIntoRegistry() })
afterAll(() => uninstallHarnessNativeStorage())

it('公共实体调用在 A 页面创建、修改并保存 B，打开 B 复用状态和撤销历史', async () => {
  setCanvasTestProjectState({ currentProjectId: null, currentProject: null, projects: [], isHydrated: true })
  const app = createApplicationHarness()
  try {
    const a = await app.requireResult('create_canvas_project', { name: '正在编辑 A' })
    await app.requireResult('open_canvas_project', { projectId: a.projectId })
    const visible = useCanvasStore.getState()
    const b = await app.requireResult('create_canvas_project', { name: '后台 B' })
    const parent = { kind: 'canvas.project', id: String(b.projectId) }
    const result = await app.requireResult('change_application_entities', { summary: '在后台工程创建文本', changes: [{
      kind: 'create_items', parent, entityType: 'canvas.node', items: [{ properties: { 'canvas.node.node_type': 'textAnnotationNode' } }],
    }] })
    const target = (result.resultRefs as ApplicationRef[])[0]
    const changed = await app.change(target, { 'canvas.node.text_content': '后台修改的正文' })
    expect(changed.ok, JSON.stringify(changed)).toBe(true)
    expect(useProjectStore.getState().currentProjectId).toBe(a.projectId)
    expect(useCanvasStore.getState()).toBe(visible)
    expect((await readPersistedCanvasProjectSnapshot(parent.id)).nodes[0].data.content).toBe('后台修改的正文')
    await app.requireResult('open_canvas_project', { projectId: parent.id })
    expect(useCanvasStore.getState().nodes[0].data.content).toBe('后台修改的正文')
    expect(useCanvasStore.getState().undo()).toBe(true)
    expect(useCanvasStore.getState().nodes[0].data.content).not.toBe('后台修改的正文')
  } finally { app.dispose() }
})

it('公共入口连续创建节点和连线，位置与持久化结果一致，旧版本写入被拒绝', async () => {
  const app = createApplicationHarness()
  try {
    useCanvasStore.getState().setCanvasData([], [], { past: [], future: [] })
    setCanvasTestProjectState({ currentProjectId: null, currentProject: null, projects: [], isHydrated: true })
    const project = await app.requireResult('create_canvas_project', { name: '公共画布创建' })
    const parent = { kind: 'canvas.project', id: String(project.projectId) }
    await app.requireResult('open_canvas_project', { projectId: parent.id })
    const created = await app.requireResult('change_application_entities', { summary: '创建两个节点', changes: [{
      kind: 'create_items', parent, entityType: 'canvas.node', items: [
        { properties: { 'canvas.node.node_type': 'stringSourceNode' } },
        { properties: { 'canvas.node.node_type': 'imageNode' } },
      ],
    }] })
    const refs = created.resultRefs as ApplicationRef[]
    expect(refs).toHaveLength(2)
    const baseline = await app.read(refs[0], ['canvas.node.position'])
    const moved = await app.change(refs[0], { 'canvas.node.position': { x: 420, y: 280 } })
    expect(moved.ok, JSON.stringify(moved)).toBe(true)
    const rejected = await app.call('change_application_entities', { summary: '旧基线不应覆盖坐标', changes: [{
      kind: 'set_properties', entityType: 'canvas.node', target: refs[0], properties: { 'canvas.node.position': { x: 0, y: 0 } },
    }] }, baseline.revisions as Record<string, number>)
    expect(rejected.ok, JSON.stringify(rejected)).toBe(false)
    await app.requireResult('change_application_entities', { summary: '连接节点', changes: [{
      kind: 'create_items', parent, entityType: 'canvas.edge', items: [{ properties: {
        'canvas.edge.source_ref': refs[0], 'canvas.edge.target_ref': refs[1],
        'canvas.edge.source_handle': 'source', 'canvas.edge.target_handle': 'param:__prompt',
      } }],
    }] })
    const persisted = await readPersistedCanvasProjectSnapshot(parent.id)
    expect(persisted.nodes).toHaveLength(2)
    expect(persisted.nodes.find(node => node.type === 'stringSourceNode')?.position).toEqual({ x: 420, y: 280 })
    expect(persisted.edges).toMatchObject([{ source: refs[0].id.split(':')[1], target: refs[1].id.split(':')[1] }])
  } finally { app.dispose() }
})

/*
 * 删除是 R3 破坏性操作，回执必须自带核实结果。
 *
 * 外部操作账本的 `ok` 只认 `data.verification.verified`：少了它，一次**真的删掉了**的删除
 * 会以 `ok:false` / `isError:true` 交给调用方，而客户端按常理会重试——重试一个已经完成的
 * 删除正是最不该发生的事。这条盯的就是回执本身，不是删除逻辑。
 */
it('删除画布工程的回执带着按存储读回的核实结果', async () => {
  setCanvasTestProjectState({ currentProjectId: null, currentProject: null, projects: [], isHydrated: true })
  const app = createApplicationHarness()
  try {
    const created = await app.requireResult('create_canvas_project', { name: '待删工程' })
    const projectId = String(created.projectId)
    // 破坏性操作不自动取基线：先读原目标，拿它的 revision 当基线，与外部客户端同一口径。
    const baseline = await app.read({ kind: 'canvas.project', id: projectId })
    const deleted = await app.requireResult('delete_canvas_project', { projectId },
      baseline.revisions as Record<string, number>)
    expect(deleted).toMatchObject({ projectId, status: 'deleted' })
    expect(deleted.verification).toMatchObject({
      verified: true,
      target: { kind: 'canvas.project', id: projectId },
    })
    expect(await readPersistedCanvasProjectSnapshot(projectId).catch(() => null)).toBeNull()
  } finally {
    useProjectStore.setState({ currentProjectId: null })
  }
})
