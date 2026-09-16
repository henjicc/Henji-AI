// @vitest-environment jsdom
import '@/tests/canvasProjectFixture'
import '@/tests/imageEditDocumentFixture'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createAttachedImageEditPersistenceFixture } from './imageEditAttachedPersistenceFixture'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from './harnessNativeStorage'
import { createApplicationHarness } from './applicationHarness'
import { requireCanvasProjectInstance } from '@/features/canvas/application/canvasProjectInstances'
import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore } from '@/stores/projectStore'
import { imageEditV3LayerRef } from '@/features/imageEdit/v3/application/imageEditDocumentRefs'
import { deleteIdleImageEditDocumentV3, requireImageEditDocumentInstanceV3 } from '@/features/imageEdit/v3/application/imageEditDocumentInstances'
import { getProjectRecord } from '@/commands/projectState'
import { CANVAS_NODE_TYPES } from '@/features/canvas/domain/canvasNodes'
import { createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import type { MultiLayerDocumentNodePort } from '@/features/canvas/application/multiLayerDocumentNodeApplicationContracts'

const pixelBoundary = vi.hoisted(() => ({ export: vi.fn(), release: vi.fn() }))
vi.mock('@/features/canvas/imageEditV3/multiLayerDocumentExportAdapter', () => ({
  // 像素与编码是受控边界；正式目标检查、应用入口、原工程事务与引用回读保持真实。
  createMultiLayerDocumentExportPort: () => ({ materializeExportTarget: pixelBoundary.export, releaseExportRaster: pixelBoundary.release }),
}))

const disposals: Array<() => void> = []
beforeEach(installHarnessNativeStorage)
afterEach(() => { disposals.splice(0).reverse().forEach((dispose) => dispose()); uninstallHarnessNativeStorage() })

async function setup() {
  const fixture = await createAttachedImageEditPersistenceFixture()
  disposals.push(fixture.dispose)
  const original = vi.mocked(fixture.materialize).getMockImplementation()!
  let finish!: () => void
  const gate = new Promise<void>((resolve) => { finish = resolve })
  let started = false
  vi.mocked(fixture.materialize).mockImplementation(async (input) => {
    started = true
    await gate
    return original(input)
  })
  const visibleProject = await useProjectStore.getState().createProject('正在编辑 A')
  const visibleStore = requireCanvasProjectInstance(visibleProject).store
  return { ...fixture, finish, started: () => started, visibleProject, visibleStore }
}

it('正式公共修改在编辑 A 时保存 B 的图片文档和节点投影，像素等待不占用 A', async () => {
  const state = await setup()
  const harness = createApplicationHarness()
  disposals.push(harness.dispose)
  const pending = harness.change(imageEditV3LayerRef(state.document.id, 'effect'), { 'image_edit.layer.opacity': 0.4 })
  await vi.waitFor(() => expect(state.started()).toBe(true))
  state.visibleStore.getState().addNode(CANVAS_NODE_TYPES.textAnnotation, { x: 10, y: 20 })
  const visibleNodes = state.visibleStore.getState().nodes
  state.finish()
  expect(await pending).toMatchObject({ ok: true })
  expect(useProjectStore.getState().currentProjectId).toBe(state.visibleProject)
  expect(useCanvasStore.getState().nodes).toBe(visibleNodes)
  const background = requireCanvasProjectInstance(state.projectId).store.getState()
  expect(background.nodes[0].data.imageEditSession).toMatchObject({ revision: 1 })
  expect(JSON.parse((await getProjectRecord(state.projectId))!.nodesJson)[0].data.imageEditSession.revision).toBe(1)
  expect(state.materialize).toHaveBeenCalledTimes(1)
  expect(state.bus.getSnapshot().history.undoCount).toBe(1)
})

it('工程删除等待图片物化和原工程投影保存，关闭页面不撤销文档修改', async () => {
  const state = await setup()
  state.bus.dispatch({ type: 'layer.update-common', commandId: 'before-delete', expectedRevision: 0,
    layerId: 'effect', patch: { opacity: 0.3 } })
  const owner = requireImageEditDocumentInstanceV3(state.document.id).persistenceOwner!
  const pending = owner.confirm(true)
  await vi.waitFor(() => expect(state.started()).toBe(true))
  let deleted = false
  const deleting = useProjectStore.getState().deleteProject(state.projectId).then(() => { deleted = true })
  await Promise.resolve()
  expect(deleted).toBe(false)
  state.finish()
  await expect(pending).resolves.toMatchObject({ documentId: state.document.id, revision: 1 })
  await deleting
  expect(await getProjectRecord(state.projectId)).toBeNull()
  expect(state.bus.getSnapshot().document.layers[0].opacity).toBe(0.3)
  expect(useProjectStore.getState().currentProjectId).toBe(state.visibleProject)
})

it('未打开编辑器时从 B 的当前文档导出，正式入口返回可回读的完整工程引用', async () => {
  const state = await setup()
  state.bus.dispatch({ type: 'layer.add', commandId: 'exportable-layer', expectedRevision: 0,
    parentId: null, index: 0, layer: createImageEditRasterLayerV3('raster', '可导出图层') })
  const remove = vi.fn(async () => true)
  pixelBoundary.export.mockImplementation(async ({ session }: Parameters<MultiLayerDocumentNodePort['materializeExportTarget']>[0]) => {
    expect(requireImageEditDocumentInstanceV3(state.document.id).leases).toBeGreaterThan(0)
    expect(await deleteIdleImageEditDocumentV3(state.document.id, session.revision, remove)).toBe(false)
    return {
    imageUrl: 'henji-media://fixture/export.png', previewImageUrl: 'henji-media://fixture/export.png',
    aspectRatio: '1:1', width: 8, height: 8, mediaType: 'image/png', hasAlpha: true, displayName: '可导出图层', ownedFilePaths: [],
    diagnostics: { documentId: state.document.id, revision: session.revision, targetKind: 'raster-layer', targetId: 'raster',
      layerPath: ['raster'], canvasScope: 'document', contentState: 'rendered' },
    }
  })
  const harness = createApplicationHarness()
  disposals.push(harness.dispose)
  const result = await harness.requireResult('export_image_edit_target_to_canvas', {
    projectRef: { kind: 'canvas.project', id: state.projectId },
    sourceNodeRef: { kind: 'canvas.node', id: `${state.projectId}:attached-node` },
    targetRef: imageEditV3LayerRef(state.document.id, 'raster'),
  })
  expect(result.nodeRef).toMatchObject({ kind: 'canvas.node', id: expect.stringMatching(`^${state.projectId}:`) })
  expect(result.edgeRef).toMatchObject({ kind: 'canvas.edge', id: expect.stringMatching(`^${state.projectId}:`) })
  const nodeRef = result.nodeRef as { kind: 'canvas.node'; id: string }
  await expect(harness.read(nodeRef)).resolves.toMatchObject({ ref: expect.objectContaining({ id: nodeRef.id }) })
  expect(requireCanvasProjectInstance(state.projectId).store.getState().nodes).toHaveLength(2)
  expect(useCanvasStore.getState().nodes).toHaveLength(0)
  expect(state.materialize).not.toHaveBeenCalled()
  expect(remove).not.toHaveBeenCalled()
  expect(requireImageEditDocumentInstanceV3(state.document.id).leases).toBe(0)
})
