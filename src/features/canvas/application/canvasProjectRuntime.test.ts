// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCanvasStore } from '@/stores/canvasStore'
import { decodeProjectRecord, encodeProjectAsRecord, useProjectStore, type Project } from '@/stores/projectStore'
import type { ProjectRecord } from '@/commands/projectState'
import { CANVAS_NODE_TYPES } from '../domain/canvasNodes'
import { createDefaultGenerationOutputItems } from '../domain/generationOutputs'
import { canvasNodeFactory } from './canvasServices'
import { withCanvasProjectRuntime } from './canvasProjectRuntime'
import { commitCanvasGenerationOutputs } from './generationOutputApplicationService'

const disk = vi.hoisted(() => ({ records: new Map<string, ProjectRecord>(), write: vi.fn(), read: vi.fn() }))
vi.mock('@/commands/projectState', () => ({
  getProjectRecord: (id: string) => disk.read(id),
  listProjectSummaries: async () => [],
  upsertProjectRecord: async (record: ProjectRecord) => { await disk.write(record); disk.records.set(record.id, record) },
  updateProjectViewportRecord: vi.fn(), deleteProjectRecord: vi.fn(), renameProjectRecord: vi.fn(),
}))

function project(id: string): Project {
  const node = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.cameraStage, { x: 10, y: 20 }, {})
  node.id = `${id}-source`
  return { id, name: id, createdAt: 1, updatedAt: 1, coverPath: null, nodeCount: 1,
    nodes: [node], edges: [], history: { past: [], future: [] }, viewport: { x: 0, y: 0, zoom: 1 } }
}

async function output(id: string, completionId: string) {
  return withCanvasProjectRuntime(id, (runtime) => commitCanvasGenerationOutputs({
    sourceNodeId: `${id}-source`, resultNodeType: CANVAS_NODE_TYPES.exportImage, completionId,
    contract: { version: 1, strategy: 'single', resultKind: 'image', expectedOutputCount: 1,
      outputs: createDefaultGenerationOutputItems({ sources: ['media/result.png'], mediaType: 'image', resultKind: 'image', semanticKind: 'camera-stage-render' }) },
    persistOutput: async () => ({ patch: { imageUrl: 'media/result.png' }, createdFilePaths: [] }),
  }, { projectId: id, runtime }))
}

describe('跨工程画布使用原事务与落图服务', () => {
  beforeEach(() => { disk.records.clear(); disk.write.mockReset(); disk.write.mockResolvedValue(undefined); disk.read.mockReset(); disk.read.mockImplementation(async (id: string) => disk.records.get(id)) })
  it('当前 A 时结果只写 B，保存失败保留原快照，重试同完成键不重复节点', async () => {
    const a = project('active-a')
    const b = project('background-b')
    disk.records.set(b.id, encodeProjectAsRecord(b))
    useProjectStore.setState({ isHydrated: true, projects: [a, b], currentProjectId: a.id, currentProject: a })
    useCanvasStore.getState().setCanvasData(a.nodes, a.edges, a.history)
    useCanvasStore.getState().setSelectedNode(a.nodes[0].id)
    const before = useCanvasStore.getState()
    disk.write.mockRejectedValueOnce(new Error('disk-full'))
    await expect(output(b.id, 'completion-b')).rejects.toThrow('保存未确认')
    expect(decodeProjectRecord(disk.records.get(b.id)!).nodes).toHaveLength(1)
    const recovered = await output(b.id, 'completion-b')
    expect(recovered.idempotent).toBe(true)
    expect(decodeProjectRecord(disk.records.get(b.id)!).nodes).toHaveLength(2)
    expect(useCanvasStore.getState()).toBe(before)
    expect(useProjectStore.getState().currentProjectId).toBe(a.id)
  })
  it('打开正在后台修改的工程等待同一保存边界，不读取半成品', async () => {
    const a = project('open-a')
    const b = project('open-b')
    disk.records.set(b.id, encodeProjectAsRecord(b))
    useProjectStore.setState({ isHydrated: true, projects: [a, b], currentProjectId: a.id, currentProject: a })
    useCanvasStore.getState().setCanvasData(a.nodes, a.edges, a.history)
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let entered = false
    const background = withCanvasProjectRuntime(b.id, async (runtime) => {
      entered = true
      runtime.store.getState().updateNodeData(b.nodes[0].id, { displayName: '后台完成' })
      await gate
      await runtime.persist()
    })
    await vi.waitFor(() => expect(entered).toBe(true))
    useProjectStore.getState().openProject(b.id)
    await new Promise<void>((resolve) => setTimeout(resolve, 120))
    expect(useProjectStore.getState().currentProjectId).toBe(a.id)
    release()
    await background
    await vi.waitFor(() => expect(useProjectStore.getState().currentProjectId).toBe(b.id))
    expect(useProjectStore.getState().currentProject?.nodes[0].data.displayName).toBe('后台完成')
  })
  it('打开工程先开始慢读，后台随后写入完成，旧读返回后必须重读新版本', async () => {
    const a = project('slow-a')
    const b = project('slow-b')
    const oldRecord = encodeProjectAsRecord(b)
    disk.records.set(b.id, oldRecord)
    useProjectStore.setState({ isHydrated: true, projects: [a, b], currentProjectId: a.id, currentProject: a })
    useCanvasStore.getState().setCanvasData(a.nodes, a.edges, a.history)
    let returnOld!: (record: ProjectRecord) => void
    disk.read.mockImplementationOnce(() => new Promise<ProjectRecord>((resolve) => { returnOld = resolve }))
    useProjectStore.getState().openProject(b.id)
    await vi.waitFor(() => expect(returnOld).toBeTypeOf('function'))
    await withCanvasProjectRuntime(b.id, async (runtime) => {
      runtime.store.getState().updateNodeData(b.nodes[0].id, { displayName: '新持久版本' })
      await runtime.persist()
    })
    returnOld(oldRecord)
    await vi.waitFor(() => expect(useProjectStore.getState().currentProjectId).toBe(b.id))
    expect(useProjectStore.getState().currentProject?.nodes[0].data.displayName).toBe('新持久版本')
    expect(disk.read).toHaveBeenCalledTimes(3)
  })
})
