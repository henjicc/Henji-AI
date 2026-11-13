import { strToU8, zipSync } from 'fflate'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { countDocumentPagesFromBytes } from './pageCounter'

describe('识别前统计文档页数', () => {
  it('PDF 含压缩对象流时也能数对页数', async () => {
    const document = await PDFDocument.create()
    for (let index = 0; index < 7; index++) document.addPage()
    // useObjectStreams 把页对象压进对象流，正则数不到 /Type /Page
    const bytes = await document.save({ useObjectStreams: true })
    expect(Buffer.from(bytes).toString('latin1')).not.toMatch(/\/Type\s*\/Page[^s]/)
    await expect(countDocumentPagesFromBytes(bytes, 'pdf')).resolves.toBe(7)
  })

  it('PPTX 数幻灯片文件，DOCX 读 Word 写入的页数', async () => {
    const pptx = zipSync({ 'ppt/slides/slide1.xml': strToU8('<p/>'), 'ppt/slides/slide2.xml': strToU8('<p/>'), 'ppt/slides/_rels/slide1.xml.rels': strToU8('<r/>') })
    await expect(countDocumentPagesFromBytes(pptx, 'pptx')).resolves.toBe(2)
    const docx = zipSync({ 'docProps/app.xml': strToU8('<Properties><Pages>12</Pages></Properties>') })
    await expect(countDocumentPagesFromBytes(docx, 'docx')).resolves.toBe(12)
  })

  it('统计不出时返回 null，由调用方按上限估价', async () => {
    await expect(countDocumentPagesFromBytes(zipSync({ 'word/document.xml': strToU8('<w/>') }), 'docx')).resolves.toBeNull()
    await expect(countDocumentPagesFromBytes(new Uint8Array([1, 2, 3]), 'doc')).resolves.toBeNull()
    await expect(countDocumentPagesFromBytes(new Uint8Array([1, 2, 3]), 'pdf')).rejects.toThrow()
  })
})
