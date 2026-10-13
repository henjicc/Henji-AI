import { describe, expect, it } from 'vitest'
import { AiRuntimeError } from '../src/runtime/AiRuntimeError'
import { readUploadJson } from '../src/upload/upload-response'

describe('上传响应复用公共 JSON 错误归一', () => {
  // synthetic-negative：模拟上传网关 HTML/文本错误，不冒充官方响应。
  it.each([
    ['KIE upload', 401], ['KIE upload', 429], ['KIE upload', 503],
    ['APIMart image upload', 401], ['APIMart image upload', 429], ['APIMart image upload', 503],
  ])('%s 非 JSON HTTP %s 保留上传错误码、状态与截断原因', async (label, status) => {
    const error = await readUploadJson(new Response(`<html>upload gateway ${'x'.repeat(800)}</html>`, { status }), label).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(AiRuntimeError)
    expect(error).toMatchObject({ code: 'upload_failed', details: { status }, message: expect.stringContaining(`HTTP ${status}`) })
    expect((error as Error).message).toContain('upload gateway')
    expect((error as Error).message.length).toBeLessThan(600)
  })

  it('JSON HTTP 错误同样保留结构化状态与供应商原因', async () => {
    await expect(readUploadJson(new Response('{"message":"upload denied"}', { status: 403 }), 'APIMart image upload')).rejects.toMatchObject({
      code: 'upload_failed', details: { status: 403 }, message: expect.stringContaining('upload denied'),
    })
  })

  it('损坏的 2xx JSON 保持 upload_failed 并保留 status', async () => {
    await expect(readUploadJson(new Response('not JSON'), 'KIE upload')).rejects.toMatchObject({ code: 'upload_failed', details: { status: 200 } })
  })

  it('成功响应保持原 JSON 数据', async () => {
    const payload = { data: { downloadUrl: 'https://media.invalid/reference.png' } }
    await expect(readUploadJson(new Response(JSON.stringify(payload)), 'KIE upload')).resolves.toEqual(payload)
  })

  it('正文读取中止透传原取消错误，不包装为上传失败', async () => {
    const aborted = new DOMException('Aborted', 'AbortError')
    const body = new ReadableStream({ start(controller) { controller.error(aborted) } })
    await expect(readUploadJson(new Response(body), 'KIE upload')).rejects.toBe(aborted)
  })
})
