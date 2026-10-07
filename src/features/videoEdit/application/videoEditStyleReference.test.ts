// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createVideoEditTestProject, closeAllVideoEdits } from './videoEditDocumentTestKit'
import { appendVideoEditMedia, editVideoProject } from './videoEditService'
import { extractVideoEditReferenceStyle } from './videoEditStyleReference'
import { extractStylePalettePixels } from '@/core/videoEdit/styleKitExtraction'
import { BUILTIN_STYLE_KITS } from '@/core/videoEdit/styleKitPresets'
import { getPlatform } from '@/platform/runtime'
import { handleVideoEditStyleKitCapability } from './videoEditStyleKitCapabilities'
const pixels = new Uint8ClampedArray([10, 20, 30, 255, 10, 20, 30, 255, 230, 210, 80, 255])
const close = vi.fn(); const terminate = vi.fn(); const dimensions: number[][] = []
beforeEach(() => {
  installHarnessNativeStorage(); close.mockClear(); terminate.mockClear(); dimensions.length = 0
  vi.spyOn(getPlatform().media, 'readLocalFileAsBlob').mockResolvedValue(new Blob(['image']))
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 4000, height: 2000, close })))
  vi.stubGlobal('OffscreenCanvas', class { constructor(width: number, height: number) { dimensions.push([width, height]) } getContext() { return { drawImage() {}, getImageData: () => ({ data: pixels.slice() }) } } })
  vi.stubGlobal('Worker', class { onmessage?: (event: { data: unknown }) => void; onerror?: () => void; postMessage(input: { pixels: Uint8ClampedArray }) { queueMicrotask(() => this.onmessage?.({ data: { clusters: extractStylePalettePixels(input.pixels) } })) } terminate() { terminate() } })
})
afterEach(async () => { await closeAllVideoEdits(); vi.restoreAllMocks(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage() })
it('正式媒体引用经PAL缩采样/Worker生成候选，释放资源，不写工程，不输入URL', async () => {
  const owner = await createVideoEditTestProject(); const id = owner.document.id
  appendVideoEditMedia(id, { id: 'image', name: '参考', path: 'D:/reference.png', kind: 'image', width: 4000, height: 2000, durationSeconds: 5 })
  editVideoProject(id, document => ({ ...document, items: [...document.items, { id: 'item', name: '参考', kind: 'image', mediaId: 'image' }] }))
  const baseline = owner.document
  const candidate = await extractVideoEditReferenceStyle({ kind: 'item', projectId: id, itemId: 'item', timeUs: 0 }, BUILTIN_STYLE_KITS[0], '参考候选')
  expect(candidate.tokens.palette.bg).toEqual([10 / 255, 20 / 255, 30 / 255, 1]); expect(dimensions).toEqual([[128, 64]])
  expect(owner.document).toBe(baseline); expect(close).toHaveBeenCalledTimes(1); expect(terminate).toHaveBeenCalledTimes(1)
  await expect(extractVideoEditReferenceStyle({ kind: 'item', projectId: id, itemId: 'item', timeUs: 0 }, BUILTIN_STYLE_KITS[0], '取消', AbortSignal.abort())).rejects.toThrow()
  expect(owner.document).toBe(baseline)
})
it('资产参考由宿主授权判断；取消/无效引用明确拒绝', async () => {
  const owner = await createVideoEditTestProject(); const id = owner.document.id
  await expect(handleVideoEditStyleKitCapability('extract_video_edit_reference_style', { documentRef: { kind: 'video_edit.document', id }, sequenceRef: { kind: 'video_edit.sequence', id: `${id}:${owner.activeSequenceId}` }, reference: { kind: 'asset', assetRef: { kind: 'asset', id: 'asset' } } }, { signal: new AbortController().signal })).rejects.toThrow('assets:read')
  await expect(extractVideoEditReferenceStyle({ kind: 'item', projectId: id, itemId: 'missing', timeUs: 0 }, BUILTIN_STYLE_KITS[0], '无效')).rejects.toThrow('请选择')
})
