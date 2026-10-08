import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { compileCodeMaterial } from '@/core/videoEdit/codeMaterial/compiler'
import { BUILTIN_STYLE_KITS } from '@/core/videoEdit/styleKitPresets'
import { renderStyleKitPreview } from './videoEditStylePreview'
import { trialVideoEditCodeFrames } from './videoEditCodeTrial'
import { VIDEO_EDIT_PREVIEW_TIMEOUT_MS } from './videoEditPreviewTask'

const logs = vi.hoisted(() => ({ debug: vi.fn(), warn: vi.fn() }))
vi.mock('@/core/logging', () => ({ createLogger: () => logs }))
vi.mock('./videoEditCodeState', () => ({ compileVideoEditCode: async (source: string) => compileCodeMaterial(source) }))
vi.mock('./videoEditCodeTrial', () => ({ trialVideoEditCodeFrames: vi.fn() }))
const close = vi.fn(); const encode = vi.fn(async () => new Blob(['preview']))
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(trialVideoEditCodeFrames).mockResolvedValue({ width: 960, height: 540, close } as unknown as ImageBitmap)
  vi.stubGlobal('OffscreenCanvas', class {
    constructor(public width: number, public height: number) {}
    getContext() { return { drawImage: vi.fn() } }
    convertToBlob = encode
  })
  encode.mockResolvedValue(new Blob(['preview']))
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
it('科技信息预设按预览尺寸使用正式试渲染，转换前释放bitmap，记录开始与完成', async () => {
  const kit = BUILTIN_STYLE_KITS[1]
  const blob = await renderStyleKitPreview(kit, kit.samples[0].id, { width: 960, height: 540 }, new AbortController().signal)
  expect(blob).toBeInstanceOf(Blob)
  const document = vi.mocked(trialVideoEditCodeFrames).mock.calls[0][0][0].document
  expect(document).toMatchObject({ width: 960, height: 540 })
  expect(compileCodeMaterial(document.codeMaterials![0].versions[0].source)).toMatchObject({ width: 960, height: 540 })
  expect(close).toHaveBeenCalledOnce()
  expect(logs.debug.mock.calls.map(call => call[1].event)).toEqual(['style_kit.preview.start', 'style_kit.preview.completed'])
})
it.each(['render', 'encode'])('%s永不返回时显示可恢复失败，日志覆盖失败；下一次可重新出画', async stage => {
  vi.useFakeTimers()
  if (stage === 'render') vi.mocked(trialVideoEditCodeFrames).mockImplementationOnce(() => new Promise(() => undefined))
  else encode.mockImplementationOnce(() => new Promise(() => undefined))
  const kit = BUILTIN_STYLE_KITS[1]; const signal = new AbortController().signal
  const result = renderStyleKitPreview(kit, 'title', { width: 960, height: 540 }, signal)
  const assertion = expect(result).rejects.toThrow('等待过久')
  await vi.advanceTimersByTimeAsync(VIDEO_EDIT_PREVIEW_TIMEOUT_MS); await assertion
  expect(logs.warn).toHaveBeenCalledWith('风格预览未完成', expect.objectContaining({ event: 'style_kit.preview.failed' }))
  if (stage === 'encode') expect(close).toHaveBeenCalledOnce()
  await expect(renderStyleKitPreview(kit, 'title', { width: 960, height: 540 }, signal)).resolves.toBeInstanceOf(Blob)
})
it('中止后及时返回，迟到bitmap被释放，下一次请求成功', async () => {
  let finish!: (bitmap: ImageBitmap) => void
  vi.mocked(trialVideoEditCodeFrames).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const kit = BUILTIN_STYLE_KITS[1]; const controller = new AbortController()
  const result = renderStyleKitPreview(kit, 'title', { width: 960, height: 540 }, controller.signal)
  const assertion = expect(result).rejects.toThrow()
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  controller.abort(); await assertion
  finish({ width: 960, height: 540, close } as unknown as ImageBitmap)
  await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())
  await expect(renderStyleKitPreview(kit, 'title', { width: 960, height: 540 }, new AbortController().signal)).resolves.toBeInstanceOf(Blob)
})
