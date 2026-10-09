/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImageEditorV3Props } from '@/features/imageEdit/v3/editor/types'
import { ImageEditCommandBusV3 } from '@/features/imageEdit/v3/application/imageEditCommandBus'
import { createImageEditAnnotationLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import { BLACK_HEX } from '@/core/theme/colorTokens'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage, readHarnessImageEditDocument } from '@/tests/harnessNativeStorage'
import { imageEditTestManagedSource, imageEditTestSnapshot } from '@/tests/imageEditV3SourceFixture'
import { resetImageEditDocumentInstancesForTestsV3 } from '@/features/imageEdit/v3/application/imageEditDocumentInstances'
import { ViewerMarkEditor } from './ViewerMarkEditor'
const io = vi.hoisted(() => ({ materialize: vi.fn(), ingest: vi.fn(), load: vi.fn() }))
let editorProps: ImageEditorV3Props
vi.mock('react-i18next', async importOriginal => ({ ...await importOriginal<typeof import('react-i18next')>(), useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/features/imageEdit/v3/editor', () => ({ ImageEditorV3: (props: ImageEditorV3Props) => { editorProps = props; return <div data-testid="v3-viewer-editor">{props.toolbarActions}</div> } }))
vi.mock('@/commands/imageEditorV3', async importOriginal => ({ ...await importOriginal<typeof import('@/commands/imageEditorV3')>(), ingestImageEditorV3Source: io.ingest, loadImageEditorV3Document: io.load }))
vi.mock('@/features/imageEdit/v3/application/imageEditMaterializationV3', () => ({ materializeImageEditSnapshotV3: io.materialize }))
beforeEach(() => {
  vi.clearAllMocks(); installHarnessNativeStorage()
  io.ingest.mockResolvedValue(imageEditTestManagedSource())
  io.load.mockImplementation(async (request: { documentRef: string }) => { const value = readHarnessImageEditDocument(request.documentRef.slice('image-edit-v3:'.length)); return value ? imageEditTestSnapshot(value.document) : null })
  io.materialize.mockImplementation(async (snapshot: ReturnType<typeof imageEditTestSnapshot>) => ({ raster: { mediaUrl: 'henji-media://edited' }, session: { kind: 'image-edit-v3', documentRef: snapshot.documentRef, revision: snapshot.revision, previewRef: null, sourceUrl: 'henji-media://edited' } }))
})
afterEach(() => { cleanup(); resetImageEditDocumentInstancesForTestsV3(); uninstallHarnessNativeStorage() })
async function editGeometryAndMark() {
  const bus = new ImageEditCommandBusV3(editorProps.document, { historySnapshot: editorProps.historySnapshot })
  bus.dispatch({ type: 'document.update-output-geometry', commandId: 'geometry', expectedRevision: 0, orientation: { rotate: 90, mirrored: true }, crop: { x: 1, y: 2, width: 30, height: 40 } })
  const layer = createImageEditAnnotationLayerV3('marks', '标注')
  bus.dispatch({ type: 'layer.add', commandId: 'layer', expectedRevision: 1, layer, parentId: null, index: 1 })
  bus.dispatch({ type: 'annotation.add', commandId: 'mark', expectedRevision: 2, layerId: layer.id, index: 0, annotation: { id: 'mark', type: 'rect', x: 10, y: 20, width: 30, height: 40, stroke: BLACK_HEX, lineWidth: 2 } })
  const persistence = bus.getPersistenceSnapshot()
  await act(async () => { editorProps.onDocumentChange(persistence.document); editorProps.onPersistenceChange?.(persistence) })
  bus.dispose()
  return persistence.document
}
describe('查看器 V3 快速标记宿主', () => {
  it('quick profile 保存先确认同一文档，再从权威快照导出并回传 V3 引用', async () => {
    const save = vi.fn(); const changed = vi.fn()
    render(<ViewerMarkEditor imageUrl="C:/source.png" onClose={vi.fn()} onSave={save} onSessionChange={changed} />)
    await screen.findByTestId('v3-viewer-editor')
    expect(editorProps.profileId).toBe('quick')
    expect(editorProps.document.version).toBe(3)
    const document = await editGeometryAndMark()
    fireEvent.click(screen.getByText('common.save'))
    await waitFor(() => expect(save).toHaveBeenCalledOnce())
    expect(readHarnessImageEditDocument(document.id)?.document).toEqual(document)
    expect(io.materialize.mock.calls[0][0].document).toEqual(document)
    expect(save).toHaveBeenCalledWith('henji-media://edited', expect.objectContaining({ kind: 'image-edit-v3', documentRef: `image-edit-v3:${document.id}`, revision: 3, sourceUrl: 'C:/source.png' }))
    expect(changed).toHaveBeenCalledWith(save.mock.calls[0][1])
  })
  it('关闭先保存并回传最新引用，重开不重新摄入、不丢朝向裁剪和标注', async () => {
    const close = vi.fn(); const changed = vi.fn()
    const first = render(<ViewerMarkEditor imageUrl="C:/source.png" onClose={close} onSave={vi.fn()} onSessionChange={changed} />)
    await screen.findByTestId('v3-viewer-editor')
    const document = await editGeometryAndMark()
    fireEvent.click(screen.getByText('common.close'))
    await waitFor(() => expect(close).toHaveBeenCalledOnce())
    const session = changed.mock.calls[0][0]
    first.unmount()
    render(<ViewerMarkEditor imageUrl="C:/source.png" session={session} onClose={close} onSave={vi.fn()} />)
    await screen.findByTestId('v3-viewer-editor')
    expect(editorProps.document).toEqual(document)
    expect(io.ingest).toHaveBeenCalledOnce()
    expect(io.materialize).not.toHaveBeenCalled()
  })
  it('导出失败不报告保存成功，允许再次保存', async () => {
    const save = vi.fn()
    io.materialize.mockRejectedValueOnce(new Error('导出失败'))
    render(<ViewerMarkEditor imageUrl="C:/source.png" onClose={vi.fn()} onSave={save} />)
    await screen.findByTestId('v3-viewer-editor')
    fireEvent.click(screen.getByText('common.save'))
    await screen.findByText('imageEditor.v3.host.notifications.autosaveFailed')
    expect(save).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('common.save'))
    await waitFor(() => expect(save).toHaveBeenCalledOnce())
  })
  it('导出期间修改不会回传过期结果，卸载后不会触发保存回调', async () => {
    let resolveExport!: (value: unknown) => void
    io.materialize.mockImplementation(() => new Promise(resolve => { resolveExport = resolve }))
    const save = vi.fn(); const view = render(<ViewerMarkEditor imageUrl="C:/source.png" onClose={vi.fn()} onSave={save} />)
    await screen.findByTestId('v3-viewer-editor')
    fireEvent.click(screen.getByText('common.save'))
    await waitFor(() => expect(io.materialize).toHaveBeenCalledOnce())
    await editGeometryAndMark()
    await act(async () => resolveExport({ raster: { mediaUrl: 'expired' }, session: { previewRef: null } }))
    expect(save).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('common.save'))
    await waitFor(() => expect(io.materialize).toHaveBeenCalledTimes(2))
    view.unmount()
    await act(async () => resolveExport({ raster: { mediaUrl: 'closed' }, session: {} }))
    expect(save).not.toHaveBeenCalled()
  })
})
