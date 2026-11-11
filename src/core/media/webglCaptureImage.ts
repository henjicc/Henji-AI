/** WebGL readPixels 从左下角开始；Canvas ImageData 从左上角开始。 */
export function flipWebglRgbaRows(
  pixels: Uint8Array,
  width: number,
  height: number,
): Uint8ClampedArray<ArrayBuffer> {
  const rowBytes = width * 4
  if (pixels.byteLength !== rowBytes * height) {
    throw new Error('WebGL 捕获像素长度与目标尺寸不一致')
  }
  const flipped = new Uint8ClampedArray(pixels.byteLength)
  for (let row = 0; row < height; row += 1) {
    const sourceOffset = (height - row - 1) * rowBytes
    flipped.set(pixels.subarray(sourceOffset, sourceOffset + rowBytes), row * rowBytes)
  }
  return flipped
}

export function webglRgbaToPngDataUrl(
  pixels: Uint8Array,
  width: number,
  height: number,
): string {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('WebGL 捕获编码画布初始化失败')
  const imageData = context.createImageData(width, height)
  imageData.data.set(flipWebglRgbaRows(pixels, width, height))
  context.putImageData(imageData, 0, 0)
  return canvas.toDataURL('image/png')
}

/**
 * 异步编码：像素拷进离屏画布后由浏览器在后台编码，不像 toDataURL 那样在主线程同步压缩整张图。
 * 交互中频繁取的预览帧用这条路，避免每次拖完视角整个界面停顿几十毫秒。
 */
export async function webglRgbaToDataUrlAsync(
  pixels: Uint8Array,
  width: number,
  height: number,
  type: 'image/png' | 'image/webp' = 'image/png',
  quality?: number,
): Promise<string> {
  const imageData = new ImageData(flipWebglRgbaRows(pixels, width, height), width, height)
  let blob: Blob
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('WebGL 捕获编码画布初始化失败')
    context.putImageData(imageData, 0, 0)
    blob = await canvas.convertToBlob({ type, quality })
  } else {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('WebGL 捕获编码画布初始化失败')
    context.putImageData(imageData, 0, 0)
    blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error('WebGL 捕获编码失败'))),
      type,
      quality,
    ))
  }
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('WebGL 捕获编码失败'))
    reader.readAsDataURL(blob)
  })
}
