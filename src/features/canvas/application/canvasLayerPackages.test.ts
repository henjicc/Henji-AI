// @vitest-environment jsdom
import { canvasTestRegistry, readCanvasTestProject, seedCanvasTestProject } from '@/tests/canvasProjectFixture'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CanvasNode } from '../domain/canvasNodes'
import { canvasDocumentCommands } from './canvasDocumentEnvironment'
import { canvasLayerDocumentIds, rewriteCanvasLayerReferences } from './canvasLayerPackages'
import { findCanvasProjectInstance, getCanvasProjectInstance, leaveCanvasProject } from './canvasProjectInstances'

/*
 * 画布节点的内嵌图片文档（3.4）：打开时按包准备（副本画布改指向分出的新文档，撤销记录一并改），
 * 写回与换位置前写出包并把位置记进画布内容。主进程那一半见 canvas-layer-packages.test.ts。
 */

function layerNode(id: string, documentId: string, revision = 3): CanvasNode {
  return {
    id, type: 'uploadNode', position: { x: 0, y: 0 },
    data: {
      imageUrl: `/${id}.png`,
      imageEditSession: { kind: 'image-edit-v3', sourceUrl: `/${id}.png`, documentRef: `image-edit-v3:${documentId}`, revision, previewRef: null },
    },
  } as unknown as CanvasNode
}

function plainNode(id: string): CanvasNode {
  return { id, type: 'uploadNode', position: { x: 0, y: 0 }, data: { imageUrl: `/${id}.png` } } as unknown as CanvasNode
}

function documentRefOf(node: CanvasNode | undefined): string | undefined {
  return (node?.data.imageEditSession as { documentRef?: string } | undefined)?.documentRef
}

afterEach(() => { vi.restoreAllMocks() })

describe('内嵌图片文档引用', () => {
  it('只收集有效的 V3 引用并去重；按旧 ID → 新 ID 改指向，没有变化时返回原数组', () => {
    const broken = { ...plainNode('broken'), data: { imageUrl: '/b.png', imageEditSession: { kind: 'image-edit-v3', documentRef: '坏的' } } } as unknown as CanvasNode
    const nodes = [layerNode('a', 'layer-a'), layerNode('b', 'layer-a'), layerNode('c', 'layer-c'), plainNode('d'), broken]
    expect(canvasLayerDocumentIds(nodes)).toEqual(['layer-a', 'layer-c'])
    expect(rewriteCanvasLayerReferences(nodes, { other: 'x' })).toBe(nodes)
    const rewritten = rewriteCanvasLayerReferences(nodes, { 'layer-a': 'layer-a2' })
    expect(rewritten.map(documentRefOf)).toEqual(['image-edit-v3:layer-a2', 'image-edit-v3:layer-a2', 'image-edit-v3:layer-c', undefined, '坏的'])
    expect((rewritten[0].data.imageEditSession as { revision: number }).revision).toBe(3)
  })
})

