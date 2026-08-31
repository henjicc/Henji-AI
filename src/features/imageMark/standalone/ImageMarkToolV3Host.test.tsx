/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NotificationProvider } from '@/contexts/NotificationContext'
import { createEmptyImageEditDocument } from '@/core/imageEdit'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditDocumentReferenceV3 } from '@/core/imageEdit/v3/serviceContracts'
import i18n from '@/i18n/config'
import type {
  ImageEditorV3DocumentSnapshot,
  ImageEditorV3ManagedSource,
} from '@/platform/contracts/imageEditorV3'
import { ImageMarkToolV3Host } from './ImageMarkToolV3Host'

const mocks = vi.hoisted(() => ({
  ingest: vi.fn(),
  save: vi.fn(),
  savePackage: vi.fn(),
  openPackage: vi.fn(),
  loadDocument: vi.fn(),
  exportRaster: vi.fn(),
  resolveExportReadiness: vi.fn(),
  readFastProxy: vi.fn(),
  describePyramid: vi.fn(),
  prewarmPyramid: vi.fn(),
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
  ingestImageEditorV3Source: mocks.ingest,
  loadImageEditorV3Document: mocks.loadDocument,
  openImageEditorV3Package: mocks.openPackage,
  saveImageEditorV3PackageAs: mocks.savePackage,
  readImageEditorV3FastProxy: mocks.readFastProxy,
  describeImageEditorV3SourcePyramid: mocks.describePyramid,
  prewarmImageEditorV3SourcePyramid: mocks.prewarmPyramid,
  readImageEditorV3BrushTiles: mocks.readBrushTiles,
}))

