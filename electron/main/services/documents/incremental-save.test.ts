import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDocumentKindRegistry, DOCUMENT_KINDS } from '../../../../src/core/documents/kinds'
import { canvasDocumentKind } from '../../../../src/core/documents/kinds/canvas'
import { createTestEnvironment, type TestEnvironment } from './documents.test-support'
import { planIncrementalSave } from './incremental-save'

let env: TestEnvironment

async function stored(filePath: string): Promise<{ revision: number; content: { nodes: unknown[]; edges: unknown[] } }> {
  return JSON.parse(await fsp.readFile(filePath, 'utf8')) as { revision: number; content: { nodes: unknown[]; edges: unknown[] } }
}

function graph(count: number, media: string): { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> } {
  const nodes = Array.from({ length: count }, (_, index) => ({ id: `n${index}`, type: 'uploadNode', position: { x: index, y: 0 }, data: { imageUrl: media, label: `节点 ${index}` } }))
  const edges = Array.from({ length: count - 1 }, (_, index) => ({ id: `e${index}`, source: `n${index}`, target: `n${index + 1}` }))
  return { nodes, edges }
}

describe('增量保存：只处理变了的元素', () => {
  beforeEach(() => { env = createTestEnvironment({ kinds: createDocumentKindRegistry(DOCUMENT_KINDS) }) })
  afterEach(async () => { vi.restoreAllMocks(); await env.cleanup() })

  it('改一个节点：只校验这一个，写出的文件与整份处理的结果相同', async () => {
    const { service } = env.services
    const media = path.join(env.workRoot, '上传素材', 'a.png')
    fs.writeFileSync(media, 'x')
    const created = await service.createDocument({ kind: 'canvas', container: { kind: 'user' } })
    const target = { id: created.meta.id, path: created.meta.path }
    const first = graph(6, media)
    await service.saveDocument({ target, expectedRevision: 0, content: first })

    const validate = vi.spyOn(canvasDocumentKind.contentSchema, 'safeParse')
    const second = structuredClone(first)
    second.nodes[3] = { ...second.nodes[3], data: { imageUrl: path.join(env.outside, 'b.png'), label: '改过' } }
    const saved = await service.saveDocument({ target, expectedRevision: 1, content: second })
    expect(saved).toMatchObject({ unchanged: false, meta: { revision: 2 } })
    expect(validate).toHaveBeenCalledTimes(1)
    expect(validate.mock.calls[0][0]).toMatchObject({ nodes: [{ id: 'n3' }], edges: [] })

    // 对照：同样的内容在另一份文档上整份保存
    const reference = await service.createDocument({ kind: 'canvas', container: { kind: 'user' } })
    await service.saveDocument({ target: { id: reference.meta.id }, expectedRevision: 0, content: second })
    expect((await stored(created.meta.path)).content).toEqual((await stored(reference.meta.path)).content)
    expect((await stored(created.meta.path)).content.nodes[0]).toMatchObject({ data: { imageUrl: 'henji:/上传素材/a.png' } })
    expect((await service.readDocument({ id: created.meta.id })).content).toEqual(second)
  })

  it('增删、调换顺序后其余元素照旧沿用，内容没变时不写文件', async () => {
    const { service } = env.services
    const created = await service.createDocument({ kind: 'canvas', container: { kind: 'user' } })
    const target = { id: created.meta.id }
    const first = graph(5, 'plain')
    await service.saveDocument({ target, expectedRevision: 0, content: first })

    const validate = vi.spyOn(canvasDocumentKind.contentSchema, 'safeParse')
    const reordered = { nodes: [first.nodes[4], first.nodes[0], { id: 'new', type: 'textAnnotationNode', position: { x: 9, y: 9 }, data: {} }, first.nodes[2]], edges: [first.edges[1]] }
    await service.saveDocument({ target, expectedRevision: 1, content: structuredClone(reordered) })
    expect(validate.mock.calls[0][0]).toMatchObject({ nodes: [{ id: 'new' }], edges: [] })
    expect((await stored(created.meta.path)).content).toEqual(reordered)

    const before = await fsp.stat(created.meta.path)
    const again = await service.saveDocument({ target, expectedRevision: 2, content: structuredClone(reordered) })
    expect(again).toMatchObject({ unchanged: true, meta: { revision: 2 } })
    expect((await fsp.stat(created.meta.path)).mtimeMs).toBe(before.mtimeMs)
  })

  it('变了的元素不合法时拒绝保存，文件不动；之后照常保存', async () => {
    const { service } = env.services
    const created = await service.createDocument({ kind: 'canvas', container: { kind: 'user' } })
    const target = { id: created.meta.id }
    const first = graph(3, 'plain')
    await service.saveDocument({ target, expectedRevision: 0, content: first })
    const broken = structuredClone(first)
    broken.nodes[1] = { type: 'uploadNode' }
    await expect(service.saveDocument({ target, expectedRevision: 1, content: broken })).rejects.toMatchObject({ name: 'DocumentFormatError' })
    expect((await stored(created.meta.path)).revision).toBe(1)
    const fixed = structuredClone(first)
    fixed.nodes[1] = { ...fixed.nodes[1], data: { label: '好了' } }
    await service.saveDocument({ target, expectedRevision: 1, content: fixed })
    expect((await stored(created.meta.path)).content).toEqual(fixed)
  })

  it('文件被别处改写后不沿用上次的结果：按磁盘上的版本核对并整份处理', async () => {
    const { service } = env.services
    const created = await service.createDocument({ kind: 'canvas', container: { kind: 'user' } })
    const target = { id: created.meta.id }
    const first = graph(3, 'plain')
    await service.saveDocument({ target, expectedRevision: 0, content: first })
    const disk = JSON.parse(await fsp.readFile(created.meta.path, 'utf8')) as { revision: number; content: { nodes: Array<Record<string, unknown>> } }
    disk.revision = 7
    disk.content.nodes[0] = { ...disk.content.nodes[0], data: { label: '别处改的' } }
    await fsp.writeFile(created.meta.path, JSON.stringify(disk))

    await expect(service.saveDocument({ target, expectedRevision: 1, content: first })).rejects.toMatchObject({ name: 'DocumentRevisionConflictError' })
    const validate = vi.spyOn(canvasDocumentKind.contentSchema, 'safeParse')
    await service.saveDocument({ target, expectedRevision: 7, content: first })
    expect((validate.mock.calls[0][0] as { nodes: unknown[] }).nodes).toHaveLength(3)
    expect(await stored(created.meta.path)).toMatchObject({ revision: 8, content: first })
  })
})

describe('增量保存的比对', () => {
  it('不是数组、或上次没有这个数组时不做增量', () => {
    expect(planIncrementalSave(['nodes'], { nodes: [] }, { nodes: 'x' })).toBeNull()
    expect(planIncrementalSave(['nodes'], {}, { nodes: [] })).toBeNull()
    expect(planIncrementalSave(['nodes'], { nodes: [] }, null)).toBeNull()
  })

  it('处理结果的元素个数对不上时不拼接', () => {
    const plan = planIncrementalSave(['nodes'], { nodes: [{ id: 'a' }] }, { nodes: [{ id: 'a' }, { id: 'b' }] })
    expect(plan?.probe).toEqual({ nodes: [{ id: 'b' }] })
    expect(plan?.merge({ nodes: [] }, { nodes: [{ id: 'a' }] })).toBeNull()
    expect(plan?.merge({ nodes: [{ id: 'B' }] }, { nodes: [{ id: 'A' }] })).toEqual({ nodes: [{ id: 'A' }, { id: 'B' }] })
  })
})
