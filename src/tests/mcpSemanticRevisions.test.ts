// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApplicationCallerGrant } from '@/core/application-control/callerContext'
import { createApplicationCapabilitySession, listApplicationCapabilities } from '@/features/application-control/applicationCapabilityService'
import { replaceGenerationTaskStatusSnapshots, type GenerationTaskStatusSnapshot } from '@/features/generation/application/generationTaskStatusRegistry'
import { registerVisibleGenerationTaskHandler } from '@/workspaces/GenerationWorkspace/application/visibleGenerationTaskCommand'
import { upsertProjectRecord } from '@/commands/projectState'
import { readPersistedCanvasProjectSnapshot } from '@/features/canvas/application/canvasQueryService'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from './harnessNativeStorage'
import { registry } from '@/core/ModelRegistry'
import { databaseService } from '@/services/database/DatabaseService'
import { MCP_CAPABILITY_IDS, MCP_READ_PERMISSIONS, MCP_WRITE_PERMISSIONS } from '@/core/application-control/localHostContracts'
import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore } from '@/stores/projectStore'
import { loadRealModelsIntoRegistry } from './loadRealModels'
import { CANVAS_NODE_TYPES } from '@/features/canvas/domain/canvasNodes'
import { addCanvasNode } from '@/features/canvas/application/canvasApplicationService'

const task: GenerationTaskStatusSnapshot = { taskId: 'mcp-revision-task', status: 'generating', progress: 10,
  modelId: 'fixture', mediaType: 'image', resultAvailable: false, errorCode: null, errorMessage: null }
const cancel = vi.fn(async () => ({ taskId: task.taskId, status: 'cancelled' }))
let dispose: () => void
beforeEach(() => {
  installHarnessNativeStorage()
  replaceGenerationTaskStatusSnapshots([task])
  dispose = registerVisibleGenerationTaskHandler({ create: async () => null, get: () => task,
    getResult: () => ({ taskId: task.taskId, mediaType: 'image', url: 'C:/fixture/result.png', prompt: '长提示词不应成为超长文件名。'.repeat(80) }), list: () => [task], cancel })
})
afterEach(() => { dispose(); replaceGenerationTaskStatusSnapshots([]); uninstallHarnessNativeStorage(); vi.restoreAllMocks(); vi.clearAllMocks() })
const request = () => ({ requestId: crypto.randomUUID(), signal: new AbortController().signal })
function client() {
  return createApplicationCapabilitySession(createApplicationCallerGrant({ callerId: 'mcp-revisions',
    capabilityIds: listApplicationCapabilities().map((entry) => entry.id), allowWrites: true, allowDestructive: true,
    permissions: ['application:read', 'generation:read', 'generation:cancel', 'canvas:read', 'canvas:write'] }))
}
async function baseline(session: ReturnType<typeof client>) {
  const result = await session.execute({ id: 'read_application_entity', version: 1,
    input: { ref: { kind: 'generation.task', id: task.taskId }, propertyIds: [] } }, request())
  expect(result.ok, JSON.stringify(result)).toBe(true)
  if (!result.ok) throw new Error('读取失败')
  return result.data.revisions
}
const invocation = (expectedRevisions: unknown) => ({ id: 'cancel_generation_task', version: 1,
  expectedRevisions, input: { taskId: task.taskId, reason: '验收取消' } })

