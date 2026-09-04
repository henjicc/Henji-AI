/** @vitest-environment jsdom */

import { createRef } from 'react'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createImageEditDocumentV3,
  createImageEditRasterLayerV3,
} from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditorV3SourceMetadata } from '@/platform/contracts/imageEditorV3'
import { useImageEditorRasterPasteboardV3 } from './useImageEditorRasterPasteboardV3'

const RESOURCE_A = `sha256:${'a'.repeat(64)}` as const
const RESOURCE_B = `sha256:${'b'.repeat(64)}` as const
const resourceReaders = vi.hoisted(() => ({
  readFastProxy: vi.fn(),
  readSourceMetadata: vi.fn(),
}))

vi.mock('@/commands/imageEditorV3', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/commands/imageEditorV3')>()
  return {
    ...original,
    readImageEditorV3FastProxy: resourceReaders.readFastProxy,
    readImageEditorV3SourceMetadata: resourceReaders.readSourceMetadata,
  }
})

function fixture() {
  const document = createImageEditDocumentV3({
    width: 320,
    height: 180,
    documentId: 'pasteboard-resource-lifecycle',
    sourceResourceId: RESOURCE_A,
  })
  document.layers.push(createImageEditRasterLayerV3('foreground', '前景', RESOURCE_B))
  return {
    document,
    descriptors: [RESOURCE_A, RESOURCE_B].map((resourceRef) => ({
      resourceRef,
      byteLength: 4_096,
      mediaType: 'image/png',
    })),
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function proxy(resourceRef: typeof RESOURCE_A | typeof RESOURCE_B) {
  return {
    resourceRef,
    width: 320,
    height: 180,
    mediaType: 'image/webp' as const,
    bytes: new Uint8Array([1, 2, 3]).buffer,
  }
}

function metadata(
  resourceRef: typeof RESOURCE_A | typeof RESOURCE_B,
  patch: Partial<ImageEditorV3SourceMetadata> = {},
): ImageEditorV3SourceMetadata {
  return {
    resourceRef,
    width: 320,
    height: 180,
    encodedWidth: 320,
    encodedHeight: 180,
    format: 'png',
    channels: 4,
    depth: 'uchar',
    bitsPerSample: 8,
    colorSpace: 'srgb',
    orientation: 1,
    orientationApplied: true,
    density: null,
    pages: 1,
    hasAlpha: true,
    hasIccProfile: false,
    iccProfileResourceRef: null,
    cicp: null,
    hdr: false,
    ...patch,
  }
}

describe('useImageEditorRasterPasteboardV3 资源生命周期', () => {
  let createObjectURL = vi.fn((_: Blob) => '')
  let revokeObjectURL = vi.fn((_: string) => undefined)

  beforeEach(() => {
    cleanup()
    resourceReaders.readFastProxy.mockReset()
    resourceReaders.readSourceMetadata.mockReset()
    createObjectURL = vi.fn((_: Blob) => `blob:pasteboard-${createObjectURL.mock.calls.length}`)
    revokeObjectURL = vi.fn()
    const NativeUrl = URL
    class PasteboardUrl extends NativeUrl {}
    Object.assign(PasteboardUrl, { createObjectURL, revokeObjectURL })
    vi.stubGlobal('URL', PasteboardUrl)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('稳定展示就绪前不读取代理，就绪后才开始准备', async () => {
    resourceReaders.readFastProxy.mockImplementation(async (
      request: { resourceRef: typeof RESOURCE_A | typeof RESOURCE_B },
    ) => proxy(request.resourceRef))
    resourceReaders.readSourceMetadata.mockImplementation(async (
      request: { resourceRef: typeof RESOURCE_A | typeof RESOURCE_B },
    ) => metadata(request.resourceRef))
    const input = fixture()
    const stableDisplayRef = createRef<HTMLDivElement>()
    const rendered = renderHook(
      ({ stableReady }) => useImageEditorRasterPasteboardV3(
        input.document,
        'composite.png',
        320,
        true,
        input.descriptors,
        stableDisplayRef,
        stableReady,
      ),
      { initialProps: { stableReady: false } },
    )

    await act(async () => { await Promise.resolve() })
    expect(resourceReaders.readSourceMetadata).not.toHaveBeenCalled()
    expect(resourceReaders.readFastProxy).not.toHaveBeenCalled()
    rendered.rerender({ stableReady: true })
    await waitFor(() => expect(rendered.result.current.entries).toHaveLength(2))
    expect(resourceReaders.readSourceMetadata).toHaveBeenCalledTimes(2)
    expect(resourceReaders.readFastProxy).toHaveBeenCalledTimes(2)
  })

  it('多个图层复用同一 resourceRef 时只准备一份代理', async () => {
    resourceReaders.readFastProxy.mockImplementation(async (
      request: { resourceRef: typeof RESOURCE_A | typeof RESOURCE_B },
    ) => proxy(request.resourceRef))
    resourceReaders.readSourceMetadata.mockImplementation(async (
      request: { resourceRef: typeof RESOURCE_A | typeof RESOURCE_B },
    ) => metadata(request.resourceRef))
    const input = fixture()
    if (input.document.layers[1].type !== 'raster') throw new Error('测试前景层不是栅格层')
    input.document.layers[1].source = { kind: 'resource', resourceId: RESOURCE_A }
    const rendered = renderHook(() => useImageEditorRasterPasteboardV3(
      input.document,
      'composite.png',
      320,
      true,
      input.descriptors,
      createRef<HTMLDivElement>(),
    ))

    await waitFor(() => expect(rendered.result.current.entries).toHaveLength(2))
    expect(resourceReaders.readSourceMetadata).toHaveBeenCalledTimes(1)
    expect(resourceReaders.readFastProxy).toHaveBeenCalledTimes(1)
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(rendered.result.current.entries[0].sourceUrl)
      .toBe(rendered.result.current.entries[1].sourceUrl)
  })

  it('请求准入竞争只进行有界重试', async () => {
    resourceReaders.readSourceMetadata.mockImplementation(async (
      request: { resourceRef: typeof RESOURCE_A | typeof RESOURCE_B },
    ) => metadata(request.resourceRef))
    resourceReaders.readFastProxy.mockRejectedValue(
      new Error('Image editor source.fast_proxy concurrency limit reached'),
    )
    const input = fixture()
    const rendered = renderHook(() => useImageEditorRasterPasteboardV3(
      input.document,
      'composite.png',
      320,
      true,
      input.descriptors,
      createRef<HTMLDivElement>(),
    ))

    await waitFor(() => expect(resourceReaders.readFastProxy).toHaveBeenCalledTimes(4), {
      timeout: 2_500,
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(resourceReaders.readFastProxy).toHaveBeenCalledTimes(4)
    expect(rendered.result.current.entries).toHaveLength(0)
  })

  it('请求准入退避期间卸载会取消后续重试', async () => {
    resourceReaders.readSourceMetadata.mockImplementation(async (
      request: { resourceRef: typeof RESOURCE_A | typeof RESOURCE_B },
    ) => metadata(request.resourceRef))
    resourceReaders.readFastProxy.mockRejectedValue(
      new Error('Image editor source.fast_proxy concurrency limit reached'),
    )
    const input = fixture()
    const rendered = renderHook(() => useImageEditorRasterPasteboardV3(
      input.document,
      'composite.png',
      320,
      true,
      input.descriptors,
      createRef<HTMLDivElement>(),
    ))

    await waitFor(() => expect(resourceReaders.readFastProxy).toHaveBeenCalledTimes(1))
    rendered.unmount()
    await new Promise((resolve) => setTimeout(resolve, 220))
    expect(resourceReaders.readFastProxy).toHaveBeenCalledTimes(1)
  })

  it('卸载后在途代理才返回准入错误时不会继续重试', async () => {
    const consoleLog = vi.spyOn(console, 'log')
    const consoleWarn = vi.spyOn(console, 'warn')
    const proxyLoad = deferred<ReturnType<typeof proxy>>()
    resourceReaders.readSourceMetadata.mockImplementation(async (
      request: { resourceRef: typeof RESOURCE_A | typeof RESOURCE_B },
    ) => metadata(request.resourceRef))
    resourceReaders.readFastProxy.mockReturnValueOnce(proxyLoad.promise)
    const input = fixture()
    const rendered = renderHook(() => useImageEditorRasterPasteboardV3(
      input.document,
      'composite.png',
      320,
      true,
      input.descriptors,
      createRef<HTMLDivElement>(),
    ))

    await waitFor(() => expect(resourceReaders.readFastProxy).toHaveBeenCalledTimes(1))
    rendered.unmount()
    proxyLoad.reject(new Error('Image editor source.fast_proxy concurrency limit reached'))
    await new Promise((resolve) => setTimeout(resolve, 220))
    expect(resourceReaders.readFastProxy).toHaveBeenCalledTimes(1)
    const output = JSON.stringify([...consoleLog.mock.calls, ...consoleWarn.mock.calls])
    expect(output).not.toContain('image_editor_v3.raster_pasteboard.prepare.failed')
  })

  it('成功加载的每个代理在卸载时逐一撤销 object URL', async () => {
    resourceReaders.readFastProxy.mockImplementation(async (
      request: { resourceRef: typeof RESOURCE_A | typeof RESOURCE_B },
    ) => proxy(request.resourceRef))
    resourceReaders.readSourceMetadata.mockImplementation(async (
      request: { resourceRef: typeof RESOURCE_A | typeof RESOURCE_B },
    ) => metadata(request.resourceRef))
    const input = fixture()
    const rendered = renderHook(() => useImageEditorRasterPasteboardV3(
      input.document,
      'composite.png',
      320,
      true,
      input.descriptors,
      createRef<HTMLDivElement>(),
    ))

    await waitFor(() => expect(rendered.result.current.entries).toHaveLength(2))
    expect(createObjectURL).toHaveBeenCalledTimes(2)
    const createdUrls = createObjectURL.mock.results.map(({ value }) => value)
    rendered.unmount()
    expect(revokeObjectURL.mock.calls.map(([value]) => value)).toEqual(createdUrls)
  })

  it('卸载后才完成的读取不会再创建 object URL', async () => {
    const metadataLoads = [
      deferred<ReturnType<typeof metadata>>(),
      deferred<ReturnType<typeof metadata>>(),
    ]
    resourceReaders.readSourceMetadata
      .mockReturnValueOnce(metadataLoads[0].promise)
      .mockReturnValueOnce(metadataLoads[1].promise)
    const input = fixture()
    const rendered = renderHook(() => useImageEditorRasterPasteboardV3(
      input.document,
      'composite.png',
      320,
      true,
      input.descriptors,
      createRef<HTMLDivElement>(),
    ))
    await waitFor(() => expect(resourceReaders.readSourceMetadata).toHaveBeenCalledTimes(1))
    rendered.unmount()
    metadataLoads[0].resolve(metadata(RESOURCE_A))
    metadataLoads[1].resolve(metadata(RESOURCE_B))
    await Promise.resolve()
    await Promise.resolve()
    expect(resourceReaders.readFastProxy).not.toHaveBeenCalled()
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(revokeObjectURL).not.toHaveBeenCalled()
  })

  it('任一层失败会取消同批读取并撤销已经创建的 URL', async () => {
    const failedLoad = deferred<ReturnType<typeof proxy>>()
    resourceReaders.readFastProxy
      .mockResolvedValueOnce(proxy(RESOURCE_A))
      .mockReturnValueOnce(failedLoad.promise)
    resourceReaders.readSourceMetadata.mockImplementation(async (
      request: { resourceRef: typeof RESOURCE_A | typeof RESOURCE_B },
    ) => metadata(request.resourceRef))
    const input = fixture()
    const rendered = renderHook(() => useImageEditorRasterPasteboardV3(
      input.document,
      'composite.png',
      320,
      true,
      input.descriptors,
      createRef<HTMLDivElement>(),
    ))
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1))
    failedLoad.reject(new Error('代理读取失败'))
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledTimes(1))
    expect(rendered.result.current.entries).toHaveLength(0)
    const signals = resourceReaders.readFastProxy.mock.calls.map(([, signal]) => signal as AbortSignal)
    expect(signals.every((signal) => signal.aborted)).toBe(true)
  })

  it('源元数据格式不支持或未知时不会读取代理或创建 object URL', async () => {
    for (const format of ['tiff', null] as const) {
      resourceReaders.readSourceMetadata.mockReset()
      resourceReaders.readFastProxy.mockReset()
      resourceReaders.readSourceMetadata.mockImplementation(async (
        request: { resourceRef: typeof RESOURCE_A | typeof RESOURCE_B },
      ) => metadata(request.resourceRef, { format }))
      const input = fixture()
      const rendered = renderHook(() => useImageEditorRasterPasteboardV3(
        input.document,
        'composite.png',
        320,
        true,
        input.descriptors,
        createRef<HTMLDivElement>(),
      ))

      await waitFor(() => expect(resourceReaders.readSourceMetadata).toHaveBeenCalledTimes(1))
      await waitFor(() => {
        const signals = resourceReaders.readSourceMetadata.mock.calls
          .map(([, signal]) => signal as AbortSignal)
        expect(signals.every((signal) => signal.aborted)).toBe(true)
      })
      expect(resourceReaders.readFastProxy).not.toHaveBeenCalled()
      expect(createObjectURL).not.toHaveBeenCalled()
      expect(rendered.result.current.entries).toHaveLength(0)
      rendered.unmount()
    }
  })

  it('图片解码失败会立刻终止当前批次并撤销全部代理 URL', async () => {
    resourceReaders.readFastProxy.mockImplementation(async (
      request: { resourceRef: typeof RESOURCE_A | typeof RESOURCE_B },
    ) => proxy(request.resourceRef))
    resourceReaders.readSourceMetadata.mockImplementation(async (
      request: { resourceRef: typeof RESOURCE_A | typeof RESOURCE_B },
    ) => metadata(request.resourceRef))
    const input = fixture()
    const rendered = renderHook(() => useImageEditorRasterPasteboardV3(
      input.document,
      'composite.png',
      320,
      true,
      input.descriptors,
      createRef<HTMLDivElement>(),
    ))
    await waitFor(() => expect(rendered.result.current.entries).toHaveLength(2))
    act(() => rendered.result.current.markFailed())
    expect(rendered.result.current.entries).toHaveLength(0)
    expect(revokeObjectURL).toHaveBeenCalledTimes(2)
    const signals = resourceReaders.readFastProxy.mock.calls.map(([, signal]) => signal as AbortSignal)
    expect(signals.every((signal) => signal.aborted)).toBe(true)
  })

  it('隐藏普通层只收缩展示栈，不撤销或重读稳定资源批次', async () => {
    resourceReaders.readFastProxy.mockImplementation(async (
      request: { resourceRef: typeof RESOURCE_A | typeof RESOURCE_B },
    ) => proxy(request.resourceRef))
    resourceReaders.readSourceMetadata.mockImplementation(async (
      request: { resourceRef: typeof RESOURCE_A | typeof RESOURCE_B },
    ) => metadata(request.resourceRef))
    const input = fixture()
    const rendered = renderHook(
      ({ document }) => useImageEditorRasterPasteboardV3(
        document,
        'composite.png',
        320,
        true,
        input.descriptors,
        createRef<HTMLDivElement>(),
      ),
      { initialProps: { document: input.document } },
    )
    await waitFor(() => expect(rendered.result.current.entries).toHaveLength(2))
    rendered.rerender({
      document: {
        ...input.document,
        revision: input.document.revision + 1,
        layers: input.document.layers.map((layer, index) => (
          index === 0 ? { ...layer, visible: false } : layer
        )),
      },
    })
    await waitFor(() => expect(rendered.result.current.entries.map(({ layer }) => layer.id))
      .toEqual(['foreground']))
    expect(resourceReaders.readFastProxy).toHaveBeenCalledTimes(2)
    expect(resourceReaders.readSourceMetadata).toHaveBeenCalledTimes(2)
    expect(revokeObjectURL).not.toHaveBeenCalled()
  })
})
