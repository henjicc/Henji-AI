import { setCanvasTestProjectState } from '@/tests/canvasProjectFixture';
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

/** 画布是通用文档（3.4）：create_document 返回的文档引用 id 就是画布 ID。 */
const documentId = (result: Record<string, unknown>): string => (result.resultRef as ApplicationRef).id
afterAll(() => uninstallHarnessNativeStorage())

it('公共实体调用在 A 页面创建、修改并保存 B，打开 B 复用状态和撤销历史', async () => {
  setCanvasTestProjectState({ currentProjectId: null, currentProject: null })
  const app = createApplicationHarness()
  try {
    const a = await app.requireResult('create_document', { kind: 'canvas', name: '正在编辑 A' })
    await app.requireResult('open_document', { documentId: documentId(a) })
    const visible = useCanvasStore.getState()
    const b = await app.requireResult('create_document', { kind: 'canvas', name: '后台 B' })
    const parent = { kind: 'canvas.document', id: documentId(b) }
    const result = await app.requireResult('change_application_entities', { summary: '在后台工程创建文本', changes: [{
      kind: 'create_items', parent, entityType: 'canvas.node', items: [{ properties: { 'canvas.node.node_type': 'textAnnotationNode' } }],
    }] })
    const target = (result.resultRefs as ApplicationRef[])[0]
    const changed = await app.change(target, { 'canvas.node.text_content': '后台修改的正文' })
    expect(changed.ok, JSON.stringify(changed)).toBe(true)
    expect(useProjectStore.getState().currentProjectId).toBe(documentId(a))
    expect(useCanvasStore.getState()).toBe(visible)
    expect((await readPersistedCanvasProjectSnapshot(parent.id)).nodes[0].data.content).toBe('后台修改的正文')
    await app.requireResult('open_document', { documentId: parent.id })
    expect(useCanvasStore.getState().nodes[0].data.content).toBe('后台修改的正文')
    expect(useCanvasStore.getState().undo()).toBe(true)
    expect(useCanvasStore.getState().nodes[0].data.content).not.toBe('后台修改的正文')
  } finally { app.dispose() }
})

it('公共撤销属性修改与批量新建节点，画布恢复且撤销报告成功', async () => {
  setCanvasTestProjectState({ currentProjectId: null, currentProject: null })
  const app = createApplicationHarness()
  try {
    const project = await app.requireResult('create_document', { kind: 'canvas', name: '公共撤销' })
    const parent = { kind: 'canvas.document', id: documentId(project) }
    const create = (count: number) => app.requireResult('change_application_entities', { summary: '新建文本', changes: [{
      kind: 'create_items', parent, entityType: 'canvas.node',
      items: Array.from({ length: count }, () => ({ properties: { 'canvas.node.node_type': 'textAnnotationNode' } })),
    }] })
    const [target] = (await create(1)).resultRefs as ApplicationRef[]
    await app.requireResult('undo_application_changes', { undoRef: (await create(2)).undoRef })
    expect((await readPersistedCanvasProjectSnapshot(parent.id)).nodes).toHaveLength(1)
    const changed = await app.change(target, { 'canvas.node.text_content': '要撤销的正文' })
    if (!changed.ok) throw new Error(JSON.stringify(changed.error))
    await app.requireResult('undo_application_changes', { undoRef: changed.data.undoRef })
    expect((await readPersistedCanvasProjectSnapshot(parent.id)).nodes[0].data.content).not.toBe('要撤销的正文')
  } finally { app.dispose() }
})

