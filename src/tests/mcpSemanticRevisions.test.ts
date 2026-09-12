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

const task: GenerationTaskStatusSnapshot = { taskId: 'mcp-revision-task', status: 'generating', progress: 10,
  modelId: 'fixture', mediaType: 'image', resultAvailable: false, errorCode: null, errorMessage: null }
const cancel = vi.fn(async () => ({ taskId: task.taskId, status: 'cancelled' }))
let dispose: () => void
beforeEach(() => {
  installHarnessNativeStorage()
  replaceGenerationTaskStatusSnapshots([task])
  dispose = registerVisibleGenerationTaskHandler({ create: async () => null, get: () => task,
    getResult: () => ({ taskId: task.taskId, mediaType: 'image', url: 'C:/fixture/result.png', prompt: '夹具' }), list: () => [task], cancel })
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
  if (result.ok) expect(result.data).toMatchObject({ nodeRef: { kind: 'canvas.node', id: `${projectId}:${nodes[0].id}` },
    verification: { verified: true } })
})
