import os from 'node:os'
import { decodeTransferFunctionV3, encodeTransferFunctionV3, linearWorkingSpaceMatrixV3 } from '../../../../src/core/imaging/colorManagement/rgb'

export interface SourceRgbConversionRequest {
  type: 'source-rgb.convert'
  bytes: Uint8Array
  space: 'srgb' | 'display-p3'
  bitDepth: 8 | 16 | 32
}

/** Worker 内使用共享 D65 数学，保留 scRGB 的负值、超白与直通 Alpha。 */
export function decodeStandardRgb(bytes: Uint8Array, space: 'srgb' | 'display-p3', bitDepth: 8 | 16 | 32): Buffer {
  const raw = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (raw.length % 8 !== 0) throw new Error('图片像素缓冲长度无效')
  if (os.endianness() !== 'LE') raw.swap16()
  const matrix = linearWorkingSpaceMatrixV3(space, 'srgb')
  const bytesPerSample = bitDepth / 8
  const output = Buffer.allocUnsafeSlow(raw.length / 2 * bytesPerSample)
  const write = (value: number, index: number): void => {
    if (bitDepth === 32) output.writeFloatLE(value, index * bytesPerSample)
    else {
      const maximum = bitDepth === 8 ? 255 : 65535
      const integer = Math.round(Math.min(1, Math.max(0, value)) * maximum)
      if (bitDepth === 8) output.writeUInt8(integer, index)
      else output.writeUInt16LE(integer, index * 2)
    }
  }
  for (let offset = 0; offset < raw.length; offset += 8) {
    const r = decodeTransferFunctionV3(raw.readUInt16LE(offset) / 65535, 'srgb')
    const g = decodeTransferFunctionV3(raw.readUInt16LE(offset + 2) / 65535, 'srgb')
    const b = decodeTransferFunctionV3(raw.readUInt16LE(offset + 4) / 65535, 'srgb')
    for (let channel = 0; channel < 3; channel++) {
      const linear = matrix[channel * 3] * r + matrix[channel * 3 + 1] * g + matrix[channel * 3 + 2] * b
      write(bitDepth === 32 ? linear : encodeTransferFunctionV3(linear, 'srgb'), offset / 2 + channel)
    }
    write(raw.readUInt16LE(offset + 6) / 65535, offset / 2 + 3)
  }
  return output
}
