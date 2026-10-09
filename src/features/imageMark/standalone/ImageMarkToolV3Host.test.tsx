/** @vitest-environment jsdom */

import '@/tests/imageEditDocumentFixture'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NotificationProvider } from '@/contexts/NotificationContext'
import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { OpenImageDocument } from '@/features/imageEdit/documents/imageDocumentRuntime'
import type { ImageDocumentWorkingHooks } from '@/features/imageEdit/documents/imageDocumentPersistence'
import type { ImageEditDocumentReferenceV3 } from '@/core/imageEdit/v3/serviceContracts'
import i18n from '@/i18n/config'
import type {
  ImageEditorV3DocumentSnapshot,
  ImageEditorV3ManagedSource,
} from '@/platform/contracts/imageEditorV3'
import { ImageMarkToolV3Host } from './ImageMarkToolV3Host'

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  loadDocument: vi.fn(),
  exportRaster: vi.fn(),
  resolveExportReadiness: vi.fn(),
  listExportFormats: vi.fn(),
  readFastProxy: vi.fn(),
  describePyramid: vi.fn(),
  prewarmPyramid: vi.fn(),
  readSourceTile: vi.fn(),
  readBrushTiles: vi.fn(),
}))

vi.mock('@/commands/imageEditorV3', () => ({
  ImageEditorV3CommandRepository: class {
    save(
      document: ImageEditDocumentV3,
      options: { expectedRevision: number; previewRef?: string | null; signal?: AbortSignal },
    ): Promise<ImageEditDocumentReferenceV3> {
      return mocks.save(document, options) as Promise<ImageEditDocumentReferenceV3>
    }
  },
  loadImageEditorV3Document: mocks.loadDocument,
  readImageEditorV3FastProxy: mocks.readFastProxy,
  describeImageEditorV3SourcePyramid: mocks.describePyramid,
  prewarmImageEditorV3SourcePyramid: mocks.prewarmPyramid,
  readImageEditorV3SourceTile: mocks.readSourceTile,
  readImageEditorV3BrushTiles: mocks.readBrushTiles,
}))

vi.mock('./imageMarkV3RasterExport', () => ({
  exportImageMarkV3Raster: mocks.exportRaster,
  imageMarkV3RasterExportExtension: (format: string) => format === 'jpeg' ? 'jpg' : 'png',
  isImageMarkV3RasterExportAbort: (error: unknown) => (
    error instanceof Error && error.name === 'AbortError'
  ),
  listImageMarkV3RasterExportFormats: mocks.listExportFormats,
  resolveImageMarkV3RasterExportFailureReason: (error: unknown) => (
    error instanceof Error ? { reason: error.message } : {}
  ),
  resolveImageMarkV3RasterExportReadiness: mocks.resolveExportReadiness,
}))

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const RESOURCE_REF = `sha256:${'a'.repeat(64)}` as const
const SOURCE_FINGERPRINT = `sha256:${'b'.repeat(64)}` as const
let persistedDocument: ImageEditDocumentV3 | null = null

function managedSource(): ImageEditorV3ManagedSource {
  return {
    mediaUrl: `henji-media://image-editor-v3/${'a'.repeat(64)}?mediaType=image%2Fpng`,
    resource: { resourceRef: RESOURCE_REF, byteLength: 4_096, mediaType: 'image/png' },
    metadata: {
      resourceRef: RESOURCE_REF,
      width: 1_600,
      height: 900,
      encodedWidth: 1_600,
      encodedHeight: 900,
      format: 'png',
      channels: 4,
      depth: 'uchar',
      bitsPerSample: 8,
      colorSpace: 'srgb',
      orientation: 1,
      orientationApplied: true,
      density: 72,
      pages: 1,
      hasAlpha: true,
      hasIccProfile: false,
      iccProfileResourceRef: null,
      cicp: null,
      hdr: false,
    },
  }
}

const DOCUMENT_ID = 'toolbox-document'
const SOURCE_URL = `henji-media://image-editor-v3/${'a'.repeat(64)}?mediaType=image%2Fpng`

function workingDocument(revision = 0): ImageEditDocumentV3 {
  const source = managedSource()
  const migrated = createImageEditDocumentV3({
    width: source.metadata.width,
    height: source.metadata.height,
    sourceResourceId: source.resource.resourceRef,
    documentId: DOCUMENT_ID,
  })
  return { ...migrated, revision }
}

