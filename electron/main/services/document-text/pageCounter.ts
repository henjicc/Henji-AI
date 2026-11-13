import { strFromU8, unzipSync } from 'fflate'
import { PDFDocument } from 'pdf-lib'

/**
 * 识别前估算文档页数，供付费估价使用。PDF 用 pdf-lib（能读压缩对象流里的页树）；
 * PPTX 数 ppt/slides/slideN.xml；DOCX 读 Word 写入 docProps/app.xml 的 Pages。
 * 旧版二进制 doc/ppt、统计不出或页数为 0 时返回 null，由调用方按上限估价。
 */
export async function countDocumentPagesFromBytes(bytes: Uint8Array, extension: string): Promise<number | null> {
  let pages: number | null = null
  if (extension === 'pdf') {
    pages = (await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false })).getPageCount()
  } else if (extension === 'pptx') {
    let slides = 0
    unzipSync(bytes, { filter: entry => { if (/^ppt\/slides\/slide\d+\.xml$/.test(entry.name)) slides++; return false } })
    pages = slides
  } else if (extension === 'docx') {
    const files = unzipSync(bytes, { filter: entry => entry.name === 'docProps/app.xml' })
    const value = /<Pages>(\d+)<\/Pages>/.exec(files['docProps/app.xml'] ? strFromU8(files['docProps/app.xml']) : '')?.[1]
    pages = value ? Number(value) : null
  }
  return pages && pages > 0 ? pages : null
}
