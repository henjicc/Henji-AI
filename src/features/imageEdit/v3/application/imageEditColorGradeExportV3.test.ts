// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getPlatform } from '@/platform/runtime'
import { createImageEditAdjustmentLayerV3, createImageEditDocumentV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { registerPersistedImageEditTestSession } from '@/tests/imageEditPersistenceTestSession'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { buildColorGradeExport, ColorGradeExportRejection } from '@/core/imaging/lut/colorGradeExport'
import { parseCubeLut } from '@/core/imaging/lut/cube'
import type { ColorGradeExportWorkerRequest } from '@/core/imaging/lut/colorGradeExport.worker'
import { ImageEditCommandBusV3 } from './imageEditCommandBus'
import { imageEditV3DocumentRef, imageEditV3FilterRef, imageEditV3LayerRef } from './imageEditDocumentRefs'
import { findImageEditColorGradeV3 } from './imageEditColorGradeExportV3'
import { readImageEditColorReferencePixelsV3 } from './imageEditColorReferenceV3'

class InlineWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((event: { message: string }) => void) | null = null
  postMessage(request: ColorGradeExportWorkerRequest): void {
    queueMicrotask(() => {
      try { this.onmessage?.({ data: { build: buildColorGradeExport({ ...request, luts: new Map(request.luts) }) } }) }
      catch (error) { this.onmessage?.({ data: { error: error instanceof Error ? error.message : String(error), rejected: error instanceof ColorGradeExportRejection } }) }
    })
  }
  terminate(): void {}
}
const files = new Map<string, string>()
const disposers: Array<() => void> = []
beforeEach(() => {
  installHarnessNativeStorage(); files.clear()
  vi.stubGlobal('Worker', InlineWorker)
  const fs = getPlatform().system.fs
  vi.spyOn(fs, 'exists').mockImplementation(async path => files.has(path))
  vi.spyOn(fs, 'writeTextFile').mockImplementation(async (path, text) => { files.set(path, text) })
  vi.spyOn(fs, 'readTextFile').mockImplementation(async path => files.get(path) ?? '')
})
afterEach(() => { disposers.splice(0).forEach(dispose => dispose()); vi.restoreAllMocks(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage() })

function setup(id: string) {
  const document = createImageEditDocumentV3({ width: 16, height: 16, documentId: id })
  const grade = createImageEditAdjustmentLayerV3('grade', '暖调', 'color_grade', { exposure: 1, vignette_amount: -30 })
  grade.opacity = .5
  const content = createImageEditRasterLayerV3('content', '内容')
  content.filters = [{ id: 'grade-filter', operationType: 'adjustment', effectId: 'color_grade', params: { saturation: -100 }, enabled: true, opacity: 1, blendMode: 'normal', mask: null }]
  document.layers = [content, grade]
  const bus = new ImageEditCommandBusV3(document)
  disposers.push(registerPersistedImageEditTestSession(`${id}-session`, bus))
  return { document, bus }
}

it('调色层与同 id 的调色滤镜都能定位；其他图层拒绝', () => {
  const { document } = setup('grade-locate')
  expect(findImageEditColorGradeV3(document, 'grade')).toMatchObject({ name: '暖调', opacity: .5 })
  expect(findImageEditColorGradeV3(document, 'grade-filter').params).toEqual({ saturation: -100 })
  expect(() => findImageEditColorGradeV3(document, 'content')).toThrow(ColorGradeExportRejection)
})

it('公共能力导出图片调色层：读回核对，列出不进文件的不透明度与晕影，不改图片', async () => {
  const { document, bus } = setup('grade-export')
  const app = createApplicationHarness()
  try {
    const layerRef = imageEditV3LayerRef(document.id, 'grade')
    const result = await app.requireResult('export_image_edit_color_lut', { layerRef, format: 'cube', lutSize: 17, path: 'D:/out/warm.cube' })
    expect(result).toMatchObject({ resultRef: layerRef, format: 'cube', lutSize: 17, verification: { verified: true } })
    expect(result.omitted).toEqual(['晕影', '不透明度 50%（文件按 100% 写入）'])
    const lut = parseCubeLut(files.get('D:/out/warm.cube')!)
    expect(lut.title).toBe('暖调'); expect(lut.data[((8 * 17 + 8) * 17 + 8) * 4]).toBeGreaterThan(.65) // +1 EV
    expect(bus.getSnapshot().document).toBe(document)
    const filter = await app.requireResult('export_image_edit_color_lut', { layerRef: imageEditV3FilterRef(document.id, 'content', 'grade-filter'), format: 'cdl', path: 'D:/out/mono.cdl' })
    expect((filter.cdl as { saturation: number }).saturation).toBeLessThan(.05)
    expect((await app.call('export_image_edit_color_lut', { layerRef: imageEditV3LayerRef(document.id, 'content'), format: 'cube', path: 'D:/out/x.cube' })).ok).toBe(false)
    expect(files.has('D:/out/x.cube')).toBe(false)
  } finally { app.dispose() }
})

it('参考可以是另一份图片文档：按它当前的合成结果读取像素', async () => {
  const { document } = setup('grade-reference')
  const pixels = Uint8ClampedArray.from([10, 20, 30, 255])
  const reader = vi.fn(async () => ({ pixels, width: 1, height: 1 }))
  await expect(readImageEditColorReferencePixelsV3({ kind: 'ref', ref: imageEditV3DocumentRef(document.id) }, new AbortController().signal, reader)).resolves.toBe(pixels)
  expect((reader.mock.calls[0] as unknown[])[0]).toBe(document)
  await expect(readImageEditColorReferencePixelsV3({ kind: 'ref', ref: { kind: 'video_edit.clip', id: 'x' } }, new AbortController().signal, reader)).rejects.toThrow('参考引用只接受')
})