interface FakeOpenDocument extends OpenImageDocument {
  hooks: ImageDocumentWorkingHooks | null
}

function fakeOpenDocument(): FakeOpenDocument {
  let shown = false
  const fake: FakeOpenDocument = {
    id: DOCUMENT_ID,
    hooks: null,
    session: { documentMeta: { name: 'source' } } as unknown as OpenImageDocument['session'],
    persistence: { onWorkingReplaced: () => () => undefined } as unknown as OpenImageDocument['persistence'],
    working: () => ({ documentRef: `image-edit-v3:${DOCUMENT_ID}`, revision: persistedDocument?.revision ?? 0, previewRef: null, sourceUrl: SOURCE_URL }),
    attachEditor: (hooks) => {
      fake.hooks = hooks
      return () => { if (fake.hooks === hooks) fake.hooks = null }
    },
    isShown: () => shown,
    setShown: (value) => { shown = value },
  }
  return fake
}

function renderHost(options: {
  strictMode?: boolean
  document?: FakeOpenDocument
  onSave?: () => Promise<void>
  onSaveAs?: () => Promise<void>
} = {}) {
  const host = (
    <NotificationProvider>
      <div style={{ width: 1_200, height: 800 }}>
        <ImageMarkToolV3Host
          document={options.document ?? fakeOpenDocument()}
          sourceName="source.png"
          onOpenFile={() => undefined}
          onPasteFromClipboard={() => undefined}
          onCreateBlank={() => undefined}
          onSave={options.onSave ?? (async () => undefined)}
          onSaveAs={options.onSaveAs ?? (async () => undefined)}
        />
      </div>
    </NotificationProvider>
  )
  return render(options.strictMode ? <StrictMode>{host}</StrictMode> : host)
}

async function startRasterExport(formatLabel = 'PNG（8 位）'): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: '选择栅格导出格式' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: formatLabel }))
}

async function findLayerOpacity(
  opacityLabel = '不透明度滑杆',
  basicsLabel = '基础',
): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('tab', { name: basicsLabel }))
  return screen.findByRole('slider', { name: opacityLabel })
}

