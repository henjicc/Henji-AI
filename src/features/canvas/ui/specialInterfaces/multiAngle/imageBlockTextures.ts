import type { ImageBlockFace } from './multiAngleOrbitGeometry'

type TextureFace = Exclude<ImageBlockFace, 'front'>
export type ImageBlockTextures = Record<TextureFace, string>
const FACES: TextureFace[] = ['left', 'right', 'top', 'bottom', 'back']
const SIZE = 64
const PADDING = 8

/** Extend side borders; the rear uses the complete image mirrored horizontally. */
export function edgeTexturePixels(source: Uint8ClampedArray, width: number, height: number, face: TextureFace, size = SIZE): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const sx = Math.round(x / (size - 1) * (width - 1))
    const sy = Math.round(y / (size - 1) * (height - 1))
    const samples = [face === 'back' ? [width - 1 - sx, sy, 1]
      : face === 'left' ? [0, sy, 1] : face === 'right' ? [width - 1, sy, 1]
        : face === 'top' ? [sx, 0, 1] : [sx, height - 1, 1]]
    const total = samples.reduce((sum, sample) => sum + sample[2], 0)
    // Blend premultiplied colour so transparent borders cannot introduce dark fringes.
    const alpha = samples.reduce((sum, [px, py, weight]) => sum + source[(py * width + px) * 4 + 3] * weight, 0)
    const offset = (y * size + x) * 4
    for (let channel = 0; channel < 3; channel++) pixels[offset + channel] = alpha > 0
      ? samples.reduce((sum, [px, py, weight]) => {
        const i = (py * width + px) * 4
        return sum + source[i + channel] * source[i + 3] * weight
      }, 0) / alpha : 0
    pixels[offset + 3] = alpha / total
  }
  return pixels
}

/** Tiny content fingerprint input, also reused by the baker. The front image is already decoded. */
export function sampleImageBlock(image: HTMLImageElement): Uint8ClampedArray {
  const sample = document.createElement('canvas')
  sample.width = sample.height = SIZE
  try {
    const read = sample.getContext('2d', { willReadFrequently: true })
    if (!read) throw new Error('无法读取图片块颜色')
    read.drawImage(image, 0, 0, SIZE, SIZE)
    return read.getImageData(0, 0, SIZE, SIZE).data
  } finally { sample.width = sample.height = 0 }
}

/** Bounded baking: five 64px PNGs, no live SVG/CSS blur. */
export function bakeImageBlockTextures(image: HTMLImageElement, source = sampleImageBlock(image)): ImageBlockTextures {
  const padded = document.createElement('canvas')
  const output = document.createElement('canvas')
  padded.width = padded.height = SIZE + PADDING * 2
  output.width = output.height = SIZE
  const staging = padded.getContext('2d')
  const target = output.getContext('2d')
  try {
    if (!staging || !target) throw new Error('无法创建图片块边缘贴图画布')
    const textures = {} as ImageBlockTextures
    for (const face of FACES) {
      const pixels = edgeTexturePixels(source, SIZE, SIZE, face)
      const buffer = staging.createImageData(padded.width, padded.height)
      for (let y = 0; y < padded.height; y++) for (let x = 0; x < padded.width; x++) {
        const sx = Math.min(SIZE - 1, Math.max(0, x - PADDING))
        const sy = Math.min(SIZE - 1, Math.max(0, y - PADDING))
        const from = (sy * SIZE + sx) * 4; const to = (y * padded.width + x) * 4
        buffer.data.set(pixels.subarray(from, from + 4), to)
      }
      staging.putImageData(buffer, 0, 0)
      target.clearRect(0, 0, SIZE, SIZE)
      target.filter = 'blur(2px)'
      target.drawImage(padded, -PADDING, -PADDING)
      textures[face] = output.toDataURL('image/png')
    }
    return textures
  } finally {
    for (const canvas of [padded, output]) { canvas.width = 0; canvas.height = 0 }
  }
}