it('MCP 实际授权可发现、创建和配置图片节点，并从原工程存储回读', async () => {
  await loadRealModelsIntoRegistry()
  const projectId = 'mcp-image-capability'
  const source = { id: 'source-image', type: CANVAS_NODE_TYPES.upload, position: { x: 80, y: 120 },
    data: { imageUrl: 'managed-source.png', aspectRatio: '1:1' } }
  const previousCanvas = useCanvasStore.getState()
  const previousProject = useProjectStore.getState()
  try {
    const project = { id: projectId, name: '图片工具验收', createdAt: 1, updatedAt: 1, nodeCount: 1,
      coverPath: null, nodes: [source], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, history: { past: [], future: [] } }
    useCanvasStore.getState().setCanvasData([source], [], project.history)
    useProjectStore.setState({ currentProjectId: projectId, currentProject: project, projects: [project], isHydrated: true })
    const session = createApplicationCapabilitySession(createApplicationCallerGrant({ callerId: 'mcp-image-tools',
      capabilityIds: [...MCP_CAPABILITY_IDS], allowWrites: true, allowDestructive: false,
      permissions: [...MCP_READ_PERMISSIONS, ...MCP_WRITE_PERMISSIONS] }))
    expect(session.list().map((definition) => definition.id)).toContain('apply_canvas_image_capability')
    const result = await session.execute({ id: 'apply_canvas_image_capability', version: 1,
      input: { projectId, sourceNodeId: source.id, capabilityId: 'image.background-removal' } }, request())
    expect(result.ok, JSON.stringify(result)).toBe(true)
    if (!result.ok) throw new Error('图片能力创建失败')
    const persisted = await readPersistedCanvasProjectSnapshot(projectId)
    expect(persisted.nodes).toHaveLength(2)
    expect(persisted.edges).toEqual([expect.objectContaining({ source: source.id, target: result.data.nodeId })])
    expect(persisted.nodes.find((node) => node.id === result.data.nodeId)?.position.x).toBeGreaterThan(source.position.x)
    const read = await session.execute({ id: 'read_application_entity', version: 1,
      input: { ref: { kind: 'canvas.node', id: `${projectId}:${result.data.nodeId}` },
        propertyIds: ['canvas.node.generation_schema'] } }, request())
    expect(read.ok, JSON.stringify(read)).toBe(true)
    if (!read.ok) throw new Error('节点读取失败')
    const properties = read.data.properties as Record<string, unknown>
    expect(properties['canvas.node.generation_schema']).toMatchObject({ modelLocked: true,
      model: { meta: { id: 'fal-pixelcut-background-removal' } } })
    const ref = { kind: 'canvas.node', id: `${projectId}:${result.data.nodeId}` }
    const described = await session.execute({ id: 'describe_application_entities', version: 1,
      input: { entityTypes: ['canvas.node'], refs: [ref] } }, request())
    expect(described.ok, JSON.stringify(described)).toBe(true)
    if (!described.ok) throw new Error('节点属性发现失败')
    expect(described.data.propertyAvailability).toEqual([expect.objectContaining({ ref,
      properties: expect.arrayContaining([expect.objectContaining({ propertyId: 'canvas.node.generation_config', writable: true })]),
    })])
    const changeConfig = (value: unknown, target = ref) => session.execute({ id: 'change_application_entities', version: 2,
      input: { summary: '配置画布图片节点', changes: [{ kind: 'set_properties', entityType: 'canvas.node',
        target, properties: { 'canvas.node.generation_config': value } }] } }, request())
    const config = { prompt: '保留人物轮廓', modelId: 'fal-pixelcut-background-removal', params: {} }
    const configured = await changeConfig(config)
    expect(configured.ok, JSON.stringify(configured)).toBe(true)
    const configuredSnapshot = await readPersistedCanvasProjectSnapshot(projectId)
    expect(configuredSnapshot.nodes.find((node) => node.id === result.data.nodeId)?.data)
      .toMatchObject({ prompt: '保留人物轮廓', modelId: 'fal-pixelcut-background-removal', params: {} })
    expect(configuredSnapshot.edges).toEqual(persisted.edges)
    for (const invalid of [{ modelId: 'fal-image-apps-v2-outpaint' }, { params: { nonexistent: 1 } }, { generationUi: {} }]) {
      const refused = await changeConfig({ ...config, ...invalid })
      expect(refused.ok, JSON.stringify(refused)).toBe(false)
      const after = await readPersistedCanvasProjectSnapshot(projectId)
      expect(after.nodes).toEqual(configuredSnapshot.nodes)
      expect(after.edges).toEqual(configuredSnapshot.edges)
    }
    const afterRead = await session.execute({ id: 'read_application_entity', version: 1,
      input: { ref, propertyIds: ['canvas.node.generation_config'] } }, request())
    expect(afterRead).toMatchObject({ ok: true, data: { properties: {
      'canvas.node.generation_config': { prompt: '保留人物轮廓', modelId: 'fal-pixelcut-background-removal', params: {} },
    } } })
    for (const modelId of ['config-model-one', 'config-model-two']) {
      registry.register({ meta: { id: modelId, canonicalModelId: 'nano-banana', provider: 'fixture', type: 'image',
        name: { zh: modelId, en: modelId } }, params: [{ id: modelId, type: 'dropdown', valueType: 'string',
        order: 1, name: { zh: '质量', en: 'Quality' }, default: 'standard',
        options: [{ value: 'standard', label: '标准' }, { value: 'high', label: '高' }] }],
      endpoints: '/fixture', pricing: { currency: '$', fixed: 0.03 }, request: { builder: (params) => params } })
    }
    const normalNode = await addCanvasNode({ projectId, nodeType: CANVAS_NODE_TYPES.imageEdit,
      placement: { mode: 'viewport_center' }, data: { modelId: 'config-model-one', params: { 'config-model-one': 'standard' } } })
    const normalRef = { kind: 'canvas.node', id: `${projectId}:${normalNode.nodeId}` }
    const switchedConfig = { prompt: '普通节点', modelId: 'config-model-two', params: { 'config-model-two': 'high' } }
    const switched = await changeConfig(switchedConfig, normalRef)
    expect(switched.ok, JSON.stringify(switched)).toBe(true)
    expect((await readPersistedCanvasProjectSnapshot(projectId)).nodes.find((node) => node.id === normalNode.nodeId)?.data)
      .toMatchObject(switchedConfig)
    const invalidOption = await changeConfig({ ...switchedConfig, params: { 'config-model-two': 'invalid' } }, normalRef)
    expect(invalidOption.ok, JSON.stringify(invalidOption)).toBe(false)
    expect((await readPersistedCanvasProjectSnapshot(projectId)).nodes.find((node) => node.id === normalNode.nodeId)?.data)
      .toMatchObject(switchedConfig)
  } finally {
    useCanvasStore.setState(previousCanvas, true)
    useProjectStore.setState(previousProject, true)
  }
})