vi.mock('./imageMarkV3RasterExport', () => ({
  exportImageMarkV3Raster: mocks.exportRaster,
  isImageMarkV3RasterExportAbort: (error: unknown) => (
    error instanceof Error && error.name === 'AbortError'
  ),
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

function renderHost(onFallback = vi.fn()) {
  return {
    onFallback,
    ...render(
      <NotificationProvider>
        <div style={{ width: 1_200, height: 800 }}>
          <ImageMarkToolV3Host
            sourceImageUrl="/private/tmp/source.png"
            sourceName="source.png"
            sourceSessionKey={1}
            initialDocument={createEmptyImageEditDocument()}
            onOpenFile={() => undefined}
            onPasteFromClipboard={() => undefined}
            onCreateBlank={() => undefined}
            onFallback={onFallback}
          />
        </div>
      </NotificationProvider>,
    ),
  }
}

describe('ImageMarkToolV3Host', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    mocks.ingest.mockReset().mockResolvedValue(managedSource())
    persistedDocument = null
    mocks.save.mockReset().mockImplementation(async (document: ImageEditDocumentV3) => {
      persistedDocument = document
      return {
        documentId: document.id,
        revision: document.revision,
        previewRef: null,
      }
    })
    mocks.savePackage.mockReset().mockResolvedValue({
      status: 'completed',
      value: {
        outputRef: 'henjiimg:toolbox@1',
        documentRef: 'image-edit-v3:toolbox-document',
        revision: 1,
      },
    })
    mocks.openPackage.mockReset().mockResolvedValue({ status: 'cancelled' })
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
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('导入受管源、迁移旧文档并以 full profile 保存 V3 真相源', async () => {
    const rendered = renderHost()

    await waitFor(() => expect(rendered.container.querySelector('[data-image-editor-v3]')).toBeTruthy())
    expect(rendered.container.querySelector('[data-host-profile="full"]')).toBeTruthy()
    expect(mocks.ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        source: { kind: 'local-path', filePath: '/private/tmp/source.png' },
      }),
      expect.any(AbortSignal),
    )
    expect(mocks.save).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        revision: 0,
        geometry: expect.objectContaining({ width: 1_600, height: 900 }),
        layers: expect.arrayContaining([
          expect.objectContaining({ type: 'raster', source: { kind: 'resource', resourceId: RESOURCE_REF } }),
          expect.objectContaining({ type: 'annotation' }),
        ]),
      }),
      expect.objectContaining({
        expectedRevision: 0,
        previewRef: null,
        history: expect.objectContaining({ headRevision: 0, undo: [], redo: [] }),
      }),
    )

    const opacity = await screen.findByRole('slider', { name: '不透明度' })
    fireEvent.change(opacity, { target: { value: '0.75' } })
    fireEvent.pointerUp(opacity)
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2), { timeout: 1_500 })
    expect(mocks.save).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ revision: 1 }),
      expect.objectContaining({
        expectedRevision: 0,
        previewRef: null,
        history: expect.objectContaining({ headRevision: 1, undo: expect.any(Array) }),
      }),
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存可编辑文件…' }))
    })
    await waitFor(() => expect(mocks.savePackage).toHaveBeenCalledWith(expect.objectContaining({
      documentRef: expect.stringMatching(/^image-edit-v3:/),
      revision: 1,
      suggestedName: 'source-可编辑.henjiimg',
    })))
  })

  it('导入失败时提供重试和显式兼容回退，不伪造旧文档结果', async () => {
    mocks.ingest.mockRejectedValueOnce(new Error('unsupported source'))
    const onFallback = vi.fn()
    renderHost(onFallback)

    expect((await screen.findByRole('alert')).textContent).toContain('无法打开新版图片编辑器')
    expect(screen.queryByText('unsupported source')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '使用兼容编辑器' }))
    expect(onFallback).toHaveBeenCalledTimes(1)
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('从唯一来源菜单打开可编辑包并切换到包内权威文档', async () => {
    const rendered = renderHost()
    await waitFor(() => expect(rendered.container.querySelector('[data-image-editor-v3]')).toBeTruthy())
    if (!persistedDocument) throw new Error('missing bootstrapped document')
    const packagedDocument = {
      ...structuredClone(persistedDocument),
      id: 'package-document',
      revision: 4,
    }
    mocks.openPackage.mockResolvedValueOnce({
      status: 'completed',
      value: {
        snapshot: {
          documentRef: 'image-edit-v3:package-document',
          revision: 4,
          previewRef: null,
          document: packagedDocument,
          history: {
            version: 1,
            documentId: 'package-document',
            headRevision: 4,
            undo: [],
            redo: [],
          },
          resourceRefs: [RESOURCE_REF],
          resources: [{ resourceRef: RESOURCE_REF, byteLength: 4_096, mediaType: 'image/png' }],
          sourceFingerprint: SOURCE_FINGERPRINT,
        },
        resources: [{ resourceRef: RESOURCE_REF, byteLength: 4_096, mediaType: 'image/png' }],
        thumbnail: null,
      },
    })

    fireEvent.click(screen.getByRole('button', { name: '打开' }))
    fireEvent.click(await screen.findByRole('button', { name: '打开可编辑文件' }))

    await waitFor(() => expect(mocks.openPackage).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('版本 4')).toBeTruthy()
    expect(rendered.container.querySelector('[data-image-editor-v3]')).toBeTruthy()
  })

  it('先落盘待保存命令，再读取权威快照执行栅格分块导出', async () => {
    renderHost()
    const opacity = await screen.findByRole('slider', { name: '不透明度' })
    fireEvent.change(opacity, { target: { value: '0.6' } })
    fireEvent.pointerUp(opacity)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '导出 PNG…' }))
    })

    await waitFor(() => expect(mocks.exportRaster).toHaveBeenCalledTimes(1))
    expect(mocks.save).toHaveBeenCalledTimes(2)
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
    expect(exported.signal).toBeInstanceOf(AbortSignal)
    expect(mocks.save.mock.invocationCallOrder[1]).toBeLessThan(mocks.loadDocument.mock.invocationCallOrder[0])
    expect(mocks.loadDocument.mock.invocationCallOrder[0]).toBeLessThan(mocks.exportRaster.mock.invocationCallOrder[0])
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
    await screen.findByRole('slider', { name: '不透明度' })
    fireEvent.click(screen.getByRole('button', { name: '导出 PNG…' }))

    expect(await screen.findByText('正在导出 2/7')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '取消导出' }))

    await waitFor(() => expect(receivedSignal?.aborted).toBe(true))
    expect(await screen.findByText('已取消导出')).toBeTruthy()
    await waitFor(() => expect(screen.getByRole('button', { name: '导出 PNG…' })).toBeTruthy())
  })

  it('将不可支持的效果原因明确通知用户', async () => {
    mocks.exportRaster.mockRejectedValueOnce(new Error('辉光 Pro 尚未接入流式导出'))
    renderHost()
    await screen.findByRole('slider', { name: '不透明度' })
    fireEvent.click(screen.getByRole('button', { name: '导出 PNG…' }))

    expect(await screen.findByText('无法导出栅格图片：辉光 Pro 尚未接入流式导出')).toBeTruthy()
  })

  it('导出预检不通过时直接禁用入口并展示中文原因', async () => {
    mocks.resolveExportReadiness.mockReturnValue({
      state: 'disabled',
      reasonKey: 'imageEditor.v3.readiness.reasons.exportHdrMetadata',
    })
    renderHost()

    const exportButton = await screen.findByRole('button', {
      name: /导出 PNG 暂不可用：当前版本还不能可靠保留 HDR 元数据/,
    }) as HTMLButtonElement
    expect(exportButton.disabled).toBe(true)
    expect(exportButton.title).toBe(
      '当前版本还不能可靠保留 HDR 元数据，已阻止降级导出为 SDR 图片。',
    )
    fireEvent.click(exportButton)
    expect(mocks.loadDocument).not.toHaveBeenCalled()
    expect(mocks.exportRaster).not.toHaveBeenCalled()
  })

  it('en-US 下宿主、来源菜单与 profile/readiness 原因全部使用英文', async () => {
    await i18n.changeLanguage('en-US')
    mocks.resolveExportReadiness.mockReturnValue({
      state: 'disabled',
      reasonKey: 'imageEditor.v3.readiness.reasons.exportHdrMetadata',
    })
    renderHost()

    expect(await screen.findByRole('slider', { name: 'Opacity' })).toBeTruthy()
    const exportButton = screen.getByRole('button', {
      name: /PNG export unavailable: This version cannot preserve HDR metadata reliably/,
    }) as HTMLButtonElement
    expect(exportButton.disabled).toBe(true)
    const handButton = screen.getByRole('button', { name: 'Hand' }) as HTMLButtonElement
    expect(handButton.disabled).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(await screen.findByRole('button', { name: 'Open from file' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open editable file' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Paste image from clipboard' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create blank image' })).toBeTruthy()
  })
})
