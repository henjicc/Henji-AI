import { videoEditOffscreenPool } from '../engine/videoEditOffscreenPool'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { createVideoEditTestDocument } from '@/core/videoEdit/testFixtures'
import { videoEditComposition } from '@/core/videoEdit/document'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { ContactSheetBitmap, ContactSheetCanvas } from '@/tests/videoEditContactSheetCanvas'
import { renderVideoEditContactSheet } from './videoEditContactSheet'

vi.mock('@/platform/runtime', () => ({ getPlatform: () => ({ system: { memoryInfo: async () => ({ availableBytes: 2 ** 32, totalBytes: 2 ** 33 }) } }) }))
const boundary = vi.hoisted(() => ({ present: vi.fn(), dispose: vi.fn() }))
vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  present = boundary.present
  dispose = boundary.dispose
  async updateDocument() {}
  async replaceContent() {}
} }))
const document = createVideoEditTestDocument('联系表格子隔离')
document.items.push({ id: 'image', kind: 'image', name: '画面' })
document.sequences[0].clips.push({ ...makeVideoEditItemClip(document, 'image', document.sequences[0].id, { frame: 0 }), duration: 120 })
const composition = videoEditComposition(document, document.sequences[0].id)
const bitmaps: ContactSheetBitmap[] = []
beforeEach(() => {
  bitmaps.length = 0; vi.clearAllMocks()
  vi.stubGlobal('OffscreenCanvas', ContactSheetCanvas)
  boundary.dispose.mockResolvedValue(undefined)
  boundary.present.mockImplementation(async (frame: number) => {
    // Deliberately vary source size; every draw must use the destination cell rectangle.
    const width = frame % 2 ? 192 : 96; const height = width / 2
    const data = new Uint8Array(width * height * 4)
    for (let i = 0; i < data.length; i += 4) data.set([frame + 40, 70, 90, 255], i)
    const bitmap = new ContactSheetBitmap(data, width, height); bitmaps.push(bitmap)
    return { presented: true, bitmap }
  })
})
afterEach(async () => { await videoEditOffscreenPool.dispose(); vi.unstubAllGlobals() })

it('不同尺寸的九张位图只覆盖各自格子，后帧和关闭位图不抹掉既有时间码', async () => {
  const sheet = await renderVideoEditContactSheet(composition, { startFrame: 0, endFrame: 119, frameCount: 9 }, 960, new AbortController().signal)
  const data = await sharp(sheet.bytes).ensureAlpha().raw().toBuffer()
  for (let i = 0; i < 9; i++) {
    const x = i % 3 * sheet.cellWidth; const y = Math.floor(i / 3) * sheet.cellHeight
    const pixel = ((y + 50) * sheet.width + x + 50) * 4
    expect([...data.subarray(pixel, pixel + 4)]).toEqual([sheet.frames[i] + 40, 70, 90, 255])
    let white = 0
    for (let dy = 0; dy < 28; dy++) for (let dx = 0; dx < 90; dx++) {
      const at = ((y + dy) * sheet.width + x + dx) * 4
      if (data[at] > 200 && data[at + 1] > 200 && data[at + 2] > 200) white++
    }
    expect(white, `格子 ${i} 时间码`).toBeGreaterThan(50)
    expect(bitmaps[i].closes).toBe(1)
  }
  expect(boundary.dispose).not.toHaveBeenCalled()
})

it('中途渲染失败保留错误并释放已生成位图，不返回残缺联系表', async () => {
  const normal = boundary.present.getMockImplementation()!
  boundary.present.mockImplementation(async (frame: number) => {
    if (frame === 30) throw new Error('读取失败')
    return normal(frame)
  })
  await expect(renderVideoEditContactSheet(composition, { startFrame: 0, endFrame: 119, frameCount: 9 }, 960, new AbortController().signal)).rejects.toThrow('读取失败')
  expect(bitmaps).toHaveLength(2); expect(bitmaps.map(bitmap => bitmap.closes)).toEqual([1, 1])
})
