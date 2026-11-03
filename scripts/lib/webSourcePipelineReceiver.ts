import { ipcRenderer, sharedTexture } from 'electron'
import type { VideoFrameMeta } from '../../src/platform/contracts/videoFrameTypes'

sharedTexture.setSharedTextureReceiver(async ({ importedSharedTexture }, meta: VideoFrameMeta & { snapshot?: boolean }) => {
  const frame = importedSharedTexture.getVideoFrame() as VideoFrame
  try {
    const sample = new OffscreenCanvas(16, 1), context = sample.getContext('2d')!
    context.drawImage(frame, 16, 0, 16, 1, 0, 0, 16, 1)
    const pixels = context.getImageData(0, 0, 16, 1).data
    let code = 0
    for (let i = 0; i < 16; i++) if (pixels[i * 4] > 128) code |= 1 << i
    let png: Uint8Array | undefined
    if (meta.snapshot) {
      const canvas = new OffscreenCanvas(meta.displaySize!.width, meta.displaySize!.height), image = canvas.getContext('2d')!
      image.drawImage(frame, 0, 0)
      if (meta.webRestore) {
        const restore = new Uint8ClampedArray(8 * 4 * 4)
        for (let y = 0; y < 4; y++) restore.set(meta.webRestore.slice(y * 256, y * 256 + 32), y * 32)
        image.putImageData(new ImageData(restore, 8, 4), 0, 0)
      }
      png = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer())
    }
    ipcRenderer.send('web-source-pipeline:received', { ticket: meta.request!.id, code, png })
  } finally { frame.close(); importedSharedTexture.release() }
})
