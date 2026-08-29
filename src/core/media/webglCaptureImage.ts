/** WebGL readPixels 从左下角开始；Canvas ImageData 从左上角开始。 */
export function flipWebglRgbaRows(
  pixels: Uint8Array,
  width: number,
  height: number,
): Uint8ClampedArray {
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