describe('画布实例与内嵌图片文档的包', () => {
  it('打开：把节点引用与包位置交给主进程准备；副本画布分出新文档时节点改指向并保存，撤销记录同样改', async () => {
    seedCanvasTestProject({ id: 'copy', name: '副本', nodes: [layerNode('a', 'layer-a'), plainNode('b')], edges: [] })
    const { commands } = canvasTestRegistry()
    const stored = commands.stored('copy')!
    stored.content = { ...(stored.content as object), layerPackages: { 'layer-a': 'D:/作品/.henji/canvas-layers/layer-a.henjilayer' } }
    await commands.writeSessionState({ docId: 'copy', key: 'canvas.history', value: {
      revision: stored.meta.revision, history: { past: [{ nodes: [layerNode('a', 'layer-a')], edges: [] }], future: [] },
    } })
    const prepare = vi.spyOn(canvasDocumentCommands(), 'prepareLayers').mockResolvedValue({ rewrites: { 'layer-a': 'layer-a-fork' }, missing: [] })

    const instance = await getCanvasProjectInstance('copy')
    expect(prepare).toHaveBeenCalledWith(expect.objectContaining({
      canvasId: 'copy', layers: [{ documentId: 'layer-a', packagePath: 'D:/作品/.henji/canvas-layers/layer-a.henjilayer' }],
    }))
    const state = instance.store.getState()
    expect(documentRefOf(state.nodes[0])).toBe('image-edit-v3:layer-a-fork')
    expect(state.history.past.flatMap((snapshot) => snapshot.nodes.map(documentRefOf))).toEqual(['image-edit-v3:layer-a-fork'])
    await vi.waitFor(() => expect(documentRefOf(readCanvasTestProject('copy')?.nodes[0])).toBe('image-edit-v3:layer-a-fork'))
  })

  it('没有内嵌文档的画布打开时不找主进程；准备失败时照原引用打开', async () => {
    seedCanvasTestProject({ id: 'plain', name: '普通', nodes: [plainNode('a')], edges: [] })
    seedCanvasTestProject({ id: 'failing', name: '失败', nodes: [layerNode('a', 'layer-a')], edges: [] })
    const prepare = vi.spyOn(canvasDocumentCommands(), 'prepareLayers').mockRejectedValue(new Error('包坏了'))
    await getCanvasProjectInstance('plain')
    expect(prepare).not.toHaveBeenCalled()
    const failing = await getCanvasProjectInstance('failing')
    expect(documentRefOf(failing.store.getState().nodes[0])).toBe('image-edit-v3:layer-a')
  })

  it('写回（离开时关闭）：写出包并把位置记进画布内容；位置没变时不再多写一次文档', async () => {
    seedCanvasTestProject({ id: 'canvas', name: '画布', nodes: [layerNode('a', 'layer-a'), plainNode('b')], edges: [] })
    const target = 'D:/作品/.henji/canvas-layers/layer-a.henjilayer'
    const commit = vi.spyOn(canvasDocumentCommands(), 'commitLayers').mockResolvedValue({ packages: { 'layer-a': target }, written: 1, released: 0 })
    await getCanvasProjectInstance('canvas')
    expect(await leaveCanvasProject('canvas')).toBe('closed')
    expect(commit).toHaveBeenCalledWith(expect.objectContaining({ canvasId: 'canvas', container: { kind: 'user' }, documentIds: ['layer-a'] }))
    const { commands } = canvasTestRegistry()
    expect((commands.stored('canvas')!.content as { layerPackages?: unknown }).layerPackages).toEqual({ 'layer-a': target })

    const instance = await getCanvasProjectInstance('canvas')
    const writes = commands.writes
    await instance.session.commit('save')
    expect(commit).toHaveBeenCalledTimes(2)
    expect(commands.writes).toBe(writes)
  })

  it('删掉多图层节点后写回：只写出当前节点的包，撤销记录里的文档仍算在用，交主进程据此清理', async () => {
    seedCanvasTestProject({ id: 'trimmed', name: '删节点', nodes: [layerNode('a', 'layer-a'), layerNode('b', 'layer-b')], edges: [] })
    const commit = vi.spyOn(canvasDocumentCommands(), 'commitLayers').mockResolvedValue({ packages: {}, written: 0, released: 0 })
    const instance = await getCanvasProjectInstance('trimmed')
    const state = instance.store.getState()
    instance.store.setState({ nodes: [state.nodes[0]], history: { past: [{ nodes: state.nodes, edges: [] }], future: [] } })
    await instance.session.commit('save')
    expect(commit).toHaveBeenLastCalledWith(expect.objectContaining({ documentIds: ['layer-a'], retainedDocumentIds: ['layer-a', 'layer-b'] }))

    // 撤销记录也不再提到时，在用的只剩当前节点；一个都不剩也照样交给主进程（清理最后一个）
    instance.store.setState({ nodes: [], history: { past: [], future: [] } })
    await instance.session.commit('save')
    expect(commit).toHaveBeenLastCalledWith(expect.objectContaining({ documentIds: [], retainedDocumentIds: [] }))
  })

  it('换位置前（移动、转正、创建副本共用的屏障）先写出包，内容立即带上包位置', async () => {
    seedCanvasTestProject({ id: 'moving', name: '要移动', nodes: [layerNode('a', 'layer-a')], edges: [] })
    const target = 'D:/作品/.henji/canvas-layers/layer-a.henjilayer'
    vi.spyOn(canvasDocumentCommands(), 'commitLayers').mockResolvedValue({ packages: { 'layer-a': target }, written: 1, released: 0 })
    await getCanvasProjectInstance('moving')
    await findCanvasProjectInstance('moving')!.session.prepareTransfer()
    const { commands } = canvasTestRegistry()
    expect((commands.stored('moving')!.content as { layerPackages?: unknown }).layerPackages).toEqual({ 'layer-a': target })
  })

  it('写出包失败：关闭失败，会话与修改保留', async () => {
    seedCanvasTestProject({ id: 'broken', name: '写不出', nodes: [layerNode('a', 'layer-a')], edges: [] })
    vi.spyOn(canvasDocumentCommands(), 'commitLayers').mockRejectedValue(new Error('磁盘满了'))
    await getCanvasProjectInstance('broken')
    await expect(leaveCanvasProject('broken')).rejects.toThrow('磁盘满了')
    expect(findCanvasProjectInstance('broken')).toBeDefined()
  })
})
