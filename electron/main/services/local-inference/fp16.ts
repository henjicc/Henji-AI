/*
 * 半精度浮点（RVM fp16 模型的输入输出）。onnxruntime-node 的 float16 张量以 Uint16Array 存放位模式
 * （推理进程里移除了全局 Float16Array，见 local-inference-utility.ts）。
 */

/** 单精度 → 半精度位模式（就近舍入，溢出为无穷）。 */
export function float16Bits(value: number): number {
  const buffer = new DataView(new ArrayBuffer(4))
  buffer.setFloat32(0, value)
  const bits = buffer.getUint32(0)
  const sign = (bits >>> 16) & 0x8000
  const exponent = (bits >>> 23) & 0xff
  let mantissa = bits & 0x7fffff
  if (exponent === 0xff) return sign | 0x7c00 | (mantissa ? 0x200 : 0)
  const half = exponent - 127 + 15
  if (half >= 0x1f) return sign | 0x7c00
  if (half <= 0) {
    if (half < -10) return sign
    mantissa |= 0x800000
    const shift = 14 - half
    let result = mantissa >> shift
    if ((mantissa >> (shift - 1)) & 1) result += 1
    return sign | result
  }
  let result = sign | (half << 10) | (mantissa >> 13)
  if (mantissa & 0x1000) result += 1
  return result
}

/** 半精度位模式 → 数值。 */
export function float16Value(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1
  const exponent = (bits >>> 10) & 0x1f
  const mantissa = bits & 0x3ff
  if (exponent === 0) return sign * mantissa * 2 ** -24
  if (exponent === 0x1f) return mantissa ? Number.NaN : sign * Infinity
  return sign * (1 + mantissa / 1024) * 2 ** (exponent - 15)
}

let unormToHalf: Uint16Array | undefined
/** 0–255 字节 → 半精度的 value/255（输入预处理查表）。 */
export function unorm8ToFloat16Table(): Uint16Array {
  if (!unormToHalf) {
    unormToHalf = new Uint16Array(256)
    for (let index = 0; index < 256; index++) unormToHalf[index] = float16Bits(index / 255)
  }
  return unormToHalf
}

let halfToUnorm: Uint8Array | undefined
/** 半精度 0–1 → 0–255 字节（越界夹取，输出后处理查表）。 */
export function float16ToUnorm8Table(): Uint8Array {
  if (!halfToUnorm) {
    halfToUnorm = new Uint8Array(65536)
    for (let bits = 0; bits < 65536; bits++) {
      const value = float16Value(bits)
      halfToUnorm[bits] = Number.isNaN(value) ? 0 : Math.max(0, Math.min(255, Math.round(value * 255)))
    }
  }
  return halfToUnorm
}
