import { afterEach, describe, expect, it, vi } from 'vitest'
import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory'
import { ImageEditorVectorRasterClientV3, type VectorRasterRequestV3, type VectorRasterResponseV3 } from './vectorRasterClientV3'

const prepareFonts = vi.hoisted(() => vi.fn(async () => []))
vi.mock('@/services/vectorContent/fonts', () => ({ prepareVectorDocumentFonts: prepareFonts }))
class RasterWorker {
  static instances: RasterWorker[] = []
  onmessage?: (event: MessageEvent<VectorRasterResponseV3>) => void
  onerror?: (event: ErrorEvent) => void
  messages: VectorRasterRequestV3[] = []
  terminate = vi.fn()
  constructor() { RasterWorker.instances.push(this) }
  postMessage(request: VectorRasterRequestV3): void { this.messages.push(request) }
  reply(response: VectorRasterResponseV3): void { this.onmessage?.({ data: response } as MessageEvent<VectorRasterResponseV3>) }
}
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); RasterWorker.instances = [] })
function fixture() {
  vi.stubGlobal('Worker', RasterWorker)
  vi.stubGlobal('ImageData', class { constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {} })
  const client = new ImageEditorVectorRasterClientV3(), document = createImageEditDocumentV3({ width: 4, height: 4 })
  const request = (signal = new AbortController().signal) => client.rasterize({ parameters: { type: 'shape' } }, document, { x: 0, y: 0, width: 1, height: 1 }, 2, signal)
  return { client, request }
}
describe('后台矢量栅格化生命周期', () => {
  it('预热只启动 Worker，不请求字体或栅格瓦片，并复用到首次请求', async () => {
    const { client, request } = fixture()
    client.warm(); client.warm()
    expect(RasterWorker.instances).toHaveLength(1)
    expect(prepareFonts).not.toHaveBeenCalled()
    const pending = request()
    const worker = RasterWorker.instances[0]
    await vi.waitFor(() => expect(worker.messages).toHaveLength(1))
    worker.reply({ id: worker.messages[0].id, width: 1, height: 1, pixels: new ArrayBuffer(4) })
    await pending; client.dispose()
    expect(worker.terminate).toHaveBeenCalledOnce()
  })
  it('同文档字体只准备一次、同 Worker 只传一次，像素正确交回', async () => {
    const { client, request } = fixture(), first = request()
    await vi.waitFor(() => expect(RasterWorker.instances[0]?.messages).toHaveLength(1))
    const worker = RasterWorker.instances[0]
    worker.reply({ id: worker.messages[0].id, width: 1, height: 1, pixels: new Uint8ClampedArray([2,3,4,255]).buffer })
    expect((await first).data).toEqual(new Uint8ClampedArray([2,3,4,255]))
    const second = request(); await vi.waitFor(() => expect(worker.messages).toHaveLength(2))
    expect(worker.messages[0].fonts).toEqual([]); expect(worker.messages[1].fonts).toBeUndefined()
    worker.reply({ id: worker.messages[1].id, width: 1, height: 1, pixels: new ArrayBuffer(4) })
    await second; expect(prepareFonts).toHaveBeenCalledTimes(1); client.dispose()
  })
  it('取消最后一个过期请求会终止计算，重建后重新传字体，迟到回复不污染新请求', async () => {
    const { client, request } = fixture(), abort = new AbortController(), first = request(abort.signal)
    const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(RasterWorker.instances[0]?.messages).toHaveLength(1))
    const old = RasterWorker.instances[0]; abort.abort(); await rejected; expect(old.terminate).toHaveBeenCalledOnce()
    const second = request(); await vi.waitFor(() => expect(RasterWorker.instances[1]?.messages).toHaveLength(1))
    const current = RasterWorker.instances[1]
    old.reply({ id: old.messages[0].id, width: 1, height: 1, pixels: new ArrayBuffer(4) })
    expect(current.messages[0].fonts).toEqual([])
    current.reply({ id: current.messages[0].id, width: 1, height: 1, pixels: new ArrayBuffer(4) })
    await second; client.dispose()
    await expect(request()).rejects.toThrow('已关闭')
  })
  it('字体加载失败可重试，销毁会拒绝全部待处理请求', async () => {
    const { client, request } = fixture(), first = request()
    const rejected = expect(first).rejects.toThrow('字体失败')
    await vi.waitFor(() => expect(RasterWorker.instances[0]?.messages).toHaveLength(1))
    const worker = RasterWorker.instances[0]
    worker.reply({ id: worker.messages[0].id, error: '字体失败' }); await rejected
    const second = request(), disposed = expect(second).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(worker.messages).toHaveLength(2))
    expect(worker.messages[1].fonts).toEqual([]); client.dispose(); await disposed
  })
})
