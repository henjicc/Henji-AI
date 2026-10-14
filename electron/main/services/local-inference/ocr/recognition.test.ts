import { expect, it } from 'vitest'
import { recognitionInput, decodeRecognition } from './recognition'
import { readOnnxCharacterMetadata } from '../tracking/onnxGraphOutputs'
it('BGR归一化、48高、按比例填充与CTC重复/blank折叠', async () => {
  const rgb = Uint8Array.of(255, 0, 0, 0, 255, 0)
  const input = await recognitionInput(rgb, 2, 1, [0, 0, 1, 1])
  expect(input.width).toBe(320); expect(input.data[0]).toBe(-1); expect(input.data[320 * 48 * 2]).toBe(1); expect(input.data[100]).toBe(0)
  const ids = [1, 1, 0, 1, 2, 2, 0], data = new Float32Array(ids.length * 4)
  ids.forEach((id, i) => { data[i * 4 + id] = .99 })
  expect(decodeRecognition({ data, dims: [1, ids.length, 4] }, ['a', 'b'])).toMatchObject({ text: 'aab', confidence: expect.closeTo(.99) })
  expect(() => decodeRecognition({ data, dims: [1, ids.length, 5] }, ['a', 'b'])).toThrow('字典')
})
it('从官方ONNX内置metadata读取字典，缺字典不静默猜测', () => {
  const key = new TextEncoder().encode('character'), value = new TextEncoder().encode('a\n中')
  const pair = Uint8Array.from([10, key.length, ...key, 18, value.length, ...value])
  const model = Uint8Array.from([114, pair.length, ...pair])
  expect(readOnnxCharacterMetadata(model)).toEqual(['a', '中']); expect(() => readOnnxCharacterMetadata(Uint8Array.of(8, 1))).toThrow('字典')
})
