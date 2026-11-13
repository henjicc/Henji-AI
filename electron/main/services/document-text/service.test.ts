import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { composeImageTextLines, createDocumentTextService, type DocumentTextDependencies } from './service'

let directory = ''
beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-doc-text-'))
  await fs.writeFile(path.join(directory, 'shot.png'), 'png')
  await fs.writeFile(path.join(directory, 'report.pdf'), 'pdf')
})
afterAll(async () => { await fs.rm(directory, { recursive: true, force: true }) })

function deps(overrides: Partial<DocumentTextDependencies> = {}): DocumentTextDependencies {
  return {
    ensureModel: async (id, role) => `/models/${id}/${role ?? 'model'}`,
    providers: ['cpu'],
    imageText: vi.fn(async () => ({ width: 100, height: 100, lines: [
      { text: '世界', confidence: 0.9, box: [0.5, 0.1, 0.3, 0.1] as [number, number, number, number] },
      { text: '你好', confidence: 0.9, box: [0.1, 0.11, 0.3, 0.1] as [number, number, number, number] },
      { text: '噪点', confidence: 0.2, box: [0.1, 0.5, 0.1, 0.1] as [number, number, number, number] },
      { text: '第二行', confidence: 0.8, box: [0.1, 0.4, 0.3, 0.1] as [number, number, number, number] },
    ] })),
    cancelLocal: vi.fn(),
    deepseekOcr: vi.fn(async () => ({ pageCount: 1, pages: [{ index: 0, text: '正文', finishReason: 'length' as const }] })),
    log: vi.fn(),
    ...overrides,
  }
}

describe('识别文件文字', () => {
  it('同一行的检测框拼成一行，低置信度丢弃', () => {
    expect(composeImageTextLines([
      { text: '你好', confidence: 0.9, box: [0.1, 0.1, 0.3, 0.1] },
      { text: '世界', confidence: 0.9, box: [0.5, 0.12, 0.3, 0.1] },
      { text: '第二行', confidence: 0.9, box: [0.1, 0.4, 0.3, 0.1] },
      { text: '噪点', confidence: 0.1, box: [0.1, 0.6, 0.3, 0.1] },
    ])).toBe('你好 世界\n第二行')
  })

  it('auto 时图片走本地、文档走 DeepSeek，且只有 DeepSeek 记为付费', async () => {
    const dependencies = deps()
    const recognize = createDocumentTextService(dependencies)
    const signal = new AbortController().signal
    const image = await recognize({ requestId: 'a', path: path.join(directory, 'shot.png'), engine: 'auto', layout: 'text' }, signal)
    expect(image).toMatchObject({ engine: 'local', charged: false, pages: [{ text: '你好 世界\n第二行', complete: true }] })
    expect(dependencies.imageText).toHaveBeenCalledWith(expect.objectContaining({ dictionaryPath: '/models/text_recognition_ppocr/dict' }))
    const document = await recognize({ requestId: 'b', path: path.join(directory, 'report.pdf'), engine: 'auto', layout: 'rich_layout' }, signal)
    expect(document).toEqual({ engine: 'deepseek', charged: true, pageCount: 1, pages: [{ index: 0, text: '正文', complete: false }] })
    expect(dependencies.deepseekOcr).toHaveBeenCalledWith(expect.objectContaining({ layout: 'rich_layout', file: expect.objectContaining({ mediaType: 'application/pdf', filename: 'report.pdf' }) }), signal)
  })

  it('本地不能识别文档，不支持的格式不发请求', async () => {
    const dependencies = deps()
    const recognize = createDocumentTextService(dependencies)
    const signal = new AbortController().signal
    await expect(recognize({ requestId: 'c', path: path.join(directory, 'report.pdf'), engine: 'local', layout: 'text' }, signal)).rejects.toThrow('LOCAL_OCR_IMAGE_ONLY')
    await expect(recognize({ requestId: 'd', path: path.join(directory, 'a.txt'), engine: 'auto', layout: 'text' }, signal)).rejects.toThrow('DOCUMENT_FORMAT_UNSUPPORTED')
    expect(dependencies.deepseekOcr).not.toHaveBeenCalled()
    expect(dependencies.imageText).not.toHaveBeenCalled()
  })

  it('取消时通知本地推理停止', async () => {
    const controller = new AbortController()
    const dependencies = deps({ imageText: vi.fn(async () => { controller.abort(); throw new Error('cancelled') }) })
    await expect(createDocumentTextService(dependencies)({ requestId: 'e', path: path.join(directory, 'shot.png'), engine: 'local', layout: 'text' }, controller.signal)).rejects.toThrow()
    expect(dependencies.cancelLocal).toHaveBeenCalled()
  })
})