it('公共入口连续创建节点和连线，位置与持久化结果一致，旧版本写入被拒绝', async () => {
  const app = createApplicationHarness()
  try {
    useCanvasStore.getState().setCanvasData([], [], { past: [], future: [] })
    setCanvasTestProjectState({ currentProjectId: null, currentProject: null })
    const project = await app.requireResult('create_document', { kind: 'canvas', name: '公共画布创建' })
    const parent = { kind: 'canvas.document', id: documentId(project) }
    await app.requireResult('open_document', { documentId: parent.id })
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

it('新建节点时一并写入标题、正文、位置与节点数据；节点数据逐项可读可写，类型不符的项被拒绝并说明这类节点有哪些', async () => {
  const app = createApplicationHarness()
  try {
    const project = await app.requireResult('create_document', { kind: 'canvas', name: '新建带属性' })
    const parent = { kind: 'canvas.document', id: documentId(project) }
    const created = await app.requireResult('change_application_entities', { summary: '一次建好三个节点', changes: [{
      kind: 'create_items', parent, entityType: 'canvas.node', items: [
        { properties: { node_type: 'textAnnotationNode', display_name: '甲', text_content: '甲的正文', position: { x: 40, y: 80 } } },
        { properties: { node_type: 'stringSourceNode', display_name: '提示词', value: '一只猫' } },
        { properties: { node_type: 'textProcessingNode', system_prompt: '把输入改写成英文', prompt: '改写' } },
      ],
    }] })
    const [text, source, processing] = created.resultRefs as ApplicationRef[]
    const persisted = await readPersistedCanvasProjectSnapshot(parent.id)
    const node = (ref: ApplicationRef) => persisted.nodes.find(item => item.id === ref.id.split(':')[1])!
    expect(node(text)).toMatchObject({ position: { x: 40, y: 80 }, data: { displayName: '甲', content: '甲的正文' } })
    expect(node(source).data).toMatchObject({ displayName: '提示词', value: '一只猫' })
    expect(node(processing).data).toMatchObject({ systemPrompt: '把输入改写成英文', prompt: '改写' })
    // 一次新建是一步撤销
    expect(typeof created.undoRef).toBe('string')

    // 建好之后逐项改、读回
    const changed = await app.change(source, { value: '两只猫' })
    expect(changed.ok, JSON.stringify(changed)).toBe(true)
    expect((await app.read(source, ['value'])).properties).toMatchObject({ 'canvas.node.value': '两只猫' })
    expect((await app.read(text, ['value'])).properties).toMatchObject({ 'canvas.node.value': null })

    // 这类节点没有的项：describe 带 refs 时已说明，写入被拒绝并列出这类节点的数据项
    const availability = await app.requireResult('describe_application_entities', { entityType: 'canvas.node', propertyIds: ['system_prompt'], refs: [text, processing] })
    const writable = (ref: ApplicationRef) => (availability.propertyAvailability as Array<{ ref: ApplicationRef; properties: Array<{ writable: boolean }> }>).find(item => item.ref.id === ref.id)!.properties[0].writable
    expect([writable(text), writable(processing)]).toEqual([false, true])
    const rejected = await app.change(text, { system_prompt: '不该写上' })
    expect(rejected.ok).toBe(false)
    expect(JSON.stringify(rejected)).toMatch(/textAnnotationNode 节点没有这一项.*text_content/)
    // 新建时带了不认识的属性：整次拒绝，不留半成品
    const before = (await readPersistedCanvasProjectSnapshot(parent.id)).nodes.length
    const unknown = await app.call('change_application_entities', { summary: '带错属性', changes: [{
      kind: 'create_items', parent, entityType: 'canvas.node', items: [{ properties: { node_type: 'floatSourceNode', display_name: '数值', value: '不是数字' } }],
    }] })
    expect(unknown.ok).toBe(false)
    expect(JSON.stringify(unknown)).not.toContain('不支持节点类型')
    expect((await readPersistedCanvasProjectSnapshot(parent.id)).nodes).toHaveLength(before)
    // 生成配置与单独的提示词不能在同一次修改里并存
    const image = ((await app.requireResult('change_application_entities', { summary: '建图片节点', changes: [{ kind: 'create_items', parent, entityType: 'canvas.node', items: [{ properties: { node_type: 'imageNode' } }] }] })).resultRefs as ApplicationRef[])[0]
    const config = (await app.read(image, ['generation_config'])).properties as Record<string, { modelId: string; params: Record<string, unknown> }>
    const both = await app.change(image, { generation_config: { ...config['canvas.node.generation_config'], prompt: '甲' }, prompt: '乙' })
    expect(both.ok).toBe(false)
    expect(JSON.stringify(both)).toContain('不要再单独写')
    const alone = await app.change(image, { prompt: '只改提示词' })
    expect(alone.ok, JSON.stringify(alone)).toBe(true)
    expect((await app.read(image, ['generation_config'])).properties).toMatchObject({ 'canvas.node.generation_config': { prompt: '只改提示词' } })
  } finally { app.dispose() }
})
