import { deflateSync } from 'node:zlib'

export function createGigapixelTiff(): Buffer {
  const side = 32768
  const tileSide = 256
  const tileCount = (side / tileSide) ** 2
  const compressed = deflateSync(Buffer.alloc(tileSide ** 2, 80))
  const tags = [
    [256, 4, 1, side], [257, 4, 1, side], [258, 3, 1, 8], [259, 3, 1, 8],
    [262, 3, 1, 1], [277, 3, 1, 1], [284, 3, 1, 1],
    [322, 4, 1, tileSide], [323, 4, 1, tileSide],
    [324, 4, tileCount, 0], [325, 4, tileCount, 0],
  ]
  const offsetsStart = 8 + 2 + tags.length * 12 + 4
  const countsStart = offsetsStart + tileCount * 4
  const pixelsStart = countsStart + tileCount * 4
  tags[9][3] = offsetsStart
  tags[10][3] = countsStart
  const tiff = Buffer.alloc(pixelsStart + compressed.length)
  tiff.write('II'); tiff.writeUInt16LE(42, 2); tiff.writeUInt32LE(8, 4)
  tiff.writeUInt16LE(tags.length, 8)
  tags.forEach(([tag, type, count, value], index) => {
    const offset = 10 + index * 12
    tiff.writeUInt16LE(tag, offset); tiff.writeUInt16LE(type, offset + 2)
    tiff.writeUInt32LE(count, offset + 4); tiff.writeUInt32LE(value, offset + 8)
  })
  // 各瓦片共享同一压缩块，验证真实大尺寸而不分配整幅像素。
  for (let index = 0; index < tileCount; index++) {
    tiff.writeUInt32LE(pixelsStart, offsetsStart + index * 4)
    tiff.writeUInt32LE(compressed.length, countsStart + index * 4)
  }
  compressed.copy(tiff, pixelsStart)
  return tiff
}
