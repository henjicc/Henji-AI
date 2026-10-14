import { expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { recognitionCrop, recognitionBatchInput, recognitionBatches, decodeRecognitionBatch, readRecognitionDictionary } from './recognition'
it('融合竖向插值与归一化保持全部像素位级一致，覆盖放大、缩小和非零裁片偏移', () => {
  const rgb = Uint8Array.from({ length: 176 * 144 * 3 }, (_, i) => (i * 73 + (i >> 6)) % 256)
  const crops = [{ x: 3, y: 5, width: 141, height: 100, tensorWidth: 68 }, { x: 20, y: 2, width: 25, height: 30, tensorWidth: 40 }]
  // Frozen full tensor hashes from the pre-fusion scale-aware filter, including padding and channel order.
  const expected = { 'rgb-half': '3d8d9becf336e6223208234f2ca8179ba9299925b29c350241e6afe0e26603a2', 'bgr-unit': '16c2155f682c24dece4fee9961c474bbcf800b379070462931ce24aacd57a200' }
  for (const mode of ['rgb-half', 'bgr-unit'] as const) {
    const input = recognitionBatchInput(rgb, 176, crops, mode)
    expect(createHash('sha256').update(Buffer.from(input.data.buffer)).digest('hex')).toBe(expected[mode])
  }
})
it('原分辨率RGB归一化、48高、128对齐白色填充与每批CTC独立折叠', () => {
  const rgb = Uint8Array.of(255, 0, 0, 0, 255, 0)
  const crop = recognitionCrop(2, 1, [0, 0, 1, 1])
  crop.tensorWidth = 90
  const input = recognitionBatchInput(rgb, 2, [crop])
  expect(input.width).toBe(128); expect(input.data[0]).toBe(0.5); expect(input.data[128 * 48 * 2]).toBe(-0.5); expect(input.data[95]).toBe(0.5)
  const ids = [1, 1, 0, 1, 2, 2, 0], data = new Float32Array(2 * ids.length * 4)
  ids.forEach((id, i) => { data[i * 4 + id] = .99; data[(ids.length + i) * 4 + (id === 1 ? 2 : id === 2 ? 1 : 0)] = .98 })
  expect(decodeRecognitionBatch({ data, dims: [2, ids.length, 4] }, ['a', 'b'])).toEqual([{ text: 'aab', confidence: expect.closeTo(.99) }, { text: 'bba', confidence: expect.closeTo(.98) }])
  expect(() => decodeRecognitionBatch({ data, dims: [1, ids.length, 5] }, ['a', 'b'])).toThrow('字典')
})
it('独立txt字典保留空格、清理换行；批宽预算和32行/1920上限', () => {
  expect(readRecognitionDictionary('a\r\n中\r\n \r\n')).toEqual(['a', '中', ' '])
  expect(() => readRecognitionDictionary('')).toThrow('字典')
  const crops = Array.from({ length: 100 }, (_, i) => recognitionCrop(3840, 2160, [0, 0, (i + 1) / 100, 0.01]))
  const batches = recognitionBatches(crops)
  expect(batches.flat().sort((a, b) => a - b)).toEqual(crops.map((_, i) => i))
  for (const batch of batches) { const width = Math.ceil(Math.max(...batch.map(i => crops[i].tensorWidth)) / 128) * 128; expect(width).toBeLessThanOrEqual(1920); expect(batch.length).toBeLessThanOrEqual(32); expect(batch.length * width).toBeLessThanOrEqual(3072) }
})
it('缩小裁片保留落在采样点之间的窄笔画，防止假密钥中的 I 消失', () => {
  const rgb = new Uint8Array(144 * 144 * 3).fill(255)
  for (let y = 0; y < 144; y++) rgb.fill(0, (y * 144 + 6) * 3, (y * 144 + 7) * 3)
  const input = recognitionBatchInput(rgb, 144, [recognitionCrop(144, 144, [0, 0, 1, 1])])
  expect(input.data[24 * input.width + 2]).toBeCloseTo(198 / 255 - .5, 5)
})
