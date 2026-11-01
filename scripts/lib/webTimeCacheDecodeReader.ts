import { ipcRenderer, sharedTexture } from 'electron'
import type { VideoFrameMeta } from '../../src/platform/contracts/videoFrameTypes'
import { sharedVideoFrame } from '../../electron/preload/video-frames-api'

let canvas: OffscreenCanvas | undefined
sharedTexture.setSharedTextureReceiver(async ({ importedSharedTexture }, meta: VideoFrameMeta) => {
  const received = performance.now()
  const frame = sharedVideoFrame(importedSharedTexture, meta.displaySize) as VideoFrame
  const ticket = meta.request?.id ?? String(meta.frameIndex)
  let drawMs = 0
  try {
    // 每帧经 Canvas2D 消费真实共享纹理；只读回几个检查点，避免把 PNG 编码算入播放吞吐。
    let png: Uint8Array | undefined
    if (!canvas || canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) canvas = new OffscreenCanvas(frame.displayWidth, frame.displayHeight)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas2D 不可用')
    const drawStarted = performance.now()
    context.drawImage(frame, 0, 0)
    if (meta.webRestore) {
      const pixels = new Uint8ClampedArray(8 * 4 * 4)
      for (let row = 0; row < 4; row++) pixels.set(meta.webRestore.slice(row * 256, row * 256 + 32), row * 32)
      context.putImageData(new ImageData(pixels, 8, 4), 0, 0)
    }
    drawMs = performance.now() - drawStarted
    if (ticket === '0' || ticket === '1' || ticket === '63' || ticket.startsWith('segment-')) {
      png = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer())
    }
    ipcRenderer.send('web-cache-probe:decoded', { ticket, streamId: meta.streamId, route: meta.route, width: frame.displayWidth, height: frame.displayHeight, timestamp: frame.timestamp, png, drawMs, receiverMs: performance.now() - received })
  } catch (error) {
    ipcRenderer.send('web-cache-probe:decoded', { ticket, error: String(error) })
  } finally {
    frame.close()
    importedSharedTexture.release()
  }
})
