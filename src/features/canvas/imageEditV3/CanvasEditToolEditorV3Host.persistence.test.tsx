// @vitest-environment jsdom
import '@/tests/imageEditDocumentFixture'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ImageEditorV3CommandRepository } from '@/commands/imageEditorV3'
import { createImageEditDocumentV3, createImageEditEffectLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import { getApplicationControlExecutionEngine, getApplicationReflectionRegistry } from '@/features/application-control/capabilities/applicationControlRegistry'
import { listImageEditDocumentInstancesV3 } from '@/features/imageEdit/v3/application/imageEditDocumentInstances'
import { imageEditV3LayerRef } from '@/features/imageEdit/v3/application/imageEditDocumentRefs'
import { useImageEditorControllerV3 } from '@/features/imageEdit/v3/editor/useImageEditorControllerV3'
import type { ImageEditorV3Props } from '@/features/imageEdit/v3/editor/types'
import { installHarnessNativeStorage, readHarnessImageEditDocument, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import type { CanvasEditV3PreparedSession } from './canvasEditV3Session'
import { CanvasEditToolEditorV3Host } from './CanvasEditToolEditorV3Host'

const mocks = vi.hoisted(() => ({ prepare: vi.fn() }))
vi.mock('./canvasEditV3Session', async () => ({
  ...await vi.importActual<typeof import('./canvasEditV3Session')>('./canvasEditV3Session'),
  prepareCanvasEditV3Session: mocks.prepare,
  createCanvasEditV3Repository: () => new ImageEditorV3CommandRepository(),
}))
// 只替换 GPU/DOM 呈现；正式 controller、bus、registry、宿主队列和 native 存储链保留。
vi.mock('@/features/imageEdit/v3/editor', () => ({ ImageEditorV3: (props: ImageEditorV3Props) => {
  useImageEditorControllerV3(props)
  return <div data-testid="controller-ready" />
} }))

beforeEach(() => { installHarnessNativeStorage() })
afterEach(async () => { cleanup(); await Promise.resolve(); uninstallHarnessNativeStorage() })

it('异步加载完成后实际宿主登记 durable owner，正式反射修改等待真实存储替身且不自动 Apply', async () => {
  let finish!: (session: CanvasEditV3PreparedSession) => void
  mocks.prepare.mockReturnValue(new Promise<CanvasEditV3PreparedSession>((resolve) => { finish = resolve }))
  const document = createImageEditDocumentV3({ width: 8, height: 8, documentId: 'host-async-owner' })
  document.layers = [createImageEditEffectLayerV3('layer', '模糊', 'image.gaussian-blur-v2', { radius: 8 })]
  const history = { version: 1 as const, documentId: document.id, headRevision: 0, undo: [], redo: [] }
  const optionsChanged = vi.fn()
  const view = render(<CanvasEditToolEditorV3Host plugin={{} as never} options={{}} sourceImageUrl="source.png" onOptionsChange={optionsChanged} />)
  expect(listImageEditDocumentInstancesV3().some((session) => session.documentId === document.id)).toBe(false)
  await act(async () => { finish({ sourceUrl: 'source.png', document, history,
    persistence: { document, history, retainedResources: [] }, reference: { documentId: document.id, revision: 0, previewRef: null },
    resourceByteSizes: {}, resourceDescriptors: [] }) })
  await waitFor(() => expect(listImageEditDocumentInstancesV3().find((session) => session.documentId === document.id)?.persistenceOwner).toBeDefined())
  const context = { requestId: 'host-formal-write', exposure: 'assistant' as const,
    permissions: new Set(['image_edit:read', 'image_edit:write']), acceptedDataClasses: new Set(['C0', 'C1'] as const) }
  const target = imageEditV3LayerRef(document.id, 'layer')
  const engine = getApplicationControlExecutionEngine()
  const snapshot = await getApplicationReflectionRegistry().readEntity(target, [], context)
  const plan = await engine.plan({ summary: '异步宿主写入', transactionMode: 'atomic',
    steps: [{ kind: 'mutation', entityType: 'image_edit.layer', target, expectedRevisions: snapshot.revisions,
      mutations: [{ propertyId: 'image_edit.layer.opacity', operation: 'set', value: 0.42 }] }] }, context)
  let result: Awaited<ReturnType<typeof engine.commit>> | undefined
  await act(async () => { result = await engine.commit({ planRef: plan.planRef, expectedRevisions: snapshot.revisions,
    idempotencyKey: 'async-host-persistence-write' }, context) })
  expect(result?.status).toBe('completed')
  expect(readHarnessImageEditDocument(document.id)?.document.layers[0].opacity).toBe(0.42)
  if (result?.status === 'completed') expect(result.effects.every((effect) => effect.entityType !== 'canvas.node')).toBe(true)
  const owner = listImageEditDocumentInstancesV3().find((session) => session.documentId === document.id)!.persistenceOwner!
  view.unmount()
  await expect(owner.confirm(true)).resolves.toMatchObject({ documentId: document.id, revision: 1 })
})