describe('ImageMarkToolV3Host', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    persistedDocument = workingDocument()
    mocks.save.mockReset().mockImplementation(async (document: ImageEditDocumentV3) => {
      persistedDocument = document
      return {
        documentId: document.id,
        revision: document.revision,
        previewRef: null,
      }
    })
    mocks.readFastProxy.mockReset()
    mocks.loadDocument.mockReset().mockImplementation(async ({ documentRef }): Promise<ImageEditorV3DocumentSnapshot> => {
      if (!persistedDocument) throw new Error('missing persisted document')
      return {
        documentRef,
        revision: persistedDocument.revision,
        previewRef: null,
        document: structuredClone(persistedDocument),
        history: null,
        resourceRefs: [RESOURCE_REF],
        resources: [{ resourceRef: RESOURCE_REF, byteLength: 4_096, mediaType: 'image/png' }],
        sourceFingerprint: SOURCE_FINGERPRINT,
      }
    })
    mocks.exportRaster.mockReset().mockResolvedValue({
      status: 'completed',
      value: {
        outputRef: 'image-export-v3:toolbox@1:png8',
        documentRef: 'image-edit-v3:toolbox-document',
        revision: 1,
        sourceFingerprint: SOURCE_FINGERPRINT,
        format: 'png8',
        width: 1_600,
        height: 900,
      },
    })
    mocks.resolveExportReadiness.mockReset().mockReturnValue({ state: 'ready' })
    mocks.listExportFormats.mockReset().mockReturnValue([
      'png8', 'jpeg', 'webp', 'tiff8', 'bigtiff',
    ])
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('从图片文档的工作副本载入（不重新导入图片），修改高频保存进工作副本', async () => {
    const rendered = renderHost()

    await waitFor(() => expect(rendered.container.querySelector('[data-image-editor-v3]')).toBeTruthy())
    expect(rendered.container.querySelector('[data-host-profile="full"]')).toBeTruthy()
    expect(mocks.loadDocument).toHaveBeenCalledWith({
      requestId: expect.stringContaining('document-load'),
      documentRef: `image-edit-v3:${DOCUMENT_ID}`,
    }, expect.any(AbortSignal))
    expect(mocks.save).not.toHaveBeenCalled()

    const opacity = await findLayerOpacity()
    fireEvent.change(opacity, { target: { value: '75' } })
    fireEvent.pointerUp(opacity)
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1), { timeout: 1_500 })
    expect(mocks.save).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ revision: 1 }),
      expect.objectContaining({
        expectedRevision: 0,
        previewRef: null,
        history: expect.objectContaining({ headRevision: 1, undo: expect.any(Array) }),
      }),
    )
    expect(rendered.container.querySelector('[data-command-bar]')?.textContent).not.toMatch(/版本\s*\d+/)
  })

  it('StrictMode 生命周期重放只读取一次工作副本', async () => {
    const rendered = renderHost({ strictMode: true })

    await waitFor(() => expect(rendered.container.querySelector('[data-image-editor-v3]')).toBeTruthy())
    expect(mocks.loadDocument).toHaveBeenCalledTimes(1)
    expect(rendered.container.querySelector('[data-image-editor-v3-host-state="failed"]')).toBeNull()
  })

  it('工作副本读取失败时只提供重试，不伪造文档结果', async () => {
    mocks.loadDocument.mockRejectedValueOnce(new Error('missing working copy'))
    renderHost()

    expect((await screen.findByRole('alert')).textContent).toContain('无法打开图片编辑器')
    expect(screen.queryByText('missing working copy')).toBeNull()
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('命令带有保存与另存为；导出只列发布格式；来源菜单不再有打开可编辑文件', async () => {
    const onSave = vi.fn(async () => undefined)
    const onSaveAs = vi.fn(async () => undefined)
    const rendered = renderHost({ onSave, onSaveAs })
    await waitFor(() => expect(rendered.container.querySelector('[data-image-editor-v3]')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    fireEvent.click(screen.getByRole('button', { name: '另存为…' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSaveAs).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: '打开' }))
    expect(screen.queryByRole('button', { name: '打开可编辑文件' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '选择栅格导出格式' }))
    expect(document.querySelectorAll('[data-export-format]')).toHaveLength(3)
    expect(document.querySelector('[data-export-format="tiff8"]')).toBeNull()
  })

  it('接到文档会话：会话保存时把待保存修改落进工作副本，卸载时解除', async () => {
    const openDocument = fakeOpenDocument()
    const rendered = renderHost({ document: openDocument })
    await waitFor(() => expect(rendered.container.querySelector('[data-image-editor-v3]')).toBeTruthy())
    expect(openDocument.isShown()).toBe(true)
    expect(openDocument.hooks).toBeTruthy()

    const opacity = await findLayerOpacity()
    fireEvent.change(opacity, { target: { value: '50' } })
    fireEvent.pointerUp(opacity)
    await openDocument.hooks?.flush()
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ revision: 1 }), expect.anything())

    rendered.unmount()
    expect(openDocument.hooks).toBeNull()
    expect(openDocument.isShown()).toBe(false)
  })

  it('自动保存期间不在右上角插入瞬时状态或推动操作按钮', async () => {
    const rendered = renderHost()
    await waitFor(() => expect(rendered.container.querySelector('[data-image-editor-v3]')).toBeTruthy())
    const actions = rendered.container.querySelector<HTMLElement>('[data-command-bar-actions]')
    expect(actions).toBeTruthy()
    const stableActionsText = actions?.textContent

    let finishSave: ((reference: ImageEditDocumentReferenceV3) => void) | undefined
    mocks.save.mockImplementationOnce((document: ImageEditDocumentV3) => {
      persistedDocument = document
      return new Promise<ImageEditDocumentReferenceV3>((resolve) => {
        finishSave = resolve
      })
    })

    const opacity = await findLayerOpacity()
    fireEvent.change(opacity, { target: { value: '70' } })
    fireEvent.pointerUp(opacity)
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1), { timeout: 1_500 })

    expect(screen.queryByText('正在保存…')).toBeNull()
    expect(actions?.textContent).toBe(stableActionsText)
    finishSave?.({
      documentId: persistedDocument?.id ?? 'toolbox-document',
      revision: persistedDocument?.revision ?? 1,
      previewRef: null,
    })
    await Promise.resolve()
  })

  it('选定格式后先落盘待保存命令，再读取权威快照执行栅格分块导出', async () => {
    renderHost()
    const opacity = await findLayerOpacity()
    fireEvent.change(opacity, { target: { value: '60' } })
    fireEvent.pointerUp(opacity)

    await startRasterExport('JPEG（8 位，白色背景）')

    await waitFor(() => expect(mocks.exportRaster).toHaveBeenCalledTimes(1))
    expect(mocks.save).toHaveBeenCalledTimes(1)
    expect(mocks.loadDocument).toHaveBeenCalledWith(expect.objectContaining({
      documentRef: expect.stringMatching(/^image-edit-v3:/),
    }), expect.any(AbortSignal))
    const exported = mocks.exportRaster.mock.calls[0][0]
    expect(exported.snapshot).toMatchObject({
      revision: 1,
      sourceFingerprint: SOURCE_FINGERPRINT,
      document: { revision: 1 },
    })
    expect(exported.sourceName).toBe('source.png')
    expect(exported.format).toBe('jpeg')
    expect(exported.suggestedName).toBe('source-已编辑.jpg')
    expect(exported.signal).toBeInstanceOf(AbortSignal)
    expect(mocks.save.mock.invocationCallOrder[0]).toBeLessThan(mocks.loadDocument.mock.invocationCallOrder[1])
    expect(mocks.loadDocument.mock.invocationCallOrder[1]).toBeLessThan(mocks.exportRaster.mock.invocationCallOrder[0])
    expect(await screen.findByText('栅格图片已导出')).toBeTruthy()
  })

  it('导出期间显示进度并用同一信号取消分块渲染和写入', async () => {
    let receivedSignal: AbortSignal | null = null
    mocks.exportRaster.mockImplementationOnce(({ signal, onProgress }) => {
      receivedSignal = signal
      onProgress({ completed: 2, total: 7 })
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          reject(error)
        }, { once: true })
      })
    })
    renderHost()
    await findLayerOpacity()
    await startRasterExport()

    expect(await screen.findByText('正在导出 2/7')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '取消导出' }))

    await waitFor(() => expect(receivedSignal?.aborted).toBe(true))
    expect(await screen.findByText('已取消导出')).toBeTruthy()
    await waitFor(() => expect(screen.getByRole('button', { name: '选择栅格导出格式' })).toBeTruthy())
  })

  it('将导出失败原因明确通知用户', async () => {
    mocks.exportRaster.mockRejectedValueOnce(new Error('图像编码器暂时不可用'))
    renderHost()
    await findLayerOpacity()
    await startRasterExport()

    expect(await screen.findByText('无法导出栅格图片：图像编码器暂时不可用')).toBeTruthy()
  })

  it('导出预检不通过时直接禁用入口并展示中文原因', async () => {
    mocks.resolveExportReadiness.mockReturnValue({
      state: 'disabled',
      reasonKey: 'imageEditor.v3.readiness.reasons.exportHdrMetadata',
    })
    renderHost()

    const exportButton = await screen.findByRole('button', {
      name: /导出暂不可用：当前版本还不能可靠保留 HDR 元数据/,
    }) as HTMLButtonElement
    expect(exportButton.disabled).toBe(true)
    expect(exportButton.title).toBe(
      '当前版本还不能可靠保留 HDR 元数据，已阻止降级导出为 SDR 图片。',
    )
    fireEvent.click(exportButton)
    expect(mocks.loadDocument).toHaveBeenCalledTimes(1)
    expect(mocks.exportRaster).not.toHaveBeenCalled()
  })

  it('en-US 下宿主、来源菜单与 profile/readiness 原因全部使用英文', async () => {
    await i18n.changeLanguage('en-US')
    mocks.resolveExportReadiness.mockReturnValue({
      state: 'disabled',
      reasonKey: 'imageEditor.v3.readiness.reasons.exportHdrMetadata',
    })
    renderHost()

    expect(await findLayerOpacity('Opacity滑杆', 'Basics')).toBeTruthy()
    const exportButton = screen.getByRole('button', {
      name: /Export unavailable: This version cannot preserve HDR metadata reliably/,
    }) as HTMLButtonElement
    expect(exportButton.disabled).toBe(true)
    const handButton = screen.getByRole('button', { name: 'Pan canvas (Hand)' }) as HTMLButtonElement
    expect(handButton.disabled).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(await screen.findByRole('button', { name: 'Open image' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Open editable file' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Paste image from clipboard' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create blank image' })).toBeTruthy()
  })
})
