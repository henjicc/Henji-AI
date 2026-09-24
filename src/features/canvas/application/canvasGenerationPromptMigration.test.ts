import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPlainTextPromptDocument } from '@/core/inputs/promptDocument'
import { createCanvasStore, canvasStoreAttachment } from '@/stores/canvasStore'
import { fromProjectRecord, toProjectRecord } from '@/stores/projectStoreSerialization'
import { CANVAS_NODE_TYPES, type CanvasNode, type ImageEditNodeData } from '../domain/canvasNodes'
import { migrateCanvasGenerationPrompts } from './canvasGenerationPromptMigration'
import { attachCanvasProject, configureCanvasInstancePersistence, registerCanvasProjectInstance,
  resetCanvasProjectInstancesForTests } from './canvasProjectInstances'

function generator(id: string, data: Partial<ImageEditNodeData> = {}): CanvasNode {
  return { id, type: CANVAS_NODE_TYPES.imageEdit, position: { x: 0, y: 0 },
    data: { prompt: '参考图片1修改', modelId: '', ...data } as ImageEditNodeData }
}

afterEach(() => {
  configureCanvasInstancePersistence(() => undefined)
  resetCanvasProjectInstancesForTests()
})

describe('画布附着前提示词迁移', () => {
  it('千节点只提交一次，保留历史、工程归属和保存通知，重复附着不重复写入', () => {
    const project = registerCanvasProjectInstance({ id: 'bulk', name: 'bulk', createdAt: 1, updatedAt: 1,
      coverPath: null, nodeCount: 1000, viewport: { x: 2, y: 3, zoom: 0.5 },
      nodes: Array.from({ length: 1000 }, (_, i) => generator(String(i))), edges: [],
      history: { past: [], future: [] } })
    const previousStore = canvasStoreAttachment.getStore()
    const previous = previousStore.getState()
    const initial = project.store.getState()
    const subscriber = vi.fn()
    const save = vi.fn()
    project.store.subscribe(subscriber)
    configureCanvasInstancePersistence(save)

    attachCanvasProject(project)
    expect(subscriber).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledTimes(1)
    expect(project.dirty).toBe(true)
    expect(save.mock.calls[0][0]).toMatchObject({ id: 'bulk', nodeCount: 1000 })
    expect(project.store.getState().history).toBe(initial.history)
    expect(project.store.getState().edges).toBe(initial.edges)
    expect(previousStore.getState()).toBe(previous)
    expect(project.store.getState().nodes.every(node => Boolean(node.data.promptDocument))).toBe(true)
    attachCanvasProject(project)
    expect(subscriber).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledTimes(1)

    const restored = registerCanvasProjectInstance({
      ...fromProjectRecord(toProjectRecord(project.snapshot())), id: 'restored',
    })
    attachCanvasProject(restored)
    expect(restored.dirty).toBe(false)
    expect(save).toHaveBeenCalledTimes(1)
    expect(restored.store.getState().nodes.map(node => node.data)).toEqual(project.store.getState().nodes.map(node => node.data))

    const migratedData = project.store.getState().nodes[0].data
    project.store.getState().updateNodeData('0', { prompt: '修改', promptDocument: createPlainTextPromptDocument('修改') })
    expect(project.store.getState().undo()).toBe(true)
    expect(project.store.getState().nodes[0].data).toEqual(migratedData)
  })

  it('保留本地稳定引用，按正式连线解析媒体，不改上游、节点尺寸或输入对象', () => {
    const local = generator('local', { mediaInputs: { image: ['local.png'] },
      promptMediaBindings: [{ resourceId: 'canvas-local:local:stable', mediaType: 'image', dataUrl: 'local.png' }] })
    const connected = generator('connected')
    const upload: CanvasNode = { id: 'source', type: CANVAS_NODE_TYPES.upload,
      position: { x: 20, y: 30 }, data: { imageUrl: 'upstream.png' } as CanvasNode['data'] }
    const nodes = [upload, local, connected]
    const edges = [{ id: 'edge', source: 'source', target: 'connected', sourceHandle: 'source', targetHandle: 'param:__image' }]
    const migrated = migrateCanvasGenerationPrompts(nodes, edges)
    expect(migrated[0]).toBe(upload)
    expect(local.data.promptDocument).toBeUndefined()
    expect(migrated[1].position).toBe(local.position)
    expect(migrated[1].data.promptMediaBindings).toEqual(local.data.promptMediaBindings)
    expect(JSON.stringify(migrated[1].data.promptDocument)).toContain('canvas-local:local:stable')
    expect(JSON.stringify(migrated[2].data.promptDocument)).toContain('canvas-output:source:source:0')
    expect(migrateCanvasGenerationPrompts(migrated, edges)).toBe(migrated)
  })

  it('已迁移的数据与原有逐节点写入语义一致，模板节点和失效模型保持原样', () => {
    const store = createCanvasStore()
    store.getState().setCanvasData([
      generator('image'), { ...generator('video'), type: CANVAS_NODE_TYPES.videoGen },
      { ...generator('audio'), type: CANVAS_NODE_TYPES.audioGen },
      generator('missing', { modelId: 'missing-model' }),
      generator('template', { capabilityId: 'image.upscale' }),
    ], [])
    const before = store.getState()
    const migrated = migrateCanvasGenerationPrompts(before.nodes, before.edges)
    for (const node of migrated) {
      if (node.data.promptDocument) store.getState().updateNodeData(node.id, {
        prompt: node.data.prompt, promptDocument: node.data.promptDocument,
        promptMediaBindings: node.data.promptMediaBindings,
      }, { skipHistory: true })
    }
    expect(migrated).toEqual(store.getState().nodes)
    expect(migrated.slice(0, 3).every(node => Boolean(node.data.promptDocument))).toBe(true)
    expect(migrated[3]).toBe(before.nodes[3])
    expect(migrated[4]).toBe(before.nodes[4])
  })
})
