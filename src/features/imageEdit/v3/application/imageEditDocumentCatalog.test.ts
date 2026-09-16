// @vitest-environment jsdom
import '@/tests/imageEditDocumentFixture'
import { beforeEach, expect, it, vi } from 'vitest'
import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import { ImageEditV3ReflectionProvider } from './imageEditV3Reflection'
import { ImageEditCommandBusV3 } from './imageEditCommandBus'
import { getOrCreateImageEditDocumentInstanceV3, listImageEditDocumentInstancesV3 } from './imageEditDocumentInstances'
import { listImageEditEntitySources } from './imageEditDocumentCatalog'

const io = vi.hoisted(() => ({ list: vi.fn(), load: vi.fn() }))
vi.mock('@/commands/imageEditorV3', () => ({ listImageEditorV3Documents: io.list, loadImageEditorV3Document: io.load,
  ImageEditorV3CommandRepository: class { save = vi.fn() },
}))

beforeEach(() => {
  io.list.mockReset().mockResolvedValue({ documentRefs: ['image-edit-v3:a', 'image-edit-v3:a0'], nextCursor: null })
  io.load.mockReset().mockImplementation(async ({ documentRef }: { documentRef: string }) => {
    const id = documentRef.slice('image-edit-v3:'.length)
    const document = createImageEditDocumentV3({ documentId: id, width: 10, height: 10 })
    document.layers = [createImageEditRasterLayerV3('layer', '未打开文档中的图层')]
    return { documentRef, document, revision: 0, previewRef: null,
      history: new ImageEditCommandBusV3(document).getPersistenceSnapshot().history, resources: [] }
  })
})

it('文档发现合并磁盘和内存记录，不依赖编辑器，也不加载完整文档', async () => {
  getOrCreateImageEditDocumentInstanceV3(createImageEditDocumentV3({ documentId: 'b', width: 10, height: 10 }))
  const provider = new ImageEditV3ReflectionProvider('image_edit.document')
  const first = await provider.listEntities({ limit: 2 })
  expect(first.refs.map((ref) => ref.id)).toEqual(['v3:a', 'v3:a0'])
  expect((await provider.listEntities({ limit: 2, cursor: first.nextCursor! })).refs.map((ref) => ref.id)).toEqual(['v3:b'])
  expect(io.load).not.toHaveBeenCalled()
  expect(listImageEditDocumentInstancesV3()).toHaveLength(1)
})

it('子实体跨文档分页不丢失前缀相似的 ID，重读保留内存新状态', async () => {
  const provider = new ImageEditV3ReflectionProvider('image_edit.layer')
  const first = await provider.listEntities({ limit: 1 })
  expect(first.refs.map((ref) => ref.id)).toEqual(['v3:a:layer'])
  const second = await provider.listEntities({ limit: 1, cursor: first.nextCursor! })
  expect(second.refs.map((ref) => ref.id)).toEqual(['v3:a0:layer'])
  expect(second.nextCursor).toBeNull()
  expect(io.load).toHaveBeenCalledTimes(2)
  expect(listImageEditDocumentInstancesV3().every((instance) => instance.views === 0)).toBe(true)
})

it('聚合来源传递当前页上限，并保留内部游标，不提前读取后续文档', async () => {
  const first = vi.fn(async () => ({ refs: [{ kind: 'image_edit.document', id: 'first' }], nextCursor: null, revisions: { image_edit: 1 } }))
  const second = vi.fn(async () => ({ refs: [{ kind: 'image_edit.document', id: 'second' }], nextCursor: null, revisions: { image_edit: 2 } }))
  const page = await listImageEditEntitySources({ limit: 1 }, [first, second])
  expect(first).toHaveBeenCalledWith({ limit: 1 })
  expect(second).not.toHaveBeenCalled()
  const next = await listImageEditEntitySources({ limit: 1, cursor: page.nextCursor! }, [first, second])
  expect(next.refs[0].id).toBe('second')
  expect(next.nextCursor).toBeNull()
  expect(second).toHaveBeenCalledWith({ limit: 1 })
})
