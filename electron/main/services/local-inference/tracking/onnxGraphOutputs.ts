/*
 * 给 ONNX 模型补一个图输出（在内存里改，不碰磁盘上校验过的模型文件）：EfficientTAM 的掩码解码器在图内按预测 IoU
 * 从 3 个候选里挑一个，界面要让用户自己挑（点选小目标时歧义大），所以把挑选前的 4 个掩码张量作为额外输出取出来。
 *
 * 只做最小的 protobuf 改写：ModelProto 的 graph（字段 7）末尾追加一个 GraphProto.output（字段 12，ValueInfoProto），
 * 重复字段追加在末尾即合并，其余字节原样保留。onnxruntime 从内存缓冲区创建会话。
 */

function varint(value: number): number[] {
  const bytes: number[] = []
  while (value > 127) { bytes.push((value & 127) | 128); value = Math.floor(value / 128) }
  bytes.push(value)
  return bytes
}
function readVarint(bytes: Uint8Array, offset: number): [number, number] {
  let result = 0; let scale = 1; let byte: number
  do {
    if (offset >= bytes.length) throw new Error('模型文件不完整。')
    byte = bytes[offset++]; result += (byte & 127) * scale; scale *= 128
  } while (byte & 128)
  return [result, offset]
}
function concat(parts: ReadonlyArray<Uint8Array | number[]>): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const output = new Uint8Array(total); let offset = 0
  for (const part of parts) { output.set(part, offset); offset += part.length }
  return output
}
const lengthField = (field: number, payload: Uint8Array): Uint8Array => concat([varint(field * 8 + 2), varint(payload.length), payload])
const varintField = (field: number, value: number): Uint8Array => concat([varint(field * 8), varint(value)])

/** ONNX TensorProto.DataType：FLOAT = 1，FLOAT16 = 10。 */
export interface OnnxExtraOutput { name: string; elementType: 1 | 10; dims: readonly number[] }

export function addOnnxGraphOutputs(model: Uint8Array, outputs: readonly OnnxExtraOutput[]): Uint8Array {
  const kept: Uint8Array[] = []
  let graph: Uint8Array | undefined
  let offset = 0
  while (offset < model.length) {
    const start = offset
    let key: number
    ;[key, offset] = readVarint(model, offset)
    const field = Math.floor(key / 8); const wire = key & 7
    if (wire === 0) [, offset] = readVarint(model, offset)
    else if (wire === 1) offset += 8
    else if (wire === 5) offset += 4
    else if (wire === 2) {
      let length: number
      ;[length, offset] = readVarint(model, offset)
      if (field === 7) graph = model.subarray(offset, offset + length)
      offset += length
    } else throw new Error(`模型文件里有不支持的字段类型 ${wire}。`)
    if (offset > model.length) throw new Error('模型文件不完整。')
    if (field !== 7) kept.push(model.subarray(start, offset))
  }
  if (!graph) throw new Error('模型文件里没有计算图。')
  const encoded = outputs.map(entry => {
    const shape = concat(entry.dims.map(dim => lengthField(1, varintField(1, dim))))
    const tensor = concat([varintField(1, entry.elementType), lengthField(2, shape)])
    return lengthField(12, concat([lengthField(1, new TextEncoder().encode(entry.name)), lengthField(2, lengthField(1, tensor))]))
  })
  return concat([...kept, lengthField(7, concat([graph, ...encoded]))])
}
