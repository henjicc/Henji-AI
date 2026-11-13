import { beforeEach, describe, expect, it, vi } from 'vitest'

const platform = vi.hoisted(() => ({ recognize: vi.fn(), cancel: vi.fn() }))
const paid = vi.hoisted(() => vi.fn(async (_options: unknown, work: (signal: AbortSignal) => Promise<unknown>) => work(new AbortController().signal)))
vi.mock('@/platform/runtime', () => ({ getPlatform: () => ({ documentText: platform }) }))
vi.mock('@/services/paidApproval', () => ({ withPaidOperation: paid }))

import { recognizeDocumentText } from './documentTextService'
import { capabilityVerificationEnvelope } from '@/core/application-control/capabilityVerification'
import { recognizeDocumentTextCapability } from '@/core/application-control/domains/asset/documentTextCapability'

describe('识别文件中的文字', () => {
  beforeEach(() => { platform.recognize.mockReset(); paid.mockClear() })

  it('图片默认本地识别，不经过付费策略', async () => {
    platform.recognize.mockResolvedValue({ engine: 'local', charged: false, pageCount: 1, pages: [{ index: 0, text: '你好', complete: true }] })
    const output = await recognizeDocumentText({ path: 'C:\\a\\shot.png' })
    expect(platform.recognize).toHaveBeenCalledWith(expect.objectContaining({ path: 'C:\\a\\shot.png', engine: 'local', layout: 'text' }))
    expect(paid).not.toHaveBeenCalled()
    expect(output.message).toContain('本地识别')
    // 没有实体写入，公共核对必须仍判为成功，否则账本停在待核对、按原 operationId 查不到结果
    const envelope = capabilityVerificationEnvelope(recognizeDocumentTextCapability, { path: 'C:/a/shot.png' }, recognizeDocumentTextCapability.outputSchema.parse(output))
    expect(envelope.verification).toMatchObject({ verified: true })
  })

  it('PDF 走 DeepSeek，按 1000 页上限估价进付费策略', async () => {
    platform.recognize.mockResolvedValue({ engine: 'deepseek', charged: true, pageCount: 2, pages: [{ index: 0, text: 'a', complete: true }, { index: 1, text: 'b', complete: false }] })
    const output = await recognizeDocumentText({ path: 'C:\\a\\report.pdf' })
    expect(paid).toHaveBeenCalledWith(expect.objectContaining({ category: 'recognition', estimatedCny: 1.5 }), expect.any(Function), undefined)
    expect(output.message).toContain('1 页输出达到上限')
  })

  it('BMP 默认交给 DeepSeek，按 1 页估价', async () => {
    platform.recognize.mockResolvedValue({ engine: 'deepseek', charged: true, pageCount: 1, pages: [{ index: 0, text: 'a', complete: true }] })
    await recognizeDocumentText({ path: 'C:/a/scan.bmp' })
    expect(platform.recognize).toHaveBeenCalledWith(expect.objectContaining({ engine: 'deepseek' }))
    expect(paid).toHaveBeenCalledWith(expect.objectContaining({ estimatedCny: 0.0015 }), expect.any(Function), undefined)
  })

  it('本地识别失败与 DeepSeek 上传前拒绝都标为未执行，其他 DeepSeek 失败不标', async () => {
    const notExecuted = (error: unknown) => (error as { details?: { execution?: { notExecuted?: boolean } } }).details?.execution?.notExecuted
    platform.recognize.mockRejectedValueOnce(new Error('图片文字识别失败。'))
    expect(notExecuted(await recognizeDocumentText({ path: 'C:/a/shot.png' }).catch(error => error))).toBe(true)
    platform.recognize.mockRejectedValueOnce(new Error('DOCUMENT_TOO_LARGE: 最大 100 MiB'))
    expect(notExecuted(await recognizeDocumentText({ path: 'C:/a/big.pdf' }).catch(error => error))).toBe(true)
    platform.recognize.mockRejectedValueOnce(new Error('DeepSeek 文字识别失败（HTTP 504）'))
    expect(notExecuted(await recognizeDocumentText({ path: 'C:/a/big.pdf' }).catch(error => error))).toBeUndefined()
  })

  it('本地识别文档在执行前拒绝，不发请求', async () => {
    await expect(recognizeDocumentText({ path: 'C:\\a\\report.docx', engine: 'local' })).rejects.toThrow('LOCAL_OCR_IMAGE_ONLY')
    expect(platform.recognize).not.toHaveBeenCalled()
  })
})
