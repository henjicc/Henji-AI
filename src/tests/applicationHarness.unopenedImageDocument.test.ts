// @vitest-environment jsdom
import '@/tests/canvasProjectFixture'
import '@/tests/imageEditDocumentFixture'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createAttachedImageEditPersistenceFixture } from './imageEditAttachedPersistenceFixture'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage, readHarnessImageEditDocument } from './harnessNativeStorage'
import { createApplicationHarness } from './applicationHarness'
import { findCanvasProjectInstance, releaseCanvasProjectInstance, requireCanvasProjectInstance } from '@/features/canvas/application/canvasProjectInstances'
import { requireImageEditDocumentInstanceV3 } from '@/features/imageEdit/v3/application/imageEditDocumentInstances'
import { imageEditV3LayerRef } from '@/features/imageEdit/v3/application/imageEditDocumentRefs'
import { getProjectRecord } from '@/commands/projectState'
import { useProjectStore } from '@/stores/projectStore'
import { createApplicationCapabilitySession, listApplicationCapabilities } from '@/features/application-control/applicationCapabilityService'
import { createApplicationCallerGrant } from '@/core/application-control/callerContext'
import { createImageEditAnnotationLayerV3, createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory'
import { ImageEditCommandBusV3 } from '@/features/imageEdit/v3/application/imageEditCommandBus'
import { ANNOTATION_DEFAULT_STROKE_HEX } from '@/core/theme/colorTokens'
import { getPlatform } from '@/platform/runtime'

const boundary = vi.hoisted(() => ({ load: vi.fn(), saveProjection: vi.fn() }))
vi.mock('@/commands/imageEditorV3', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/commands/imageEditorV3')>(), loadImageEditorV3Document: boundary.load,
}))
vi.mock('@/features/canvas/application/multiLayerDocumentNodeGenerationAdapter', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/features/canvas/application/multiLayerDocumentNodeGenerationAdapter')>(),
  saveMultiLayerDocumentAfterEditing: boundary.saveProjection,
}))

beforeEach(() => { installHarnessNativeStorage(); boundary.load.mockReset(); boundary.saveProjection.mockReset() })
afterEach(uninstallHarnessNativeStorage)

async function setup() {
  const fixture = await createAttachedImageEditPersistenceFixture()
  const snapshot = fixture.bus.getPersistenceSnapshot()
  boundary.load.mockResolvedValue({ ...snapshot, documentRef: `image-edit-v3:${fixture.document.id}`, revision: 0,
    resources: [], resourceRefs: [], previewRef: null, sourceFingerprint: `sha256:${'a'.repeat(64)}` })
  boundary.saveProjection.mockImplementation(fixture.saveProjection)
  const visibleId = await useProjectStore.getState().createProject('正在编辑 A')
  fixture.dispose()
  expect(releaseCanvasProjectInstance(fixture.projectId)).toBe(true)
  expect(findCanvasProjectInstance(fixture.projectId)).toBeUndefined()
  return { fixture, visibleId }
}

it('从目录发现未打开文档，通过正式公共入口修改后恢复原画布关联并保存预览', async () => {
  const { fixture, visibleId } = await setup()
  const harness = createApplicationHarness()
  try {
    const listed = await harness.requireResult('list_application_entities', { entityType: 'image_edit.document', limit: 10 })
    expect(listed.refs).toContainEqual({ kind: 'image_edit.document', id: `v3:${fixture.document.id}` })
    expect(findCanvasProjectInstance(fixture.projectId)).toBeUndefined()
    const result = await harness.change(imageEditV3LayerRef(fixture.document.id, 'effect'), { 'image_edit.layer.opacity': 0.6 })
    expect(result.ok, JSON.stringify(result)).toBe(true)
    expect(requireImageEditDocumentInstanceV3(fixture.document.id).views).toBe(0)
    expect(requireImageEditDocumentInstanceV3(fixture.document.id).bus.getSnapshot().history.undoCount).toBe(1)
    expect(readHarnessImageEditDocument(fixture.document.id)?.document.revision).toBe(1)
    const background = requireCanvasProjectInstance(fixture.projectId).store.getState()
    expect(background.nodes[0].data.imageEditSession?.revision).toBe(1)
    expect(JSON.parse((await getProjectRecord(fixture.projectId))!.nodesJson)[0].data.imageEditSession.revision).toBe(1)
    expect(useProjectStore.getState().currentProjectId).toBe(visibleId)
    expect(requireCanvasProjectInstance(visibleId).store.getState().nodes).toEqual([])
    expect(boundary.saveProjection).toHaveBeenCalledOnce()
  } finally { harness.dispose() }
})

it('恢复的画布关联参与权限预检，没有原画布写权限时不修改图片', async () => {
  const { fixture } = await setup()
  const session = createApplicationCapabilitySession(createApplicationCallerGrant({ callerId: 'image-only',
    capabilityIds: listApplicationCapabilities().map((definition) => definition.id),
    permissions: ['application:read', 'application:write', 'image_edit:read', 'image_edit:write'],
    allowWrites: true, allowDestructive: false }))
  const result = await session.execute({ id: 'change_application_entities', version: 2, input: {
    summary: '尝试修改无画布写权限的图片', changes: [{ kind: 'set_properties', entityType: 'image_edit.layer',
      target: imageEditV3LayerRef(fixture.document.id, 'effect'), properties: { 'image_edit.layer.opacity': 0.6 } }],
  } }, { requestId: 'deny-projection', signal: new AbortController().signal })
  expect(result.ok).toBe(false)
  expect(requireImageEditDocumentInstanceV3(fixture.document.id).bus.getSnapshot().document.revision).toBe(0)
  expect(readHarnessImageEditDocument(fixture.document.id)?.document.revision).toBe(0)
  expect(boundary.saveProjection).not.toHaveBeenCalled()
})

it('直接发现未打开文档中的标注，无需先列出图片图层或打开编辑器', async () => {
  const document = createImageEditDocumentV3({ documentId: 'unopened-annotations', width: 100, height: 80 })
  const layer = createImageEditAnnotationLayerV3('annotations', '标注')
  layer.annotations = [{ id: 'rect', type: 'rect', x: 1, y: 2, width: 30, height: 40, stroke: ANNOTATION_DEFAULT_STROKE_HEX, lineWidth: 2 }]
  document.layers = [layer]
  const snapshot = new ImageEditCommandBusV3(document).getPersistenceSnapshot()
  await getPlatform().imageEditorV3.saveDocument({ requestId: 'seed-unopened-annotations', document, expectedRevision: 0, history: snapshot.history, resourceRefs: [] })
  boundary.load.mockResolvedValue({ ...snapshot, documentRef: 'image-edit-v3:unopened-annotations', revision: 0,
    resources: [], resourceRefs: [], previewRef: null, sourceFingerprint: `sha256:${'a'.repeat(64)}` })
  const harness = createApplicationHarness()
  try {
    const result = await harness.requireResult('list_application_entities', { entityType: 'image_mark.annotation', limit: 10 })
    expect(result.refs).toContainEqual({ kind: 'image_mark.annotation', id: 'v3:unopened-annotations:annotations:rect' })
    expect(requireImageEditDocumentInstanceV3(document.id).views).toBe(0)
  } finally { harness.dispose() }
})