it('外部语义操作使用正式实体读取的版本，不与助手界面计数比较', async () => {
  const session = client()
  const result = await session.execute(invocation(await baseline(session)), request())
  expect(result.ok, JSON.stringify(result)).toBe(true)
  expect(cancel).toHaveBeenCalledTimes(1)
  expect(cancel).toHaveBeenCalledWith(task.taskId, '验收取消')
})

it('不可撤销的任务取消仍需核对原任务，不能省略基线', async () => {
  const result = await client().execute(invocation(undefined), request())
  expect(result.ok).toBe(false)
  expect(cancel).not.toHaveBeenCalled()
})

it('无需读取模型基线即可通过正式注册表、参数准备与领域提交创建任务', async () => {
  registry.register({ meta: { id: 'mcp-submit-fixture', canonicalModelId: 'nano-banana', provider: 'fixture', type: 'image', name: { zh: '提交验收', en: 'Submit fixture' } },
    params: [], endpoints: '/fixture', inputLimits: { images: { max: 1 }, videos: { max: 0 }, audios: { max: 0 } },
    pricing: { currency: '$', fixed: 0.03 }, request: { builder: (params) => params } })
  const create = vi.fn(async () => 'submitted-fixture')
  dispose()
  dispose = registerVisibleGenerationTaskHandler({ create, get: () => null, getResult: () => null, list: () => [], cancel })
  vi.spyOn(databaseService, 'getHistoryById').mockResolvedValue(null)
  const session = createApplicationCapabilitySession(createApplicationCallerGrant({ callerId: 'submit', allowWrites: true, allowDestructive: false,
    capabilityIds: listApplicationCapabilities().map((entry) => entry.id), permissions: ['application:read', 'models:read', 'generation:read', 'generation:create'] }))
  const result = await session.execute({ id: 'create_visible_generation_task', version: 1,
    input: { modelId: 'mcp-submit-fixture', prompt: '生成快递员', mediaType: 'image', params: {} } }, request())
  expect(result.ok, JSON.stringify(result)).toBe(true)
  expect(create).toHaveBeenCalledTimes(1)
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ model: 'mcp-submit-fixture', input: '生成快递员', type: 'image' }))
  if (result.ok) expect(result.data).toMatchObject({ taskId: 'submitted-fixture', status: 'submitted' })
})

it('任务状态变更使旧基线失效，明确标为未执行；重新读取后可取消', async () => {
  const session = client()
  const old = await baseline(session)
  replaceGenerationTaskStatusSnapshots([{ ...task, progress: 60 }])
  const refused = await session.execute(invocation(old), request())
  expect(refused).toMatchObject({ ok: false, error: { code: 'CONFLICT',
    message: expect.stringContaining('重新读取'), details: { execution: { notExecuted: true } } } })
  expect(cancel).not.toHaveBeenCalled()
  const accepted = await session.execute(invocation(await baseline(session)), request())
  expect(accepted.ok, JSON.stringify(accepted)).toBe(true)
  expect(cancel).toHaveBeenCalledTimes(1)
})

it('生成结果与后台画布各用原读取版本，创建节点后从正式存储回读', async () => {
  const session = client()
  const projectId = 'mcp-result-background'
  await upsertProjectRecord({ id: projectId, name: '结果验收', createdAt: 12345, updatedAt: 12345,
    nodeCount: 0, nodesJson: '[]', edgesJson: '[]', viewportJson: '{"x":0,"y":0,"zoom":1}',
    historyJson: '{"past":[],"future":[],"imagePool":[]}' })
  replaceGenerationTaskStatusSnapshots([{ ...task, status: 'success', progress: 100, resultAvailable: true }])
  const resultRef = { kind: 'generation.result', id: task.taskId }
  const expectedRevisions: Record<string, number> = {}
  for (const ref of [{ kind: 'canvas.project', id: projectId }, resultRef]) {
    const read = await session.execute({ id: 'read_application_entity', version: 1, input: { ref, propertyIds: [] } }, request())
    expect(read.ok, JSON.stringify(read)).toBe(true)
    if (read.ok) Object.assign(expectedRevisions, read.data.revisions)
  }
  const result = await session.execute({ id: 'add_generation_result_to_canvas', version: 1, expectedRevisions,
    input: { projectId, resultRef, placement: { mode: 'absolute', x: 0, y: 0 } } }, request())
  expect(result.ok, JSON.stringify(result)).toBe(true)
  const { nodes } = await readPersistedCanvasProjectSnapshot(projectId)
  expect(nodes).toHaveLength(1)
  expect(nodes[0].data.imageUrl).toBe('C:/fixture/result.png')
  expect(String(nodes[0].data.sourceFileName).length).toBeLessThanOrEqual(120)
  if (result.ok) expect(result.data).toMatchObject({ nodeRef: { kind: 'canvas.node', id: `${projectId}:${nodes[0].id}` },
    verification: { verified: true } })
})
