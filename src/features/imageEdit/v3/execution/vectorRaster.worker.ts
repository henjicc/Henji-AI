/// <reference lib="webworker" />
import { rasterizeVectorContent } from '@/services/vectorContent/raster'
import { loadVectorFonts } from '@/services/vectorContent/fonts'
import type { VectorRasterRequestV3, VectorRasterResponseV3 } from './vectorRasterClientV3'
const scope = self as DedicatedWorkerGlobalScope
// 模块预热时触发默认文字样式的拉丁/CJK 系统回退字体解析，
// 后续实际文字仍按请求提供的正式字体和共享栅格器绘制。
const warmCanvas = new OffscreenCanvas(64, 24)
const warmContext = warmCanvas.getContext('2d')
if (warmContext) { warmContext.font = '16px sans-serif'; warmContext.fillText('Aa 中文', 0, 18); warmContext.getImageData(0, 0, 64, 24) }
warmCanvas.width = 0
let queue = Promise.resolve()
scope.onmessage = (event: MessageEvent<VectorRasterRequestV3>): void => {
  const request = event.data
  queue = queue.then(async () => {
    try {
      if (request.fonts) await loadVectorFonts(request.fonts)
      const image = rasterizeVectorContent(request.value, { ...request.region, scale: 1 / 2 ** request.mip }, {
        sourceVersion: String(request.revision), time: { kind: 'static' }, referenceGrid: request.geometry, quality: 'interactive',
      })
      const response: VectorRasterResponseV3 = { id: request.id, width: image.width, height: image.height, pixels: image.data.buffer }
      scope.postMessage(response, [image.data.buffer])
    } catch (error) { scope.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) } satisfies VectorRasterResponseV3) }
  })
}
